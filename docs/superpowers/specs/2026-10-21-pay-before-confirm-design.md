# Pay-before-confirm — design spec

Status: **IMPLEMENTED** (2026-10-22). Decisions confirmed by the owner: 30-minute window; rival offers reopen. Implementation added `Booking.isLive` + partial unique indexes (see §5.4) because the old unique `requestId`/`offerId` indexes would otherwise block re-booking a reopened request. Path: architectural (adds a booking
status, a payment deadline and a sweep; changes the accept response).

## 1. Problem

Accepting an offer today creates a booking that is `confirmed` immediately, with the stylist's
slot blocked, the request `FULFILLED` and every sibling offer `CLOSED`. The client then calls
`POST /payments/:bookingId/initialize` as a separate step. Chat already opens only on
`PAYMENT_SUCCEEDED`, so that part is fine.

The defect: **an unpaid booking never expires.** The only sweep that touches bookings
(`stale-booking.cron.js`) acts 24 h after the session *ends*. A client who never pays leaves the
stylist's slot, the request and all rival offers locked until then. `confirmed` also misstates
reality, and the client needs an extra round trip to get a payment link.

## 2. Decision

**Option A — reserve, then pay.** Accept creates the booking in a new `pending_payment` status
with a payment deadline and returns the payment URL in the same response. Payment success
confirms it; a missed deadline releases everything.

Rejected — **Option B (create the booking inside the webhook).** No slot hold means a client can
pay for a slot someone else just took (forced auto-refund); the webhook — the least reliable
component today — becomes the heaviest transaction; `Payment` is keyed unique on `bookingId`, and
the ledger and cancellation logic all assume a booking exists.

## 3. Behaviour

### 3.1 Accept (`PATCH /offers/:id/accept`)
1. Same transaction as today, except the booking is created as `pending_payment` with
   `paymentExpiresAt = min(now + WINDOW, session start)`. Slot block, request lock (`FULFILLED`),
   pending `Payment` and sibling closing are unchanged.
2. **After commit**, call `paymentService.initializePayment` and return
   `{ booking, paymentUrl, paymentExpiresAt }`. The provider call is never inside the transaction.
3. If the provider call fails, accept still succeeds with `paymentUrl: null`; the client retries
   `POST /payments/:bookingId/initialize`. **That retry does not work today** (found 2026-10-22):
   `paymob.provider.js` sends `special_reference = bookingId`, which Paymob requires to be unique,
   so any second initialize for a booking is rejected ("An Order with ref … already exists"), and
   the checkout `clientSecret` is not stored. Prerequisite P1 below fixes this.
4. **Demo mode** (`bookingMode: 'demo'`, cash on delivery) has no online payment: the booking is
   created `confirmed` exactly as today.

### 3.2 Payment success
In the existing webhook transaction (payment → `paid`, ledger pair), also CAS the booking
`pending_payment → confirmed` using the passed `session`. Then `PAYMENT_SUCCEEDED` fires as today
(chat opens, client notified).

### 3.3 Deadline missed (new sweep, every 5 min)
For bookings `pending_payment` with `paymentExpiresAt < now`, in one transaction per booking:
1. CAS booking `pending_payment → cancelled` (`cancelledBy: 'system'`,
   `cancellationReason: 'payment_timeout'`). No refund, no penalty, no reliability impact.
2. Delete the `ScheduleBlock`.
3. If the session start is still in the future: request `FULFILLED → OPEN`; the accepted offer and
   the siblings this accept closed return to `PENDING` (see 5.2). Otherwise request → `CLOSED`
   and those offers → `EXPIRED`.
4. Mark the `Payment` `failed` (reason `payment_timeout`).
5. Emit `BOOKING_CANCELLED` with `cancelledBy: 'system'`; the chat listener locks the (never
   opened) conversation. Notify both parties.

### 3.4 Client cancels while unpaid
`PATCH /bookings/:id/cancel` on a `pending_payment` booking runs the same release as 3.3 with
`cancelledBy: 'client'`, no refund (nothing was paid) and no cancellation-fee tier.

### 3.5 Late payment (paid after expiry)
The webhook finds the booking `cancelled` (CAS fails). Do **not** confirm. Record the payment
`paid`, then immediately run the existing 100 % refund path (`processRefund`) and log an error
with both ids. Mitigation: set the Paymob intention expiry to the deadline if the API supports it
(**verify in Paymob docs before relying on it**).

## 4. Constants
`BOOKING_PAYMENT_POLICY = { WINDOW_MINUTES: 30, SWEEP_CRON: '*/5 * * * *' }` in
`statuses.constant.js`. Nothing hard-coded in services.

## 5. Changes by area

### 5.1 Status machine
- `BOOKING_STATUS.PENDING_PAYMENT = 'pending_payment'`, added to the model enum. The schema
  default stays `confirmed`; `createBookingFromOffer` sets the status explicitly (it already does).
- `booking.transitions.js`: `pending_payment → [confirmed, cancelled]`. No other edges.
- `cancelledBy` already allows `'system'` and `cancellationReason` already exists — no schema
  change needed for them.
- **Safe by default:** reminders, check-in, no-show reporting, the stale sweep, dispute filing and
  completion all list explicit statuses, so they ignore `pending_payment` with no edit. This must
  be proven by tests (6), not assumed.

### 5.2 Restoring offers
`closeSiblingOffers` currently gives no way to tell offers closed *by this accept* from offers
closed for other reasons. Add `Offer.closedByBookingId`, set when siblings are closed; the sweep
restores exactly offers with that value (and the accepted offer) to `PENDING`.

### 5.3 Other code touched
`booking.service.createBookingFromOffer`, `offer.service.acceptOffer` (+ controller response),
`payment.service.handleWebhook` and `initializePayment` (refuse unless booking is
`pending_payment` or `confirmed`), `cancelBooking`, `booking.dto.js` (expose `status`,
`paymentExpiresAt`), a new `jobs/payment-timeout.cron.js` registered in `server.js`, notification
and audit mappings for the new events, Swagger for the changed accept response.

### 5.4 Unique indexes (found during implementation)
`Booking.requestId` and `Booking.offerId` were unique across all bookings, so a released booking
would permanently block the reopened request. Both are now unique only where `isLive: true`;
`isLive` becomes false on release. Existing databases need
`scripts/migrate-booking-live-indexes.js` (backfills `isLive`, drops the old indexes, builds the
new ones).

## 6. Tests (written first — money/scheduling)
Accept returns `paymentUrl` and a `pending_payment` booking; provider failure still accepts;
webhook confirms in the same transaction; deadline sweep releases slot/request/offers; sweep never
touches a paid or confirmed booking; sweep is idempotent and race-safe against a concurrent
webhook (CAS); unpaid client cancel; late payment is refunded; every existing consumer of
`confirmed` ignores `pending_payment`; demo mode unchanged; ledger stays balanced after a timeout
(no entries expected).

## 7. Dependencies and order
**P1 (new) — re-initializable payments.** Store `clientSecret` and an `attempt` counter on
`Payment`; `/initialize` reuses the live link, or creates attempt N+1 with
`special_reference = <bookingId>-<N>`; the webhook parses the booking id from the part before
the dash. Needed by this feature and independently by any client who closes the Paymob page.

Item 1 (payment callback) must land first or together: a missed webhook would now cost the client
their booking at the deadline. Before expiring, the sweep should reconcile with Paymob's
transaction-inquiry endpoint for any booking whose payment is still `pending`.

## 8. Open questions
1. Payment window — 30 minutes assumed.
2. On timeout, restore all rival offers (assumed, so one failed payment does not wipe the
   client's options) or leave the client to start over?
