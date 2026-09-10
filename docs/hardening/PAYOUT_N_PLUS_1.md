# Payout Balances Preview — N+1 Query Pattern

## Status
DEFERRED — NOT FIXED (one related N+1 was already fixed elsewhere)

## Priority
LOW

## Why It Was Deferred
This is a performance issue, not a correctness or security one, and it does not
occur on the money-moving path — only on the admin-facing pending-balances
preview. The pre-Phase-15 fix pass already eliminated the N+1 pattern that *did*
sit on the money-moving path: `markPaid`'s original per-booking
`bookingRepository.findById()` loop (one query per booking in the payout) was
replaced with a single batched `paymentRepository.findByBookingIds(...)` call
followed by an in-memory `Map` lookup, as part of fixing the hardcoded `* 0.85`
calculation. **This document is scoped only to the remaining, separate N+1** in
the preview endpoint, which was out of scope for that fix (it required
addressing the hardcoded-percentage money bug, not a preview convenience
endpoint).

## Current Problem
`PayoutService.getPendingBalancesSummary` issues two additional database queries
*per stylist* inside a `Promise.all` map, after already fetching the aggregate
summary in one batched call:

```js
const summaries = await payoutRepository.getPendingBalancesSummary(cutoffDate); // 1 query total

const populated = await Promise.all(
  summaries.map(async (item) => {
    const profile = await stylistRepository.findByUserId(item.stylistId);       // N queries
    const outstandingPenalties = await penaltyRepository.findOutstandingByStylistId(
      item.stylistId
    );                                                                          // N queries
    ...
```

For a platform with many stylists carrying a pending balance, this is `1 + 2N`
queries for a single admin dashboard load, where a batched `$in` lookup (one
query for all stylist profiles, one for all outstanding penalties across all
those stylists) would suffice.

## Evidence
- `src/modules/payouts/payout.service.js` — `getPendingBalancesSummary`
  (~lines 41–63), the `Promise.all(summaries.map(async (item) => { ... }))`
  block.
- `src/modules/stylists/stylist.repository.js` — `findByUserId` (single-document
  lookup, called once per stylist in the loop above).
- `src/modules/penalties/penalty.repository.js` — `findOutstandingByStylistId`
  (single-stylist lookup, same pattern).
- Contrast: `markPaid` in the same file (`payout.service.js`) already
  demonstrates the batched pattern this should follow — see its
  `paymentRepository.findByBookingIds(payout.bookingIds, PAYABLE_PAYMENT_STATUSES)`
  call followed by a `Map` lookup inside the loop, fixed in the pre-Phase-15
  pass.

## Risk / Impact
Purely a latency/database-load concern on an admin dashboard endpoint. At
current expected scale (a two-sided marketplace in early growth) this is
unlikely to be user-visible, but it will degrade linearly as the number of
stylists with pending balances grows, and it is worth fixing using the same
batching pattern already proven correct elsewhere in this exact file.

## Expected Future Fix
Batch both lookups: fetch all relevant stylist profiles in one query (e.g. `$in:
summaries.map(s => s.stylistId)`) and all outstanding penalties across those
stylists in one query, then join in memory — mirroring the `markPaid` fix
already shipped in the same service file. This pairs naturally with
`PAYOUT_PREVIEW_CALCULATION.md`'s fix (extracting a shared netting function),
since both changes touch the same loop.

## Dependencies
- No phase dependency.
- Best done together with `PAYOUT_PREVIEW_CALCULATION.md`, since both fixes
  touch the exact same function and loop — doing them separately means opening
  and re-reviewing the same code twice.

## When To Fix
During Final Hardening (pre-production), bundled with
`PAYOUT_PREVIEW_CALCULATION.md`.

## Verification Plan
- A test seeding many stylists with pending balances and outstanding penalties,
  asserting `getPendingBalancesSummary` issues a constant (small) number of
  database queries regardless of stylist count, rather than scaling linearly.
- Confirm the returned summary data is unchanged in shape and values compared
  to the current per-stylist-loop implementation (a pure performance refactor,
  not a behavior change) — ideally reusing the same fixture data used for
  `PAYOUT_PREVIEW_CALCULATION.md`'s correctness fix.

## Status Checklist
- [ ] Issue fixed
- [ ] Tests added/updated
- [ ] Regression verified
- [ ] Documentation updated
