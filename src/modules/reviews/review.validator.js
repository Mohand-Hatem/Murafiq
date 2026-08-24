import { z } from 'zod';
import { objectIdField } from '../../common/validators/shared.validator.js';

export const createReviewSchema = {
  params: z
    .object({
      bookingId: objectIdField,
    })
    .strict(),
  body: z
    .object({
      rating: z.coerce
        .number()
        .int('Rating must be an integer')
        .min(1, 'Rating must be at least 1')
        .max(5, 'Rating cannot exceed 5'),
      comment: z.string().trim().max(1000, 'Comment cannot exceed 1000 characters').optional(),
    })
    .strict(),
};

export const hideReviewSchema = {
  params: z
    .object({
      id: objectIdField,
    })
    .strict(),
  body: z
    .object({
      isHidden: z.boolean().default(true),
      reason: z.string().trim().min(1).optional(),
    })
    .strict(),
};

export default {
  createReviewSchema,
  hideReviewSchema,
};
