# Murafiq — Money & Financial Ledger Reference

This document defines the financial lifecycle of funds in Murafiq: escrow collection, commission arithmetic, cancellation refund schedules, dispute arbitration writes, and batch payout disbursements.

---

## 1. Core Financial Rules & Invariants

1. **The `Payment` Record is the Single Source of Truth for Ledger Math.** Payout amounts are **never** calculated on the fly as `Booking.price * 0.85`. They are strictly read from `Payment.stylistPayoutAmount` after any refund adjustments.
2. **2-Decimal Rounding Invariance:** All monetary calculations use `round2(num)` (`Math.round((Number(num) + Number.EPSILON) * 100) / 100`) to prevent floating-point drift in EGP currency.
3. **Escrow Invariant:** When a client pays for a booking, the funds are held by the platform. The stylist's earnings become eligible for disbursement only after **Session Completion** AND the expiration of the **48-Hour Dispute Window** (`DISPUTE_WINDOW_HOURS = 48`).

---

## 2. Commission & Fee Breakdown

The standard platform commission is **15%** (`PLATFORM_FEE_PERCENTAGE = 15`):

$$\text{Gross Amount} = \text{Offer.price}$$
$$\text{Platform Fee} = \text{round2}(\text{Gross Amount} \times 0.15)$$
$$\text{Stylist Payout Amount} = \text{round2}(\text{Gross Amount} - \text{Platform Fee})$$

*Example on a 1,000 EGP booking:*
- Gross Amount: `1000.00 EGP`
- Platform Fee (15%): `150.00 EGP`
- Stylist Net Payout (85%): `850.00 EGP`

---

## 3. Cancellation Policy & Refund Tiers

Refunds upon cancellation depend strictly on the **cancelling party** and the **time remaining before scheduled start**. The boundary constant is `CANCELLATION_POLICY.EARLY_HOURS = 24` in `statuses.constant.js`.

> **Corrected 2026-09-11.** This section previously described a pre-revision 100%/75%
> policy that no longer matches the code (`booking.service.js` `calculateCancellationOutcome`,
> `statuses.constant.js` `CANCELLATION_POLICY`). The Business Rules Revision's Stage R6
> (Cancellation, Refunds & Penalties) changed the client tiers and added a stylist penalty;
> that landed in the code but this doc was never updated to match, which is exactly the kind
> of drift `docs/AUDIT_2026_09_FULL_SYSTEM.md` finding X24 flags as its highest-consequence
> documentation defect — a future "fix the code to match the doc" edit would have reverted
> live refund percentages. The numbers below are read directly from the current constants.

### Client Cancellations:
- **≥ 24 hours before start** (`hoursUntilSession >= CANCELLATION_POLICY.EARLY_HOURS`):
  **97% refund** to client, platform keeps **3%** (`CANCELLATION_POLICY.EARLY_CLIENT_REFUND_PERCENTAGE` / `EARLY_PLATFORM_FEE_PERCENTAGE`).
  - `Payment.status = 'refunded'` (refund percentage < 100 is what makes a refund "partial"; 97% still fully closes the payment)
  - `Payment.refundAmount = 970.00`
  - `Payment.platformFeeAmount = 30.00`
  - `Payment.stylistPayoutAmount = 0.00` — the stylist has not yet travelled and receives nothing from this booking's payment.
- **< 24 hours before start**: **80% refund** to client, platform keeps **20%**
  (`CANCELLATION_POLICY.LATE_CLIENT_REFUND_PERCENTAGE` / `LATE_PLATFORM_FEE_PERCENTAGE`).
  - `Payment.status = 'partially_refunded'`
  - `Payment.refundAmount = 800.00`
  - `Payment.platformFeeAmount = 200.00`
  - `Payment.stylistPayoutAmount = 0.00`

### Stylist Cancellations:
The client is always refunded **100%**, regardless of timing — the stylist never lets the
client bear the cost of their own cancellation. The stylist instead accrues a **penalty**
(a `Penalty` document plus a paired ledger debit, settled against a future payout — this is
separate money from the refund above, not a split of it):
- **≥ 24 hours before start:** penalty = **3%** of the session price
  (`CANCELLATION_POLICY.EARLY_STYLIST_PENALTY_PERCENTAGE`).
- **< 24 hours before start:** penalty = **20%** of the session price
  (`CANCELLATION_POLICY.LATE_STYLIST_PENALTY_PERCENTAGE`), and the client becomes eligible
  for a goodwill coupon.
  - `Payment.status = 'refunded'`, `Payment.refundAmount = 1000.00`, `Payment.stylistPayoutAmount = 0.00` either way.
  - Stylist's `cancelledSessions` counter increments on their `StylistProfile`.

---

## 4. Dispute Resolution Accounting

When an admin arbitrates an active dispute via `PATCH /api/v1/admin/bookings/:id/resolve-dispute`:

1. **Outcome: `cancelled` (Full or High Partial Refund):**
   - Triggers `paymentService.processRefund({ refundPercentage: 100, reason })`.
   - `Payment.status` transitions to `'refunded'`.
   - `Booking.status` transitions to `'cancelled'`.
   - Booking is permanently excluded from stylist payout batches.
2. **Outcome: `completed` with Custom Partial Refund (e.g. 25% refund for shortened session):**
   - Triggers `paymentService.processRefund({ refundPercentage: 25, reason })`.
   - `Payment.status` transitions to `'partially_refunded'`.
   - `Payment.refundAmount = 250.00`.
   - `Payment.stylistPayoutAmount` is adjusted to $750 \times 0.85 = 637.50\text{ EGP}$.
   - Once the 48h hold elapses, the remaining $637.50\text{ EGP}$ is eligible for disbursement.

---

## 5. Payout Lifecycle & Batch Disbursement

```
[ Session Completed ] ──> (48h Escrow Hold) ──> [ Eligible for Payout ]
                                                        │
                                                        ▼ Admin Generates Batch
                                              [ Payout: 'pending' ]
                                              (Booking: 'processing')
                                                        │
                                                        ▼ Admin Initiates Transfer
                                             [ Payout: 'processing' ]
                                                        │
                                 ┌──────────────────────┴──────────────────────┐
                                 ▼ Transfer Confirmed                          ▼ Transfer Failed
                        [ Payout: 'paid' ]                            [ Payout: 'failed' ]
                       (Booking: 'paid')                             (Booking: 'unpaid')
```

- **Idempotency & Double-Disbursement Guards:**
  - Transitioning a payout from `pending` $\rightarrow$ `processing` is state-guarded at the service layer; transitioning to `paid` is atomically committed across collections (`Payout`, `Booking`, `LedgerEntry`) in a Mongoose transaction.
  - Bookings are marked with `payoutStatus: 'processing'` and `payoutId: payout._id` upon batch creation, locking them from being included in concurrent batches.
  - If a payout is marked `failed`, bookings are automatically released back to `payoutStatus: 'unpaid'` for re-batching.
