import crypto from 'crypto';
import couponRepository from './coupon.repository.js';
import { COUPON_POLICY } from '../../common/constants/statuses.constant.js';
import { round2 } from '../payments/payment.service.js';
import ApiError from '../../common/utils/ApiError.js';
import logger from '../../config/logger.config.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 — these get misread aloud
const CODE_LENGTH = 10;

const generateCode = () => {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `MRF${out}`;
};

/**
 * Value is a PERCENTAGE resolved at redemption time against the booking it is applied
 * to, capped in absolute EGP — not a fixed amount fixed at issuance (§R item 18).
 * The percentage keeps the compensation proportionate to whatever the client rebooks;
 * the cap stops platform exposure from scaling with the most valuable bookings, which
 * is exactly backwards for an automatically-issued goodwill credit.
 */
export const calculateDiscount = (coupon, bookingPrice) => {
  const raw = bookingPrice * (coupon.discountPercentage / 100);
  const capped = Math.min(raw, coupon.maxDiscountEgp ?? COUPON_POLICY.MAX_DISCOUNT_EGP);
  return round2(Math.max(0, capped));
};

/**
 * Issue a compensation coupon. Idempotent per {sourceBookingId, issuedReason} via a
 * unique index — a retried no-show resolution returns the existing coupon rather than
 * minting a second one.
 */
export const issueCoupon = async ({
  recipientId,
  sourceBookingId = null,
  issuedReason = 'NO_SHOW_COMPENSATION',
  discountPercentage = COUPON_POLICY.NO_SHOW_DISCOUNT_PERCENTAGE,
  maxDiscountEgp = COUPON_POLICY.MAX_DISCOUNT_EGP,
  expiryDays = COUPON_POLICY.EXPIRY_DAYS,
}) => {
  if (!recipientId) {
    throw new ApiError(400, 'A coupon must have a recipient');
  }

  if (sourceBookingId) {
    const existing = await couponRepository.findBySourceBooking(sourceBookingId, issuedReason);
    if (existing) return existing;
  }

  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

  // Retry only on a code collision. Any other failure is a real error and must surface.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await couponRepository.create({
        code: generateCode(),
        recipientId,
        sourceBookingId: sourceBookingId || undefined,
        issuedReason,
        discountPercentage,
        maxDiscountEgp,
        expiresAt,
        status: 'ISSUED',
      });
    } catch (err) {
      if (err.code === 11000 && err.keyPattern?.sourceBookingId) {
        // Lost an issuance race — the other writer's coupon is the canonical one.
        const existing = await couponRepository.findBySourceBooking(sourceBookingId, issuedReason);
        if (existing) return existing;
      }
      if (err.code === 11000 && err.keyPattern?.code) continue;
      throw err;
    }
  }
  throw new ApiError(500, 'Could not allocate a unique coupon code');
};

/**
 * Validate without consuming. Returns the computed discount so the client can DISPLAY
 * it — the authoritative amount is recomputed at redemption, never trusted from input.
 */
export const validateCoupon = async (userId, code, bookingPrice) => {
  const coupon = await couponRepository.findByCodeForUser(code, userId);
  if (!coupon) {
    throw new ApiError(404, 'Coupon not found');
  }
  if (coupon.status === 'REDEEMED') {
    throw new ApiError(400, 'This coupon has already been used');
  }
  if (coupon.status === 'VOIDED') {
    throw new ApiError(400, 'This coupon is no longer valid');
  }
  // Checked lazily here rather than by a sweep job: the only moment expiry matters is
  // the moment someone tries to use it.
  if (coupon.status === 'EXPIRED' || coupon.expiresAt < new Date()) {
    throw new ApiError(400, 'This coupon has expired');
  }
  if (bookingPrice < COUPON_POLICY.MIN_BOOKING_EGP) {
    throw new ApiError(400, `Coupon requires a booking of at least ${COUPON_POLICY.MIN_BOOKING_EGP} EGP`);
  }

  return {
    code: coupon.code,
    discountPercentage: coupon.discountPercentage,
    maxDiscountEgp: coupon.maxDiscountEgp,
    discountAmount: calculateDiscount(coupon, bookingPrice),
    expiresAt: coupon.expiresAt,
  };
};

/**
 * Validate and consume in one step. Never accept a discount amount from the caller —
 * it is recomputed here from the stored percentage and the server-side booking price.
 */
export const redeemCoupon = async (userId, code, bookingId, bookingPrice, session = null) => {
  const coupon = await couponRepository.findByCodeForUser(code, userId);
  if (!coupon) {
    throw new ApiError(404, 'Coupon not found');
  }
  await validateCoupon(userId, code, bookingPrice);

  const claimed = await couponRepository.redeemAtomically(coupon._id, bookingId, session);
  if (!claimed) {
    // Lost the CAS — another request redeemed it microseconds earlier.
    throw new ApiError(409, 'This coupon has already been used');
  }

  const discountAmount = calculateDiscount(claimed, bookingPrice);
  logger.info(`Coupon ${claimed.code} redeemed on booking ${bookingId} for ${discountAmount} EGP`);
  return { coupon: claimed, discountAmount };
};

export const issueCouponsBulk = async ({
  recipientIds,
  issuedReason = 'MARKETING',
  discountPercentage = COUPON_POLICY.NO_SHOW_DISCOUNT_PERCENTAGE,
  maxDiscountEgp = COUPON_POLICY.MAX_DISCOUNT_EGP,
  expiryDays = COUPON_POLICY.EXPIRY_DAYS,
}) => {
  if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
    throw new ApiError(400, 'recipientIds must be a non-empty array');
  }

  const coupons = [];
  for (const recipientId of recipientIds) {
    const coupon = await issueCoupon({
      recipientId,
      issuedReason,
      discountPercentage,
      maxDiscountEgp,
      expiryDays,
    });
    coupons.push(coupon);
  }
  return coupons;
};

export const getMine = async (userId, query = {}) => {
  return couponRepository.findMine(userId, query);
};

export default {
  issueCoupon,
  issueCouponsBulk,
  validateCoupon,
  redeemCoupon,
  calculateDiscount,
  getMine,
};
