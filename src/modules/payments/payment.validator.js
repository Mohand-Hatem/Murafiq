import { z } from 'zod';
import { objectIdField } from '../../common/validators/shared.validator.js';

export const initializePaymentSchema = {
  params: z.object({
    bookingId: objectIdField,
  }),
};

export const getPaymentStatusSchema = {
  params: z.object({
    bookingId: objectIdField,
  }),
};

export const refundPaymentSchema = {
  params: z.object({
    bookingId: objectIdField,
  }),
  body: z.object({
    refundPercentage: z.number().min(1).max(100).optional().default(100),
    reason: z.string().trim().min(1).optional(),
  }),
};
