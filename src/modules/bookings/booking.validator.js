import { z } from 'zod';

export const checkInSchema = {
  body: z
    .object({
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
    })
    .strict(),
};

export const confirmCompletionSchema = {
  body: z.object({}).strict().optional(),
};

export const disputeSchema = {
  body: z
    .object({
      reason: z
        .string({ required_error: 'Dispute reason is required' })
        .trim()
        .min(5, 'Reason must be at least 5 characters'),
      type: z.string().trim().optional(), // Category e.g. 'no_show', 'quality', 'other'
      evidence: z
        .array(
          z.object({
            text: z.string().trim().optional(),
            images: z.array(z.string().url()).optional(),
          })
        )
        .optional(),
    })
    .strict(),
};

export const addDisputeEvidenceSchema = {
  body: z
    .object({
      text: z.string().trim().max(2000).optional(),
      images: z.array(z.string().url()).max(10).optional(),
    })
    .refine((data) => (data.text && data.text.length > 0) || (data.images && data.images.length > 0), {
      message: 'Either text notes or images must be provided as evidence',
    }),
};

export const cancelBookingSchema = {
  body: z
    .object({
      reason: z.string().trim().optional(),
    })
    .strict(),
};

export default {
  checkInSchema,
  confirmCompletionSchema,
  disputeSchema,
  addDisputeEvidenceSchema,
  cancelBookingSchema,
};

export const noShowSchema = {
  body: z
    .object({
      evidence: z.array(z.string().trim().url()).max(5).optional(),
    })
    .strict(),
};

export const noShowResponseSchema = {
  body: z
    .object({
      contest: z.boolean(),
      message: z.string().trim().max(1000).optional(),
    })
    .strict(),
};
