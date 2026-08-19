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
      reason: z.string({ required_error: 'Dispute reason is required' }).trim().min(5, 'Reason must be at least 5 characters'),
      type: z.string().trim().optional(), // Category e.g. 'no_show', 'quality', 'other'
    })
    .strict(),
};

export const cancelBookingSchema = {
  body: z
    .object({
      reason: z.string().trim().optional(),
    })
    .strict(),
};
