import { z } from 'zod';
import { objectIdField } from '../../common/validators/shared.validator.js';

export const approveVerificationSchema = {
  params: z
    .object({
      userId: objectIdField,
    })
    .strict(),
};

export const rejectVerificationSchema = {
  params: z
    .object({
      userId: objectIdField,
    })
    .strict(),
  body: z
    .object({
      rejectionReason: z.string().trim().min(1, 'Rejection reason is required'),
    })
    .strict(),
};

export const suspendUserSchema = {
  params: z
    .object({
      id: objectIdField,
    })
    .strict(),
  body: z
    .object({
      reason: z.string().trim().min(1, 'Suspension reason is required'),
    })
    .strict(),
};

export const reactivateUserSchema = {
  params: z
    .object({
      id: objectIdField,
    })
    .strict(),
};

export const restrictUserSchema = {
  params: z
    .object({
      id: objectIdField,
    })
    .strict(),
  body: z
    .object({
      durationDays: z.number().int().min(1).max(365).optional().default(7),
      reason: z.string().trim().optional(),
    })
    .strict(),
};

export const blockUserSchema = {
  params: z
    .object({
      id: objectIdField,
    })
    .strict(),
  body: z
    .object({
      reason: z.string().trim().min(1, 'Block reason is required'),
    })
    .strict(),
};

export const unblockUserSchema = {
  params: z
    .object({
      id: objectIdField,
    })
    .strict(),
  body: z
    .object({
      notes: z.string().trim().optional(),
    })
    .strict()
    .optional(),
};

export const resolveDisputeSchema = {
  params: z
    .object({
      id: objectIdField,
    })
    .strict(),
  body: z
    .object({
      outcome: z.enum([
        'completed',
        'cancelled',
        'refund_full',
        'payout_stylist',
        'split',
        'partial_refund',
        'dismissed',
      ]),
      refundPercentage: z.number().min(0).max(100).optional().default(0),
      resolutionNotes: z.string().trim().min(1, 'Resolution notes are required'),
    })
    .strict(),
};

export default {
  approveVerificationSchema,
  rejectVerificationSchema,
  resolveDisputeSchema,
  suspendUserSchema,
  reactivateUserSchema,
  restrictUserSchema,
};

export const resolveNoShowSchema = {
  body: z
    .object({
      upheld: z.boolean(),
      notes: z.string().trim().max(2000).optional(),
    })
    .strict(),
};
