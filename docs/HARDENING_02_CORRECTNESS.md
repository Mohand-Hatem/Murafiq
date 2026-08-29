# Hardening 2 — Correctness & Data Integrity (P1)

## Goal

Fix defects that don't block a first deploy but will corrupt data, leak information, or mislead users
once real traffic arrives — wrong notifications, an unreconcilable refund ledger, tamperable chat,
unbounded queries on public endpoints, and a test suite that never touches a real database.

## Depends on

`HARDENING_01_CRITICAL.md` fully done. In particular: Step 4 here (the refund ledger) is pointless if
Step 1 there hasn't landed — no reason to make the ledger correct while forged webhooks can still write
to it. Do not start this document until that one's Definition of Done is fully checked.

## How to use this document

Same process as `HARDENING_01_CRITICAL.md` — one step, What/Why/How, wait for approval. Steps are
grouped by theme, not strict dependency order within a step; still work top to bottom.

---

## Steps

### 1. Fix the event-name collision (wrong notifications)

**The defect.** `src/common/constants/events.constant.js` defines these event names:

```
USER_REGISTERED, USER_VERIFIED, USER_VERIFICATION_REJECTED, USER_LOCATION_UPDATED,
REQUEST_CREATED, OFFER_CREATED, BOOKING_CONFIRMED, BOOKING_CANCELLED, SESSION_COMPLETED,
SESSION_DISPUTED, PAYMENT_SUCCEEDED, PAYMENT_FAILED, PAYMENT_REFUNDED, CHAT_MESSAGE_SENT,
REVIEW_SUBMITTED
```

But the code **emits and listens on** four names that don't exist there: `OFFER_ACCEPTED`
(`offer.service.js:126`), `OFFER_REJECTED` (`offer.service.js:151`), `BOOKING_CREATED`
(`offer.service.js:127`), `REQUEST_DECLINED` (`request.service.js:131`). Each of
`EVENTS.OFFER_ACCEPTED`, `EVENTS.OFFER_REJECTED`, etc. evaluates to `undefined`. Node's `EventEmitter`
accepts `undefined` as a valid event key, so **all four collide on one channel**. The only listener
registered on that channel is `notification.listener.js:57` (`EVENTS.OFFER_ACCEPTED`), which sends:

> "Offer Accepted! Booking Confirmed — Your styling offer was accepted by the client."

So today: rejecting an offer, declining a request, and accepting an offer **all fire the same
"accepted" notification** to the stylist. A client who rejects an offer causes the stylist to be told
it was accepted.

**Changes.**

1. Add the four missing keys to `events.constant.js`: `OFFER_ACCEPTED: 'offer.accepted'`,
   `OFFER_REJECTED: 'offer.rejected'`, `BOOKING_CREATED: 'booking.created'`,
   `REQUEST_DECLINED: 'request.declined'`.
2. Add the two listeners that don't exist yet: `OFFER_REJECTED` → notify client (already sees the
   response synchronously, but the client should still get a push), `REQUEST_DECLINED` → notify client.
3. Audit `notification.listener.js` for any other event name used in an `eventBus.emit` call anywhere
   in `src/` that isn't a key in `events.constant.js` — this bug class is systemic, not limited to
   these four. (`grep -rhno "EVENTS\.[A-Z_]*" src/ | sed 's/.*EVENTS\.//' | sort -u` against the keys in
   the constants file is the check.)
4. Add a boot-time assertion (or a unit test) that every value emitted via `eventBus.emit(EVENTS.X, ...)`
   across the codebase corresponds to a defined key — this is exactly the kind of typo a linter can't
   catch but a small startup check can.

---

### 2. Gate session completion on booking status

**The defect.** `confirmCompletion` (`src/modules/bookings/booking.service.js:184`) never checks
`booking.status` before recording a confirmation. A **cancelled** booking, or one that was never
checked into, can be flipped to `completed` if both parties call the endpoint — which fires
`SESSION_COMPLETED`, increments `completedSessions`/`completedBookings`, unlocks review submission
(`review.service.js:23` only checks `status === 'completed'`, and this *is* how it got there), and
notifies the stylist their earnings are payout-eligible.

**Changes.**

1. In `confirmCompletion`, reject with `400` unless `booking.status === 'in-progress'` (i.e. check-in
   already happened). This also closes the gap where a booking that was never checked in — meaning
   payment was never confirmed as complete, per the existing check-in payment gate — can reach
   `completed`.
2. Add a test: cancel a booking, then have both parties call confirm-completion → expect `400`, not
   `200`.

---

### 3. Feed real customer data to the payment provider

**The defect.** `authMiddleware` (`src/common/middlewares/auth.middleware.js:17`) sets
`req.user = { id: decoded.sub, role: decoded.role }` from the JWT payload only — no name, email, or
phone. `paymentService.initializePayment` (`src/modules/payments/payment.service.js:73`) passes this
straight through as `customer: { name: user.name, email: user.email, phone: user.phone }`, all
`undefined`. `PaymobProvider#initialize` then falls back to hardcoded placeholders
(`paymob.provider.js:48`: `'customer@example.com'`, `'+201000000000'`). **Every real Paymob transaction
is submitted with fake billing data**, which will cause chargebacks/compliance issues and makes
transaction records unusable for support.

**Changes.**

1. In `initializePayment`, fetch the full user via `userRepository.findById` (already imported in
   sibling services via the documented cross-module pattern) rather than relying on the JWT-only
   `req.user`. Do **not** change `authMiddleware` to embed name/email/phone in the JWT — that data goes
   stale and bloats every request's token.
2. Validate the fetched user has a phone number before hitting Paymob (currently optional at
   registration); decide and document what happens when it's missing rather than silently defaulting.

---

### 4. Make the refund ledger match the documented policy

**The defect.** `PHASE_06_PAYMENTS.md` §3B specifies: client cancels < 24h before session → client gets
75% refund, **platform keeps 25%**. `CANCELLATION_POLICY.PARTIAL_PLATFORM_FEE_PERCENTAGE: 25`
(`src/common/constants/statuses.constant.js:27`) is defined **and never read anywhere in `src/`**.

What actually happens in `paymentService.processRefund` (`payment.service.js:173`): it computes
`refundAmount = round2(amount * refundPercentage / 100)` and writes it, but leaves
`platformFeeAmount` and `stylistPayoutAmount` **untouched at their original full-price values**. The
payment record after a 75% refund still claims a 15%-of-full platform fee and an 85%-of-full stylist
payout — neither reflects what actually happened. There is also only one terminal state,
`PAYMENT_STATUS.REFUNDED`, used identically for a 100% and a 75% refund, so status alone can't
distinguish them. **The ledger cannot be reconciled from the data it stores.**

**Changes.**

1. Add `PARTIALLY_REFUNDED` to `PAYMENT_STATUS` (`statuses.constant.js`).
2. In `processRefund`, when `refundPercentage < 100`: recompute `platformFeeAmount` as the *retained*
   fee (`round2(amount * PARTIAL_PLATFORM_FEE_PERCENTAGE / 100)` per the documented policy — note this
   currently hardcodes 25% rather than deriving it from `refundPercentage`; decide whether the retained
   percentage should always be `100 - refundPercentage` generically, or stay a fixed policy constant,
   and update whichever of the code or `PHASE_06_PAYMENTS.md` is wrong so they agree), set
   `stylistPayoutAmount = 0` (§3B: stylist gets nothing on any cancellation-triggered refund), and set
   `status = PAYMENT_STATUS.PARTIALLY_REFUNDED`.
3. Assert the invariant in a test: `platformFeeAmount + stylistPayoutAmount + refundAmount === amount`
   (2dp) holds after every refund path — full and partial.
4. Update `payment.dto.js` / admin reporting (once it exists) to surface the distinction.

---

### 5. Make cancellation atomic

**The defect.** `cancelBooking` (`src/modules/bookings/booking.service.js:253`) performs, in sequence
and **outside any transaction**: delete the schedule block, update the booking to `cancelled`, then
(conditionally) call `paymentService.processRefund`, which itself calls the external provider. If the
provider call throws, the booking is already `cancelled` and the slot already released, but the payment
is still `PAID` — a client believes they cancelled and were refunded; the ledger says they were charged
in full for a session that no longer exists.

**Changes.**

1. Wrap the schedule-release and status-update in the same Mongo session/transaction already available
   elsewhere in this module (see `bookingService.createBookingFromOffer` for the pattern).
2. Call the external provider refund **last**, after the transaction commits, since it's a non-Mongo
   side effect and can't be part of the transaction anyway.
3. If the provider call fails after commit, record the failure (a `refundFailedAt`/`refundError` field
   on the payment, or a dedicated retry queue once `HARDENING_03` background jobs exist) rather than
   losing it silently — today the error just propagates to the HTTP response with no persisted trace.
4. Add basic idempotency to `checkIn`, `confirmCompletion`, and `cancelBooking` — re-check current
   status inside the update, not just before it, to close the same class of race as Step 4 of
   `HARDENING_01_CRITICAL.md`.

---

### 6. Fix the Cairo-timezone calculations

**The defect.** Two separate timezone bugs:

- `getBusinessDayRange` (`src/common/utils/businessDay.util.js:6`) formats "today" using the Cairo
  timezone to get Y/M/D, but then constructs `new Date("YYYY-MM-DDT00:00:00.000Z")` — **UTC midnight**,
  not Cairo midnight. The 2-requests/day and 5-offers/day caps (`request.service.js:41`,
  `offer.service.js:45`) are therefore off by Cairo's UTC offset (+2h, or +3h in EEST) at the day
  boundary — a request made just after midnight Cairo time can still count against yesterday's cap, or
  vice versa.
- `cancelBooking` (`booking.service.js:289`) applies `scheduledStartMinute` via `Date#setMinutes` in the
  **server's local time**, while the business is defined to run on `Africa/Cairo`. On a UTC-hosted
  server (Railway/Render both default to UTC) this shifts every session by 2–3 hours, which directly
  changes the outcome of the 24-hour full-refund cutoff. Separately,
  `if (booking.scheduledStartMinute)` is falsy at exactly minute 0 (midnight), so a midnight-scheduled
  booking silently skips the time offset entirely — this is a plain bug independent of timezone.

**Changes.**

1. Rewrite `getBusinessDayRange` to construct the boundary using the actual UTC offset for
   `BUSINESS_TIMEZONE` at the given date (accounting for Cairo's DST-less-but-historically-variable
   offset — verify current Egypt DST rules before hardcoding an offset), or use a timezone-aware date
   library if one is already a transitive dependency, rather than hand-rolling the arithmetic again.
2. In `cancelBooking`, compute `scheduledDateTime` explicitly in `BUSINESS_TIMEZONE`, not server local
   time.
3. Fix the minute-0 falsy check: `if (booking.scheduledStartMinute !== undefined && booking.scheduledStartMinute !== null)`.
4. Add a test that pins `TZ=UTC` for the process and asserts a Cairo-midnight boundary case behaves
   identically to a `TZ=Africa/Cairo` run — this is the only way to catch a regression here, since most
   developer machines aren't UTC.

---

### 7. Tighten Firestore chat rules

**The defect.** `firestore.rules:45` — the `update` rule on `messages` has no field restriction. The
comment claims it's for read receipts (`deliveredAt`/`seenAt`), but as written any participant can
rewrite `content` or `senderId` on any message in the conversation, including another user's message.
`firestore.rules:32` — the `update` rule on the parent `conversations` document is equally
unrestricted: a participant can rewrite `participants` to add an arbitrary third UID, which under the
`isParticipant` check then grants that UID read access to the entire message history. Both matter
specifically because admins rely on reading these threads verbatim to arbitrate disputes
(`chat.service.js:128` — any admin can already read any conversation with no per-dispute check, a
separate item tracked in `HARDENING_03_CLEANUP.md`).

**Changes.**

1. Restrict the `messages` `update` rule to only the two receipt fields, e.g. via
   `request.resource.data.diff(resource.data).affectedKeys().hasOnly(['deliveredAt', 'seenAt'])`.
2. Restrict the `conversations` `update` rule to `lastMessageAt` only, using the same `affectedKeys()`
   pattern — participants should never be able to mutate `participants`, `isOpen`, or `isLocked` from
   the client.
3. Add Firestore emulator-based rule tests (`@firebase/rules-unit-testing`) covering: a participant
   cannot alter another user's message content; a participant cannot add a new UID to `participants`.

---

### 8. Bound and sanitize public list queries

**The defect.** Three related issues, all reachable from the public, unauthenticated `GET /stylists`:

1. `QueryBuilder.paginate` (`src/common/query-builder/QueryBuilder.js:75`) has no maximum on `limit` —
   `?limit=1000000` returns the entire collection in one response.
2. `QueryBuilder.search` (`:44`) and `stylist-search.service.js` (location filters at `:19-29`, search
   at `:117`) build `new RegExp(userInput)` directly from query parameters — a crafted pattern is a
   ReDoS vector, and it's reachable without authentication.
3. `QueryBuilder.filter` (`buildFilter`, `:18`) has no field allow-list — any schema field, including
   ones marked `select: false` at the model level, is filterable via Mongo operators
   (`?otpCode[ne]=null` is a boolean oracle over a field the API is supposed to never expose), and
   filtering on unindexed fields is an easy collection-scan DoS.

**Changes.**

1. Cap `limit` in `QueryBuilder.paginate` (suggest 100) regardless of what the client requests.
2. Escape regex metacharacters in `search` inputs before constructing `RegExp` (or reject characters
   outside an allow-list) — same treatment for the location-exact-match regexes in
   `stylist-search.service.js`.
3. Add a per-repository field allow-list parameter to `QueryBuilder.filter`, defaulting to the model's
   public/indexed fields, and pass one explicitly from every repository that instantiates a
   `QueryBuilder`.
4. Add a test asserting `?otpCode[ne]=null` (or any `select:false` field) on a public list endpoint
   either 400s or is silently dropped from the filter — not honored.

---

### 9. Replace the mocked "integration" tests with a real database

**The defect.** All 8 files under `tests/integration/` mock every repository via
`jest.unstable_mockModule` (see the header of `tests/integration/payments.test.js` for the pattern).
There is no `mongodb-memory-server` and no real database anywhere in the test run. **Zero tests
exercise actual Mongoose schemas, indexes, validators, or transactions** — which is exactly where the
double-booking (Step 4, `HARDENING_01_CRITICAL.md`), the double-charge retry (Step 3, same doc), and
every unique-index assumption in this document live. 127 green tests currently measure the mocks, not
the system.

**Changes.**

1. Add `mongodb-memory-server` as a dev dependency.
2. Add a Jest global setup/teardown that starts an in-memory replica-set instance (single-node replica
   set, so transactions work — see `HARDENING_01_CRITICAL.md` Step 3) and points `MONGO_URI` at it for
   the test run.
3. Convert the integration suites incrementally, starting with the highest blast-radius paths first:
   offer acceptance under concurrency, schedule-slot uniqueness, the payment webhook authorization added
   in Step 1 of `HARDENING_01_CRITICAL.md`, and the refund arithmetic from Step 4 of this document. Not
   all 8 suites need to convert in one pass — prioritize by what this document and
   `HARDENING_01_CRITICAL.md` actually need to verify.
4. Keep the existing unit tests (`tests/unit/`) mocked — that's the correct layer for them. The
   distinction to enforce going forward: unit tests mock the repository layer, integration tests hit a
   real (in-memory) database and only mock true externals (Paymob's network calls, Firebase, Resend).

---

## Definition of Done

- [ ] Rejecting an offer sends the client an "offer rejected" notification and the stylist nothing claiming acceptance; declining a request notifies the client, not "accepted."
- [ ] A startup check (or test) fails the build if any `eventBus.emit` call anywhere in `src/` uses an event key not present in `events.constant.js`.
- [ ] Confirming completion on a cancelled or not-yet-checked-in booking returns `400`.
- [ ] A live Paymob sandbox transaction shows the real customer's name/email/phone in the Paymob dashboard, not the placeholder values.
- [ ] After a <24h client cancellation on a paid booking: `status === 'partially_refunded'`, `refundAmount === round2(amount * 0.75)`, and `platformFeeAmount + stylistPayoutAmount + refundAmount === amount` (2dp) — verified by test, not inspection.
- [ ] Forcing the mock/Paymob refund call to throw after `cancelBooking`'s status update leaves a recorded failure trace, not a silent 500 with an inconsistent booking/payment pair.
- [ ] With `TZ=UTC` set on the test process, a request made at 01:30 Cairo time (23:30 UTC the prior day) counts against the correct Cairo calendar day for the daily cap.
- [ ] A booking scheduled at minute 0 (midnight) is refunded according to the same 24-hour cutoff logic as any other time.
- [ ] Firestore rules unit tests pass: a participant cannot modify another user's message `content`, and cannot add a UID to `participants`.
- [ ] `GET /stylists?limit=999999` returns at most 100 items.
- [ ] A crafted pathological regex in `?search=` on `GET /stylists` returns within normal response time, not a hang.
- [ ] `GET /stylists?otpCode[ne]=null` (or any `select:false` field) does not filter on that field.
- [ ] At least the four highest-priority integration suites listed in Step 9 run against `mongodb-memory-server` and pass; `npm test` still exits 0.
- [ ] `npm run lint` exits 0.
