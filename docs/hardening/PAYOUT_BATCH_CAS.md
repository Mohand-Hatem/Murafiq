# Payout Batch — Missing CAS Guard on `payoutStatus`

## Status
DEFERRED — NOT FIXED

## Priority
HIGH

## Why It Was Deferred
The pre-Phase-15 audit fix pass addressed the payout module's two exploitable
authorization bugs (payout-account takeover, cross-tenant payout leak) and the
money-correctness bugs in `markPaid`/`markFailed` (hardcoded `* 0.85`, missing
platform-fee recognition, lost penalty settlements on failure). This specific gap —
a missing compare-and-swap guard when bookings are locked into a batch — is a
**narrower concurrency edge case** that requires two admins (or one admin double-
submitting) to create overlapping batches for the *same stylist* within the same
race window. It does not block Phase 15 and was not part of the explicitly scoped
fix list for that pass.

## Current Problem
`createBatchPayouts` marks the bookings it is about to pay out as `payoutStatus:
'processing'` via an unconditional `updateMany`, with no filter re-asserting that
those bookings are still `'unpaid'` at the moment of the write:

```js
export const updateManyPayoutStatus = async (bookingIds, data, session = null) => {
  const options = session ? { session } : {};
  return Booking.updateMany({ _id: { $in: bookingIds } }, data, options);
};
```

There is no `payoutStatus: 'unpaid'` clause in the filter. Two concurrent
`createBatchPayouts` calls for the same stylist can both read the same set of
eligible bookings (via `getEligibleBookingsForStylist`) before either write lands,
and both then successfully flip those bookings to `'processing'` — because the
`updateMany` has nothing to fail against.

## Evidence
- `src/modules/bookings/booking.repository.js` — `updateManyPayoutStatus` (no
  `payoutStatus` filter in the query).
- `src/modules/payouts/payout.service.js` — `createBatchPayouts`, the call site
  that locks bookings into a batch via `bookingRepository.updateManyPayoutStatus(
  bookingIds, { payoutStatus: 'processing', payoutId: payout._id }, session)`.
- `src/modules/payouts/payout.repository.js` — `getEligibleBookingsForStylist`,
  the read that both concurrent admin actions would see identically before either
  write commits.
- Contrast: `src/modules/requests/request.repository.js` — `lockAndAccept` is the
  project's own existing CAS pattern (`{_id, status: 'OPEN'}` filter) for exactly
  this class of "read eligible set, then lock it" race.

## Risk / Impact
Two `Payout` documents could reference overlapping `bookingIds`, each carrying its
own `payoutAccountDetails` snapshot and its own set of ledger entries
(`ESCROW_RELEASE` / `PAYOUT_DISBURSEMENT`, keyed by `payout:escrow:${payoutId}:
${bookingId}` — so the two payouts' ledger entries would NOT collide on
idempotency key, since each carries a different `payoutId`). In the worst case
this means the same booking's stylist share is disbursed twice — real money paid
out twice for one booking — if both resulting `Payout` records are later marked
`paid`.

This requires two admin actions to race within the same narrow window (the gap
between the eligibility read and the lock write), which in practice means either
two admins acting on the same stylist simultaneously, or a client-side double-
submit of the batch-creation request. Low likelihood under normal admin-console
usage, but the blast radius if it happens is a real double-disbursement.

## Expected Future Fix
Add `payoutStatus: 'unpaid'` to `updateManyPayoutStatus`'s filter, and switch from
`updateMany` to a pattern that can detect a partial match (e.g. compare
`modifiedCount` against `bookingIds.length`, or re-fetch and diff), so
`createBatchPayouts` can fail closed — abort the whole batch, not silently
disburse against a subset — when another concurrent batch has already claimed
some of the same bookings. This mirrors the existing `lockAndAccept` CAS pattern
already used for request/offer acceptance elsewhere in the codebase.

## Dependencies
- No phase dependency. Pure application-layer fix inside the already-shipped
  payouts module (Phase 11 business gap / built in the Business Rules Revision).
- Should land together with, or after, `PAYOUT_N_PLUS_1.md` and
  `PAYOUT_PREVIEW_CALCULATION.md` since all three touch the same payout-creation
  code path and a combined review avoids re-opening the same functions twice.

## When To Fix
During Final Hardening (pre-production), before Phase 16.

## Verification Plan
- Unit/integration test that races two `createBatchPayouts(adminUserId, {
  stylistIds: [sameStylistId] })` calls (matching the existing pattern in
  `tests/integration/booking.broadcast-race.test.js`) and asserts exactly one
  batch succeeds with the full booking set, and the second either fails cleanly
  or claims zero overlapping bookings.
- Assert no booking ever appears in `bookingIds` on two different `Payout`
  documents simultaneously in `'processing'` or `'paid'` status.
- Full regression run of the existing payout test suite
  (`payout.service.test.js`, `payout.repository.test.js`, `payout.netting.test.js`,
  `payout.authorization.test.js`) to confirm no behavior change on the
  non-concurrent happy path.

## Status Checklist
- [ ] Issue fixed
- [ ] Tests added/updated
- [ ] Regression verified
- [ ] Documentation updated
