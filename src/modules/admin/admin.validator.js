import { z } from 'zod';

export const rejectVerificationSchema = {
  params: z.object({
    userId: z.string().min(1, 'User ID is required'),
  }),
  body: z.object({
    rejectionReason: z.string().trim().min(1, 'Rejection reason is required'),
  }),
};
