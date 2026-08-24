import { z } from 'zod';
import { objectIdField } from '../../common/validators/shared.validator.js';

export const updatePayoutAccountSchema = {
  body: z
    .object({
      method: z.enum(['bank_transfer', 'vodafone_cash', 'instapay']),
      accountHolderName: z.string().trim().min(2).optional(),
      bankName: z.string().trim().min(2).optional(),
      accountNumber: z.string().trim().min(4).optional(),
      walletPhone: z.string().trim().min(10).max(15).optional(),
    })
    .strict(),
};

export const batchPayoutSchema = {
  body: z
    .object({
      stylistIds: z.array(objectIdField).min(1, 'At least one stylist ID must be provided'),
      holdWindowHours: z.number().int().min(0).max(720).optional().default(48),
    })
    .strict(),
};

export const markPaidSchema = {
  params: z
    .object({
      id: objectIdField,
    })
    .strict(),
  body: z
    .object({
      reference: z.string().trim().min(1, 'Payment reference/transaction number is required'),
    })
    .strict(),
};

export const markFailedSchema = {
  params: z
    .object({
      id: objectIdField,
    })
    .strict(),
  body: z
    .object({
      failureReason: z.string().trim().min(1, 'Failure reason is required'),
    })
    .strict(),
};

export const payoutIdParamSchema = {
  params: z
    .object({
      id: objectIdField,
    })
    .strict(),
};

export default {
  updatePayoutAccountSchema,
  batchPayoutSchema,
  markPaidSchema,
  markFailedSchema,
  payoutIdParamSchema,
};
