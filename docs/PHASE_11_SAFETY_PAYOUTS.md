# Phase 11 — Safety (SOS/Check-in) & Payouts

## Goal
The two modules that came out of the earlier risk discussion: a minimal offline-meetup safety layer, and a manual (but fully tracked) stylist payout system.

## Depends on
Phase 6 (Payment → `stylistPayoutAmount`), Phase 5 (`checkInAt` already on Booking).

---

## Part A — Safety Module

### 1. `safety-report.model.js`
```js
const safetyReportSchema = new Schema({
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
  reportedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['sos', 'report'], required: true },
  location: { lat: Number, lng: Number },
  description: String,
  status: { type: String, enum: ['open', 'reviewed', 'resolved'], default: 'open' },
}, { timestamps: true });
```

### 2. Endpoints
- `POST /safety/sos` — body: `{ bookingId, location }`. Fires immediately: creates the report **and** emits a high-priority notification straight to admin (bypass the normal notification queue — this should be near-instant).
- `POST /safety/report` — non-urgent report with `description`, reviewed by admin later (surfaced in Phase 10's admin module).
- `PATCH /bookings/:id/live-tracking` — toggles `liveTrackingEnabled` on the booking. This field is defined in Phase 5's `booking.model.js` (`liveTrackingEnabled: { type: Boolean, default: false }`) and is only activatable for bookings with status `in-progress`.
- Live location updates while tracking is enabled: piggyback on the same Firestore conversation document from Phase 7's chat system — write to `conversations/{bookingId}/liveLocation` (`{ lat, lng, updatedAt }`), scoped to the same participants and enforced by the same Security Rules already protecting that conversation. No separate infrastructure — reuses the chat module's Firestore setup instead of a Socket.io namespace.

### 3. Admin surface
Add to `admin.controller.js` (Phase 10): `GET /admin/safety-reports?status=open`, `PATCH /admin/safety-reports/:id/resolve`.

---

## Part B — Payouts Module (Manual, Fully Tracked)

### 1. `payout.model.js`
```js
const payoutSchema = new Schema({
  stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  bookingIds: [{ type: Schema.Types.ObjectId, ref: 'Booking' }],
  status: { type: String, enum: ['pending', 'processing', 'paid'], default: 'pending' },
  method: { type: String, enum: ['bank_transfer', 'vodafone_cash'] },
  reference: String,
  paidBy: { type: Schema.Types.ObjectId, ref: 'User' }, // admin who executed it
  paidAt: Date,
}, { timestamps: true });
```

### 2. Accumulating stylist balance
On `SessionCompleted` (booking fully confirmed by both parties in Phase 5, **or** a dispute resolved as `'completed'` in Phase 10) **and** `Payment.status === 'paid'`, the corresponding `stylistPayoutAmount` becomes eligible for payout. Don't create a `Payout` document per booking automatically — instead:
- `GET /admin/payouts/pending-balances` — aggregation grouping unpaid, eligible bookings by `stylistId`, summing `stylistPayoutAmount`. **Eligibility explicitly excludes** any booking where `Booking.status === 'disputed'` (an unresolved dispute) or where a linked `SafetyReport` (Part A below) has `status: 'open'` against that `bookingId` — a booking under active dispute or safety review must never surface as payable, even if it separately satisfies `SessionCompleted && Payment.status === 'paid'` from before the dispute/report was filed. Implement as an additional `$match`/`$lookup` exclusion stage in the aggregation, not a separate manual check.
- `POST /admin/payouts` — admin selects a stylist (and optionally specific eligible `bookingIds`), system creates one `Payout` batching them, status `pending`.
- `PATCH /admin/payouts/:id/mark-processing` / `/mark-paid` / `/mark-failed` — admin updates status manually after actually sending the bank transfer/Vodafone Cash outside the system. Each transition emits its own event — `EVENTS.PAYOUT_PROCESSING`, `EVENTS.PAYOUT_PAID`, `EVENTS.PAYOUT_FAILED` — **not** a single `PayoutStatusChanged` (no such event exists; `PHASE_10_AUDIT_ADMIN.md`'s `AUDIT_EVENT_MAP` maps all four granular payout events individually).
- `GET /stylists/me/payouts` — stylist's own payout history.

> **Note on route paths:** the routes above describe the intent; the implemented payouts module mounts everything under `/payouts` (e.g. `/payouts/admin/pending-balances`, `/payouts/admin/batch`, `/payouts/admin/:id/mark-paid`, `/payouts/mine`) rather than nesting admin actions under `/admin/*` or exposing `/stylists/me/payouts`. See `04_ROUTES.md`'s Payouts section for the exact, already-built paths — follow that, not the literal routes named in this file.

### 3. Preventing double-payout
Once a booking's `stylistPayoutAmount` is included in any non-cancelled `Payout`, mark it (`Booking.payoutStatus: 'included' | 'not_included'`, or a `payoutId` ref on Booking) so the "pending balances" aggregation excludes it going forward.

---

## Definition of Done — Safety

- [ ] SOS report reaches admin notification within the same request/response cycle (not queued/delayed).
- [ ] Live tracking toggle only works for active/in-progress bookings, not arbitrary ones.
- [ ] Non-participant of a booking cannot file a report or enable tracking for it.

## Definition of Done — Payouts

- [ ] Pending-balances aggregation correctly sums only eligible, non-included bookings per stylist.
- [ ] A booking with `status: 'disputed'`, or one with an `open` `SafetyReport` against it, never appears in the pending-balances aggregation even though `SessionCompleted`/`Payment.status: 'paid'` already fired — confirmed with a test booking in each state.
- [ ] Resolving that dispute as `'completed'` (Phase 10) or that safety report as `'resolved'` makes the booking reappear in the next aggregation run.
- [ ] Creating a payout correctly marks all included bookings so they don't appear in the next balance calculation.
- [ ] Payout status transitions (`pending → processing → paid`) are admin-only and logged to the audit trail.
- [ ] A stylist can see their own payout history but not another stylist's.
- [ ] Every new route in this phase has an @swagger JSDoc block covering summary, request body, and response codes; /api/docs renders it without errors.
