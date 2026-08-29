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
    })
    .strict(),
};

export default {
  initializePaymentSchema,
  getPaymentStatusSchema,
  refundPaymentSchema,
};
