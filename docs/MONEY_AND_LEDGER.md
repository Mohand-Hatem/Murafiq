# Murafiq — Money & Financial Ledger Reference

This document defines the financial lifecycle of funds in Murafiq: escrow collection, commission arithmetic, cancellation refund schedules, dispute arbitration writes, and batch payout disbursements.

---

## 1. Core Financial Rules & Invariants

1. **The `Payment` Record is the Single Source of Truth for Ledger Math.** Payout amounts are **never** calculated on the fly as `Booking.price * 0.85`. They are strictly read from `Payment.stylistPayoutAmount` after any refund adjustments.
2. **2-Decimal Rounding Invariance:** All monetary calculations use `round2(num)` (`Math.round(num * 100) / 100`) to prevent floating-point drift in EGP currency.
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

Refunds upon cancellation depend strictly on the **cancelling party** and the **time remaining before scheduled start**. The boundary constant is `CANCELLATION_POLICY.FULL_REFUND_HOURS = 24` in `statuses.constant.js`.

> **Note:** These percentages describe the policy **currently implemented** in `booking.service.js:500-511`. A future revision (R6) will update them — see `docs/REVISION_BUSINESS_RULES_AND_ARCHITECTURE.md` §C.7 and §H for the planned policy.

### Client Cancellations:
- **≥ 24 hours before start** (`hoursUntilSession >= FULL_REFUND_HOURS`): **100% refund** to client.
  - `Payment.status = 'refunded'`
  - `Payment.refundAmount = 1000.00`
  - `Payment.platformFeeAmount = 0.00`
  - `Payment.stylistPayoutAmount = 0.00`
- **< 24 hours before start** (`hoursUntilSession < FULL_REFUND_HOURS`): **75% refund** to client (`CANCELLATION_POLICY.PARTIAL_REFUND_PERCENTAGE = 75`).
  - `Payment.status = 'partially_refunded'`
  - `Payment.refundAmount = 750.00`
  - `Payment.platformFeeAmount = 37.50` (15% of retained 250 EGP)
  - `Payment.stylistPayoutAmount = 212.50` (85% of retained 250 EGP)

### Stylist or Admin Cancellations:
- **Any time:** **100% refund** to client.
  - `Payment.status = 'refunded'`
  - `Payment.refundAmount = 1000.00`
  - `Payment.stylistPayoutAmount = 0.00`
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
  - Transitioning a payout from `pending` $\rightarrow$ `processing` $\rightarrow$ `paid` is state-guarded in Mongoose transactions.
  - Bookings are marked with `payoutStatus: 'processing'` and `payoutId: payout._id` upon batch creation, locking them from being included in concurrent batches.
  - If a payout is marked `failed`, bookings are automatically released back to `payoutStatus: 'unpaid'` for re-batching.
