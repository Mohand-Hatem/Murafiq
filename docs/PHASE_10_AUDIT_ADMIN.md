# Phase 10 — Audit Log & Admin Module

## Goal
A cross-cutting audit trail driven entirely by the event bus (no module manually calls "log this"), plus the full admin surface for managing verifications, disputes, and platform oversight.

## Depends on
Phases 1–8 (needs all the domain events already being emitted).

---

## Steps

### 1. `audit-log.model.js`
```js
const auditLogSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  entity: String,       // 'Booking', 'Offer', 'User', etc.
  action: String,       // 'created', 'accepted', 'verified', etc.
  entityId: Schema.Types.ObjectId,
  ipAddress: String,
  userAgent: String,
  metadata: Schema.Types.Mixed,
}, { timestamps: true });
```

### 2. Central listener (`audit-log.listener.js`)
Instead of scattering `auditLogService.log(...)` calls across every module, subscribe **once** to every relevant event name and map it to a log entry:
```js
const AUDIT_EVENT_MAP = {
  [EVENTS.USER_REGISTERED]: { entity: 'User', action: 'register' },
  [EVENTS.USER_VERIFIED]: { entity: 'User', action: 'verified' },
  [EVENTS.USER_VERIFICATION_REJECTED]: { entity: 'User', action: 'verification_rejected' },
  [EVENTS.REQUEST_CREATED]: { entity: 'Request', action: 'created' },
  [EVENTS.OFFER_ACCEPTED]: { entity: 'Offer', action: 'accepted' },
  [EVENTS.BOOKING_CREATED]: { entity: 'Booking', action: 'created' },
  [EVENTS.PAYMENT_SUCCEEDED]: { entity: 'Payment', action: 'succeeded' },
  [EVENTS.REVIEW_SUBMITTED]: { entity: 'Review', action: 'created' },
  // Money and dispute events — the most trust-sensitive actions on the platform, must not be an afterthought:
  [EVENTS.PAYMENT_REFUNDED]: { entity: 'Payment', action: 'refunded' },
  [EVENTS.SESSION_COMPLETED]: { entity: 'Booking', action: 'completed' },
  [EVENTS.SESSION_DISPUTED]: { entity: 'Booking', action: 'disputed' },
  [EVENTS.BOOKING_CANCELLED]: { entity: 'Booking', action: 'cancelled' },
  // Admin actions on users/content — audit-critical, wired the same declarative way rather than ad-hoc log calls:
  [EVENTS.USER_SUSPENDED]: { entity: 'User', action: 'suspended' },
  [EVENTS.USER_REACTIVATED]: { entity: 'User', action: 'reactivated' },
  [EVENTS.DISPUTE_RESOLVED]: { entity: 'Booking', action: 'dispute_resolved' },
  [EVENTS.REVIEW_HIDDEN]: { entity: 'Review', action: 'hidden' },
  [EVENTS.REVIEW_UNHIDDEN]: { entity: 'Review', action: 'unhidden' },
  // Payout status transitions — there is no single PAYOUT_STATUS_CHANGED event; payout.service.js
  // emits one granular event per transition instead, so each is mapped individually:
  [EVENTS.PAYOUT_CREATED]: { entity: 'Payout', action: 'created' },
  [EVENTS.PAYOUT_PROCESSING]: { entity: 'Payout', action: 'processing' },
  [EVENTS.PAYOUT_PAID]: { entity: 'Payout', action: 'paid' },
  [EVENTS.PAYOUT_FAILED]: { entity: 'Payout', action: 'failed' },
};

Object.entries(AUDIT_EVENT_MAP).forEach(([eventName, meta]) => {
  eventBus.on(eventName, (payload) => auditLogService.log({ ...meta, ...payload }));
});
```
> **Every key above must exist in `src/common/constants/events.constant.js` — that file is the
> authority, not this list.** `EVENTS.X` for an undefined key silently evaluates to `undefined`, and
> `EventEmitter` accepts `undefined` as a valid event name, so a typo'd or invented key here doesn't
> throw — it just registers a listener that will never fire, or worse, collides with every other
> mistyped key onto the same channel. `tests/unit/event-graph.test.js` catches a listener with no
> matching emitter, but confirm against the real constants file before writing code, not after.

> **Extend this map, don't bypass it:** every phase that adds a new admin-facing or money-affecting action from here on should add its event here rather than calling `auditLogService.log()` directly — this list was originally left incomplete when Phases 11/12 added new admin actions after this file was written; closing that gap is exactly why this section now lists all of them up front.

> **Constraint**: `ipAddress`/`userAgent` aren't available inside a plain domain-event payload (no `req` object at that point). Either (a) attach them to the event payload at emit-time from the controller layer where `req` is available, or (b) accept that IP/UA are only captured for actions logged directly from a controller/middleware (e.g. login) rather than from deep service-layer events. Recommended: pass `{ ip, userAgent }` explicitly in the payload for security-sensitive events (login, password change, verification) and omit them for purely internal domain events.

### 3. Admin endpoints (`admin.controller.js`)
- `GET /admin/audit-logs` — QueryBuilder (filter by entity/action/user/date range).
- `GET /admin/users` — list/search all users.
- `PATCH /admin/users/:id/suspend` / `/reactivate` — sets `accountStatus`, emits `UserSuspended` / `UserReactivated` respectively (both in `AUDIT_EVENT_MAP` above).
- `GET /admin/verifications` (moved fully here from its Phase 2 stub location if it was left inline)
- `GET /admin/bookings/disputed` — list bookings with `status: 'disputed'` (filed via `POST /bookings/:id/dispute`, `PHASE_05_BOOKINGS_SCHEDULING.md` step 4a — that endpoint is the entry point, this is the exit point).
- `PATCH /admin/bookings/:id/resolve-dispute` — admin manually sets outcome, body: `{ outcome: 'completed' | 'cancelled', refundPercentage? }`. Always emits `DisputeResolved` first (audit record of the admin action itself, regardless of outcome), then, depending on `outcome`:
  - `'completed'` (session genuinely happened, dispute was e.g. a quality complaint that doesn't warrant a refund) → sets `Booking.status = 'completed'`, emits `SessionCompleted` — this is what Phase 11's payout-eligibility aggregation actually listens for, so a dispute resolved this way becomes payable exactly like a normal mutual-confirmation completion.
  - `'cancelled'` (e.g. confirmed no-show, or stylist genuinely didn't show) → sets `Booking.status = 'cancelled'`, calls `payment.service.js#refund()` with the admin-specified `refundPercentage` (defaults to the table in Phase 5 step 5 based on `reason`/`type` from the original dispute filing, but admin can override), emits `BookingCancelled` and `PaymentRefunded`.
  - Either outcome must additionally be one of these two events — a dispute can never resolve into a payout-eligible state without going through this explicit branch, closing the gap where dispute resolution and payout eligibility used to be disconnected.
- `GET /admin/dashboard/stats` — basic counts (total users, active bookings, revenue this month, pending verifications) — simple aggregation queries, not a separate analytics service.
- `PATCH /admin/reviews/:id/hide` — a single toggle route, body `{ isHidden: boolean }` (default `true`), not two separate `hide`/`unhide` routes. Sets `Review.isHidden`, emits `REVIEW_HIDDEN` when `true` and `REVIEW_UNHIDDEN` when `false` (both in `AUDIT_EVENT_MAP` above) — this is the only admin remedy for a bad review otherwise requiring a manual DB edit. Triggers `PHASE_08_REVIEWS.md` step 3's rating-recalculation for the affected `revieweeId`/`direction` so the change takes effect immediately. **Do not add a separate `/unhide` route** — `04_ROUTES.md` previously listed one; the capability already exists via the boolean and a second route would be redundant.

### 4. Admin-only middleware (with operator carve-out)
All routes in this module go through `authMiddleware` + `restrictTo('admin')` at the router level, not per-controller-function — **with one exception**: the three identity-verification routes (`GET /admin/verifications`, `PATCH /admin/verifications/:userId/approve`, `PATCH /admin/verifications/:userId/reject`) use `restrictTo('admin', 'operator')` instead. These are the only routes an `operator` can access. An operator has no create, update, or delete capability beyond approving/rejecting verifications. All other `/admin/*` routes remain admin-only.

---

## Definition of Done

- [ ] Every event in `AUDIT_EVENT_MAP` produces exactly one audit log entry when triggered end-to-end.
- [ ] Login/password-change audit entries correctly capture IP + User-Agent.
- [ ] Non-admin token on any `/admin/*` route → `403` uniformly.
- [ ] Resolving a dispute as `'completed'` emits `SessionCompleted` and the booking subsequently appears in Phase 11's pending-payout-balances aggregation; resolving as `'cancelled'` triggers a refund via `payment.service.js` for the correct (default or admin-overridden) percentage and emits `BookingCancelled` + `PaymentRefunded`.
- [ ] Dashboard stats endpoint returns correct counts against seeded test data.
- [ ] Hiding a review removes it from public listing and its rating average immediately; unhiding restores both.
- [ ] Every new route in this phase has an @swagger JSDoc block covering summary, request body, and response codes; /api/docs renders it without errors.
