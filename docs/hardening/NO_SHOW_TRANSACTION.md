# `resolveNoShow` — Multiple Writes Without a Mongoose Transaction

## Status
DEFERRED — NOT FIXED

## Priority
HIGH

## Why It Was Deferred
The pre-Phase-15 fix pass corrected the *specific, verified money bug* inside
this function — `processRefund` was unconditionally zeroing the stylist's payout
share on a client no-show, contradicting `NO_SHOW_POLICY.CLIENT`'s documented 20%
stylist compensation — and paired the `PENALTY_ASSESSMENT` ledger entry this
function posts so it is no longer single-sided. Wrapping the *entire* function in
a database transaction is a larger, structurally different change (every write
inside it needs a `session` threaded through, including calls into
`paymentService.processRefund`, `couponService.issueCoupon`, and
`reliabilityService.updateStylistReliability`, each of which has its own
transaction-boundary implications) and was not part of the scoped fix list for
that pass. Fixing the specific miscalculation was higher-value and lower-risk
than restructuring the whole function's transaction boundary in the same change.

## Current Problem
`resolveNoShow` is the only function in the booking module that both moves money
and touches this many collections, and it does so as a sequence of independent,
un-sessioned writes:

1. `scheduleRepository.deleteByBookingId(bookingId)`
2. `bookingRepository.updateById(bookingId, { status, 'noShowDetails.confirmedAt',
   payoutStatus, ... })`
3. `paymentRepository.findByBookingId` + `paymentService.processRefund(...)`
   (client refund + stylist compensation, itself posting ledger entries)
4. `penaltyRepository.create(...)` + a paired `ledgerService.postDoubleEntry(...)`
   (stylist no-show penalty, when applicable)
5. `couponService.issueCoupon(...)` (client goodwill coupon, when applicable)
6. `reliabilityService.updateStylistReliability(...)` (when the stylist is the
   no-show party)

No `mongoose.startSession()` / `withTransaction` wraps any of this. Each step is
individually try/caught and logged rather than rolled back together.

## Evidence
- `src/modules/bookings/no-show.service.js` — `resolveNoShow`, the full function
  body. `grep -n "session" src/modules/bookings/no-show.service.js` returns no
  transaction-related matches.
- Contrast: `src/modules/bookings/booking.service.js` — `cancelBooking` already
  wraps its schedule-delete + booking-update + penalty-create sequence in a real
  `mongoose.startSession()` / `session.startTransaction()` block with a
  `readyState !== 1` fallback for test environments. `resolveNoShow` is the
  project's own established pattern, just not applied here.

## Risk / Impact
If a write partway through this sequence throws (e.g. a transient MongoDB error,
a validation failure, a downstream service outage), the booking can be left in a
partially-updated state: for example, the schedule slot freed and the booking
status flipped, but the client's refund never issued, or the refund issued but
the stylist's compensation share never recorded. Each individual write already
carries its own try/catch and idempotency key where money is involved (refund
ledger keys, penalty's unique `{bookingId, reasonType}` index), which limits — but
does not eliminate — the risk of a genuinely inconsistent end state, since a
retry of `resolveNoShow` after a partial failure re-reads the booking and may
take a different branch depending on what already landed.

## Expected Future Fix
Wrap the full function body in a `mongoose.startSession()` /
`session.withTransaction()` block, following the exact pattern already
established in `cancelBooking`, including its `readyState !== 1` fallback for
non-replica-set test environments. Every repository/service call inside the
transaction needs its `session` parameter threaded through
(`paymentService.processRefund`, `couponService.issueCoupon`, and
`penaltyRepository.create`/`ledgerService.postDoubleEntry` already accept a
session parameter per the existing codebase convention — this is primarily a
matter of threading it through consistently, not adding new capability).
`reliabilityService.updateStylistReliability` is a read-then-write aggregate
recalculation and is a reasonable candidate to keep *outside* the transaction
(as `cancelBooking` and `resolveDispute` already do for the same call), since it
recomputes from committed state rather than being part of the atomic write set.

## Dependencies
- No phase dependency.
- Depends on the already-shipped session-parameter support in
  `paymentService.processRefund`, `couponService.issueCoupon`, and
  `ledgerService.postDoubleEntry`/`postEntry` — all already accept a `session`
  argument today, so no upstream API change is required.

## When To Fix
During Final Hardening (pre-production), before Phase 16.

## Verification Plan
- A test that forces a failure partway through `resolveNoShow` (e.g. mock
  `couponService.issueCoupon` to throw) and asserts the booking, payment, and
  penalty records are all rolled back to their pre-call state — not partially
  applied.
- Regression run of `tests/unit/no-show.service.test.js` (added in the
  pre-Phase-15 fix pass) to confirm the transaction wrapper does not change the
  function's existing behavior on the happy path.
- Confirm the `readyState !== 1` fallback still allows the function to run
  correctly in the existing (non-replica-set) unit-test harness.

## Status Checklist
- [ ] Issue fixed
- [ ] Tests added/updated
- [ ] Regression verified
- [ ] Documentation updated
