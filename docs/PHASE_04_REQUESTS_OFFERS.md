# Phase 4 — Requests & Offers

## Goal
Clients create Requests targeted at a specific stylist; stylists respond with Offers; clients accept/reject; offers auto-expire.

## Depends on
Phase 3 (verified stylist profiles to request against).

---

## Steps

### 1. `request.model.js`
```js
const requestSchema = new Schema({
  clientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  date: Date,
  time: String,
  meetingLocation: {
    address: String,
    country: String,
    governorate: String,
    city: String,
    area: String,
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
    },
  },
  description: String,
  budgetRange: {
    min: { type: Number, min: 100 },
    max: { type: Number, min: 100 },
  }, // optional guidance figure range from client; stylist's binding price is Offer.price
  images: [String],
  status: { type: String, enum: ['pending', 'offered', 'accepted', 'rejected', 'expired', 'cancelled'], default: 'pending' },
  expiresAt: Date, // now + REQUEST_EXPIRY_HOURS at creation — see step 3b
}, { timestamps: true });
```

### 2. `offer.model.js`
```js
const offerSchema = new Schema({
  requestId: { type: Schema.Types.ObjectId, ref: 'Request', required: true },
  stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  clientId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // denormalized from Request.clientId at creation — see step 7a
  price: { type: Number, min: 100, required: true }, // EGP binding price, floor min 100
  duration: Number, // minutes
  message: String,
  status: { type: String, enum: ['pending', 'accepted', 'rejected', 'expired'], default: 'pending' },
  expiresAt: Date,
}, { timestamps: true });

offerSchema.index({ stylistId: 1, clientId: 1, status: 1 }); // supports the cross-request "one active offer per client" check in step 7a
```

### 3. Request endpoints
- `POST /requests` — client only. Four checks before creation, all re-stated explicitly here since it's easy to assume an earlier phase already enforces them and quietly drop one:
  1. **The requesting client's own `verification.status === 'verified'`** — check `req.user`'s own verification.
  2. The target `stylistId` refers to a `User` with `role: 'stylist'` and `verification.status === 'verified'`.
  3. The target `stylistId` has a **completed `StylistProfile`** (`StylistProfile.findOne({ userId: stylistId })` exists).
  4. `title` (required, non-empty) and `budgetRange` (optional `{ min, max }`, must be positive numbers >= 100 with min <= max if provided) validate normally.
  Sets `expiresAt = now + REQUEST_EXPIRY_HOURS` (default 48h, configurable constant — see step 3b). **Daily cap: 2 requests per calendar day per client** (see step 3a) — checked before creation.
- `GET /requests/mine` — client's own requests (QueryBuilder for pagination/status filter).
- `GET /requests/incoming` — stylist's view of requests sent to them.
- `PATCH /requests/:id/cancel` — client cancels while still `pending`.

### 3a. Daily request & offer caps (business rules, not HTTP rate-limiters)
Caps are enforced at domain level in `BUSINESS_TIMEZONE` (`'Africa/Cairo'`):
1. **Client Daily Request Cap:** A client can create at most **2 requests per calendar day**. Count all requests created that calendar day regardless of eventual status (`pending`, `cancelled`, `expired`). If reached → reject with `403` (`"Daily request limit reached (2/day). Try again tomorrow."`).
2. **Stylist Daily Offer Cap:** A stylist can send at most **5 offers per calendar day** (`Offer.countDocuments({ stylistId, createdAt: { $gte: startOfBusinessDay, $lt: endOfBusinessDay } })`). If reached → reject with `403` (`"Daily offer limit reached (5/day). Try again tomorrow."`).

### 3b. Stylist decline + request auto-expiry
Since `Request.stylistId` targets exactly one stylist (no broadcast/reassignment — that would be a bigger redesign than this project needs right now), there must be a way to resolve a request the targeted stylist never acts on:
- `PATCH /requests/:id/decline` — stylist only, request must belong to them and be `pending` → sets `status: 'rejected'`, emits `RequestDeclined`. Lets a stylist explicitly signal "not taking this" instead of the client waiting indefinitely.
- **Auto-expiry**: `Request.expiresAt` (set at creation, step 3) is checked the same two-layer way as `Offer.expiresAt` (step 5) — lazily on read, and proactively swept by Phase 12's background job. A `pending` request whose `expiresAt` has passed with no offer and no decline flips to `status: 'expired'`.
- Either outcome (`'rejected'` via decline, or `'expired'` via timeout) still counts toward that day's request cap (step 3a) — the client can create a new request (against the same or a different stylist), subject to their remaining daily allowance.

### 4. Offer endpoints
- `POST /requests/:id/offers` — stylist only; request must belong to them and be `pending`. **Re-check the sending stylist's own `verification.status === 'verified'`** here too. Enforce the **Stylist Daily Offer Cap (5/day)** and **"one active offer per client"** rules. Sets `expiresAt = now + 24h` (configurable); sets request status → `offered`; copies `clientId` from the parent `Request` onto the new `Offer` (see step 7a).
- `PATCH /offers/:id/accept` — client only, owner of the parent request; **do not** create the booking here — this endpoint only flips offer/request status; actual booking creation with the transaction happens in Phase 5's service, triggered by the `OfferAccepted` event (or called directly from this service — see note below).
- `PATCH /offers/:id/reject` — client only.
- `PATCH /offers/:id/accept` — client only, owner of the parent request; **do not** create the booking here — this endpoint only flips offer/request status; actual booking creation with the transaction happens in Phase 5's service, triggered by the `OfferAccepted` event (or called directly from this service — see note below).
- `PATCH /offers/:id/reject` — client only.

> **Design decision:** Offer acceptance and booking creation are tightly coupled and must be atomic together (see Phase 5). Keep them as **one service call inside one transaction**, not two decoupled event-driven steps — domain events are for *side effects* (notifications, audit log), not for the core write itself. `offer.service.js#acceptOffer()` calls into `booking.service.js#createBookingFromOffer()` directly, inside the same transaction/session.

### 5. Offer & request expiry enforcement
Same two layers, applied to both `Offer.expiresAt` (24h) and `Request.expiresAt` (48h, step 3b):
1. **On read**: any query/service that loads an offer or a `pending` request checks `expiresAt < now` and, if so, lazily marks it `expired` before returning (cheap, no cron dependency).
2. **Background job** (Phase 12): a BullMQ repeating job sweeps expired offers *and* expired requests proactively, so nothing sits in `offered`/`pending` forever even with no traffic. Stub the job file now with a `// TODO: Phase 12` comment; the sweeping logic itself (`offer.service.js#expireOldOffers()` and `request.service.js#expireOldRequests()`) can be written now since it's pure business logic independent of BullMQ.

### 6. Domain events
Define and emit: `RequestCreated`, `RequestDeclined`, `RequestExpired`, `OfferCreated`, `OfferAccepted`, `OfferRejected`, `OfferExpired`. Nothing needs to listen yet except Phase 10 (audit log) and Phase 7 (notifications) — those listeners get added in their own phases, not here. Emitting now with no listener is safe and correct.

### 7. Validation rules to enforce in the service layer
- A stylist cannot send more than one active offer per request. (Note: since `Request.stylistId` already targets one specific stylist at creation, this is trivially satisfied per-request by construction — see step 7a for the rule that actually matters in this data model.)
- Expired offers cannot be accepted — re-check `expiresAt` at accept-time even if the read-layer already marked it, to close race conditions.
- A client cannot accept an offer belonging to someone else's request.

### 7a. Cross-request "one active offer per client" rule
A stylist can hold many simultaneous active offers overall (different clients, different requests) but **only one active (`pending`) offer open with any given client at a time**, even across that client's different requests. Before creating a new offer (`POST /requests/:id/offers`), check:
```js
const existingActive = await Offer.findOne({ stylistId: req.user.id, clientId: request.clientId, status: 'pending' });
if (existingActive) throw new ApiError(409, 'You already have an active offer with this client.');
```
The `{ stylistId, clientId, status }` index from step 2 makes this a cheap indexed lookup, not a join. Once that active offer is accepted/rejected/expired (no longer `pending`), the stylist is free to send a new offer to that same client on a different request.

---

## Definition of Done

- [x] Full happy path: create request → stylist sends offer → client accepts → statuses update correctly on both `Request` and `Offer`.
- [x] Creating a request without `title` returns a validation error; `budget` is accepted when omitted and rejected when negative/non-numeric.
- [x] An unverified client (or a client targeting an unverified stylist, or a stylist with no completed `StylistProfile`) is blocked from creating/receiving a request with a clear error, not a silent pass-through.
- [x] An unverified stylist is blocked from sending an offer, even if their `StylistProfile` and target request are otherwise valid.
- [x] A client's 3rd request within the same `BUSINESS_TIMEZONE` calendar day is rejected with `403`; a request created just after the day boundary (test with mocked/adjusted dates) succeeds again.
- [x] Cancelling/declining/letting a request expire does **not** free up the daily cap — it still counts toward that day's 2.
- [x] `PATCH /requests/:id/decline` only works for the targeted stylist on a `pending` request, transitions it to `rejected`, and emits `RequestDeclined`.
- [x] A `pending` request past its `expiresAt` with no offer/decline auto-transitions to `expired` (lazy-read and sweep-job paths both tested) and emits `RequestExpired`.
- [x] A stylist with a pending offer to Client A on Request 1 gets `409` attempting a second offer to Client A on a *different* Request 2; the same stylist can freely offer on requests from Client B in parallel.
- [x] Once the Request 1 offer to Client A is rejected/expired, the same stylist can successfully offer again to Client A (on Request 2 or a new request).
- [x] Rejecting an offer transitions the Request back to `pending` status, resetting its `expiresAt` window — allowing the same targeted stylist to re-offer or explicitly decline. The "one active offer per stylist per request" rule still applies, but a *rejected* offer is no longer active so re-offering is permitted. (There is no reassignment to a *different* stylist — the request stays targeted at the one stylist it was created for.)
- [x] Accepting an expired offer returns a clear `400`/`410` error, not a silent success.
- [x] Only the owning stylist can send an offer or decline on a given request; only the owning client can accept/reject.
- [x] `expireOldOffers()` and `expireOldRequests()` correctly transition old offers/requests in a unit test using mocked dates.
- [x] Integration test for the full request→offer→accept flow.
- [x] Every new route in this phase has an @swagger JSDoc block covering summary, request body, and response codes; /api/docs renders it without errors.
