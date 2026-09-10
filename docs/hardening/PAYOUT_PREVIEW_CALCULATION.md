# Payout Preview — Calculation Diverges From Actual Batch Creation

## Status
DEFERRED — NOT FIXED

## Priority
MEDIUM

## Why It Was Deferred
This affects only the **admin-facing preview endpoint** (`GET
/payouts/admin/pending-balances`) — no money moves through this code path. The
actual disbursement path (`createBatchPayouts` / `markPaid`) was already
corrected in the pre-Phase-15 fix pass to read strictly from
`Payment.stylistPayoutAmount`/`.platformFeeAmount` and to net penalty debt in
integer piastres. The preview's inaccuracy is a display/planning problem for
admins, not a fund-movement risk, so it did not block Phase 15.

## Current Problem
Two independent implementations compute "what a stylist is owed" and they can
disagree:

**Preview** (`PayoutService.getPendingBalancesSummary`) computes the net amount
in floating-point EGP, and — more importantly — its penalty-debt subtraction is
a **simple total subtraction**, not the same deduction-per-penalty netting logic
`createBatchPayouts` actually applies:

```js
const outstandingPenaltyAmount = piastresToEgp(totalDebtMinor);
const grossAmount = item.totalAmount || 0;
const netAmount = Math.max(0, Math.round((grossAmount - outstandingPenaltyAmount) * 100) / 100);
```

**Actual batch creation** (`PayoutService.createBatchPayouts`, via
`payout.repository.js` `getEligibleBookingsForStylist`) computes gross in EGP,
converts once to integer piastres, then nets penalty debt in minor units,
oldest-debt-first, capped per-penalty:

```js
const grossAmountMinor = egpToPiastres(grossAmount);
remainingToDeductMinor = Math.min(grossAmountMinor, totalDebtMinor);
// ...oldest-debt-first loop, capped per penalty (payout.service.js ~104-135)
const netPayoutMinor = grossAmountMinor - totalDeductedMinor;
```

Both arrive at "gross minus outstanding debt," but via different arithmetic
domains (float EGP vs. integer piastres) and different clamping semantics (one
global `Math.max(0, ...)` vs. a per-penalty capped loop). They are not
guaranteed to produce the same number, especially once multiple penalties with
different remaining balances are involved.

## Evidence
- `src/modules/payouts/payout.service.js` — `getPendingBalancesSummary` (float
  computation, lines ~41–63).
- `src/modules/payouts/payout.service.js` — `createBatchPayouts` (integer-piastre
  netting, lines ~79–140).
- `src/modules/payouts/payout.repository.js` — `getEligibleBookingsForStylist`
  (the gross-amount source both paths ultimately derive from, but which they
  process differently downstream).

## Risk / Impact
An admin reviewing the pending-balances dashboard before deciding whether/when to
run a batch could see a number that does not match what the batch actually pays
once created — potentially a source of confusion or mistaken business decisions
(e.g. under- or over-estimating a stylist's payable balance, or misjudging how
much of a debt a given payout will actually collect). No direct fund-movement
risk: the batch's own calculation is authoritative and unaffected by this
mismatch.

## Expected Future Fix
Extract the actual netting logic `createBatchPayouts` uses (gross → integer
piastres → oldest-debt-first capped deduction) into a shared, pure function that
both the preview and the real batch-creation path call — so there is exactly one
implementation of "what does this stylist actually net," not two. The preview
would then report the number that will be created if a batch is run right now,
not an approximation of it.

## Dependencies
- No phase dependency.
- Best done together with `PAYOUT_N_PLUS_1.md`, since extracting the shared
  netting function is also the natural place to address the preview's N+1 query
  pattern.

## When To Fix
During Final Hardening (pre-production), before Phase 16.

## Verification Plan
- A test that seeds a stylist with multiple bookings and multiple outstanding
  penalties of varying amounts, calls both `getPendingBalancesSummary` and
  `createBatchPayouts`, and asserts the preview's `netAmount` for that stylist
  equals the `amount` on the `Payout` document the batch actually creates.
- Regression run of `payout.netting.test.js` (the existing suite covering the
  integer-piastre deduction logic) to confirm the extracted shared function
  preserves current netting behavior exactly.

## Status Checklist
- [ ] Issue fixed
- [ ] Tests added/updated
- [ ] Regression verified
- [ ] Documentation updated
