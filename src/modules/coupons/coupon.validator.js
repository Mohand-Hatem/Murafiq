import { z } from 'zod';
import { COUPON_POLICY } from '../../common/constants/statuses.constant.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const validateCouponSchema = {
  body: z
    .object({
      code: z.string().trim().min(4).max(32),
      bookingId: objectId,
    })
    .strict(),
};

export const listMyCouponsSchema = {
  query: z
    .object({
      status: z.enum(['ISSUED', 'REDEEMED', 'EXPIRED', 'VOIDED']).optional(),
    })
    .strict(),
};

export const issueCouponSchema = {
  body: z
    .object({
      recipientId: objectId.optional(),
      recipientIds: z.array(objectId).min(1).max(100).optional(),
      discountPercentage: z.number().int().min(1).max(100).optional(),
      maxDiscountEgp: z.number().min(0).max(COUPON_POLICY.MAX_ADMIN_DISCOUNT_EGP).optional(),
      expiryDays: z.number().int().min(1).max(365).optional(),
      issuedReason: z
        .enum(['NO_SHOW_COMPENSATION', 'LATE_CANCEL_COMPENSATION', 'MARKETING'])
        .optional(),
    })
    .strict()
    .refine(
      (data) => Boolean(data.recipientId || (data.recipientIds && data.recipientIds.length > 0)),
      {
        message: 'Must provide either recipientId or recipientIds',
        path: ['recipientId'],
      }
    ),
};

export default { validateCouponSchema, listMyCouponsSchema, issueCouponSchema };
