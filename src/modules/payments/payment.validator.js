import { z } from 'zod';
import { objectIdField } from '../../common/validators/shared.validator.js';

export const initializePaymentSchema = {
  params: z
    .object({
      bookingId: objectIdField,
    })
    .strict(),
  // Only the coupon CODE is accepted. The discount amount is always recomputed
  // server-side from the stored percentage and the booking's own price.
  //
  // `.default({})` matters: initializing without a coupon is the normal case and those
  // requests carry no body at all, which would otherwise fail parsing outright.
  body: z
    .object({
      couponCode: z.string().trim().min(4).max(32).optional(),
    })
    .strict()
    .default({}),
};

export const getPaymentStatusSchema = {
  params: z
    .object({
      bookingId: objectIdField,
    })
    .strict(),
};

export const refundPaymentSchema = {
  params: z
    .object({
      bookingId: objectIdField,
    })
    .strict(),
  body: z
    .object({
      refundPercentage: z.number().min(1).max(100).optional().default(100),
      reason: z.string().trim().min(1).optional(),
      // Optional EGP amount the admin wants the stylist to keep from whatever this
      // refund does NOT return to the client. Omitted (0) preserves the existing
      // default for this general-purpose endpoint -- unlike resolveDispute/resolveNoShow,
      // there is no policy here to compute this from automatically, so it stays an
      // explicit admin choice rather than a silently-changed default. Previously there
      // was no way to supply this at all (the schema was `.strict()` with no such field),
      // so an admin could not pay the stylist their share of a partial goodwill refund
      // even when they deliberately wanted to. See
      // docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X21. processRefund() itself clamps
      // this to whatever the platform actually retained, so it can never exceed that.
      stylistPayoutOverrideAmount: z.number().min(0).optional(),
    })
    .strict(),
};

export default {
  initializePaymentSchema,
  getPaymentStatusSchema,
  refundPaymentSchema,
};
