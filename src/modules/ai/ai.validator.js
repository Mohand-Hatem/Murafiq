import { z } from 'zod';

export const stylistRequestSchema = {
  body: z
    .object({
      message: z
        .string({
          required_error: 'Message is required',
        })
        .trim()
        .min(1, 'Message cannot be empty')
        .max(500, 'Message cannot exceed 500 characters'),
      conversationId: z.string().optional(),
      imageRef: z.string().optional(),
    })
    .strict(),
};

export default {
  stylistRequestSchema,
};
