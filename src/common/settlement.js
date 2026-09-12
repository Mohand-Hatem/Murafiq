import { CANCELLATION_POLICY, NO_SHOW_POLICY } from './constants/statuses.constant.js';

/** The repository's single money-rounding rule. Mirrors payment.service.js round2. */
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * The one settlement calculation for every event that ends a booking with money moving.
 *
 * PURE. No I/O, no clock, no database. Consolidates three sites that computed the same
 * identity independently (cancellation's four-branch matrix, resolveNoShow's stylist share,
 * resolveDispute's retained-amount split) -- see the plan §D.5 BK3. Every percentage below
 * is read from CANCELLATION_POLICY / NO_SHOW_POLICY; NOTHING is hardcoded here, so the
 * constants file remains the single source of truth for the business rules and this file is
 * only the arithmetic.
 *
 * The returned shape is identical to the object calculateCancellationOutcome already
 * returned, so getCancellationQuote's API response does not change.
 *
 * Invariant, asserted in tests for every branch:
 *   refundAmount + stylistCompensationAmount + platformFeeAmount === price (±1 piastre)
 * `penaltyAmount` is OUTSIDE that identity on purpose: a stylist penalty is a debt accrued
 * against a future payout, not a share of this booking's price.
 *
 * @param {Object}  input
 * @param {number}  input.price
 * @param {'CANCELLATION'|'NO_SHOW'|'DISPUTE'} input.event
 * @param {'client'|'stylist'|'admin'} input.actor
 *        CANCELLATION: who cancelled ('admin' is priced on the client branch -- an admin
 *        cancellation is no-fault and must never assess a penalty against a stylist).
 *        NO_SHOW: who was reported AGAINST.
 *        DISPUTE: always 'admin'.
 * @param {number} [input.hoursUntilSession]     CANCELLATION only
 * @param {number} [input.refundPercentage]      DISPUTE only, 0-100
 * @param {number} [input.platformFeePercentage] DISPUTE only
 * @returns {{tier: string, refundPercentage: number, refundAmount: number,
 *            platformFeeAmount: number, stylistCompensationAmount: number,
 *            penaltyAmount: number, couponEligible: boolean,
 *            hoursUntilSession: number|null, isEarly: boolean|null}}
 */
export const computeSettlement = ({
  price,
  event,
  actor,
  hoursUntilSession = null,
  refundPercentage = 0,
  platformFeePercentage = 15,
}) => {
  const p = Number(price) || 0;

  if (event === 'NO_SHOW') {
    const policy = actor === 'stylist' ? NO_SHOW_POLICY.STYLIST : NO_SHOW_POLICY.CLIENT;
    const refundAmount = round2(p * (policy.CLIENT_REFUND_PERCENTAGE / 100));
    const retained = round2(Math.max(0, p - refundAmount));
    const stylistCompensationAmount = Math.min(
      round2(p * (policy.STYLIST_PERCENTAGE / 100)),
      retained
    );
    const platformFeeAmount = round2(Math.max(0, retained - stylistCompensationAmount));
    return {
      tier: actor === 'stylist' ? 'NO_SHOW_STYLIST' : 'NO_SHOW_CLIENT',
      refundPercentage: policy.CLIENT_REFUND_PERCENTAGE,
      refundAmount,
      platformFeeAmount,
      stylistCompensationAmount,
      penaltyAmount: round2(p * (policy.STYLIST_PENALTY_PERCENTAGE / 100)),
      couponEligible: policy.ISSUES_COUPON,
      hoursUntilSession: null,
      isEarly: null,
    };
  }

  if (event === 'DISPUTE') {
    // Arbitration prices the refund directly; whatever is retained still splits on the
    // normal fee percentage, so arbitration never silently zeroes a stylist's earnings on
    // the portion the admin decided they keep (MONEY_AND_LEDGER.md §4.2).
    const pct = Math.max(0, Math.min(100, Number(refundPercentage) || 0));
    const refundAmount = round2((p * pct) / 100);
    const retained = round2(Math.max(0, p - refundAmount));
    const stylistCompensationAmount = round2(retained * (1 - platformFeePercentage / 100));
    return {
      tier: 'DISPUTE_ARBITRATION',
      refundPercentage: pct,
      refundAmount,
      platformFeeAmount: round2(Math.max(0, retained - stylistCompensationAmount)),
      stylistCompensationAmount,
      penaltyAmount: 0,
      couponEligible: false,
      hoursUntilSession: null,
      isEarly: null,
    };
  }

  // CANCELLATION. Boundary: exactly 24h00m is CLIENT-FAVOURABLE (>= EARLY_HOURS).
  const isEarly = Number(hoursUntilSession) >= CANCELLATION_POLICY.EARLY_HOURS;

  // 'admin' is deliberately priced on the client branch: an admin cancellation is neither
  // party's fault, and getCancellationQuote already quotes it that way. Pricing it on the
  // stylist branch would assess a penalty debt against an innocent stylist and make the
  // quote disagree with what actually happens.
  if (actor === 'client' || actor === 'admin') {
    const refundPct = isEarly
      ? CANCELLATION_POLICY.EARLY_CLIENT_REFUND_PERCENTAGE
      : CANCELLATION_POLICY.LATE_CLIENT_REFUND_PERCENTAGE;
    const refundAmount = round2(p * (refundPct / 100));
    return {
      tier: isEarly ? 'EARLY_CLIENT_CANCEL' : 'LATE_CLIENT_CANCEL',
      refundPercentage: refundPct,
      refundAmount,
      platformFeeAmount: round2(p - refundAmount),
      // The stylist receives NOTHING on a client cancellation -- a stylist who has not
      // travelled has not incurred the loss the no-show policy compensates.
      stylistCompensationAmount: 0,
      penaltyAmount: 0,
      couponEligible: false,
      hoursUntilSession: Number(hoursUntilSession),
      isEarly,
    };
  }

  // Stylist cancelled: the client is always made whole and never bears the cost. The
  // stylist accrues a penalty debt instead, settled against a future payout.
  const penaltyPct = isEarly
    ? CANCELLATION_POLICY.EARLY_STYLIST_PENALTY_PERCENTAGE
    : CANCELLATION_POLICY.LATE_STYLIST_PENALTY_PERCENTAGE;
  return {
    tier: isEarly ? 'EARLY_STYLIST_CANCEL' : 'LATE_STYLIST_CANCEL',
    refundPercentage: 100,
    refundAmount: round2(p),
    platformFeeAmount: 0,
    stylistCompensationAmount: 0,
    penaltyAmount: round2(p * (penaltyPct / 100)),
    couponEligible: !isEarly,
    hoursUntilSession: Number(hoursUntilSession),
    isEarly,
  };
};

export default computeSettlement;
