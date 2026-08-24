import { z } from 'zod';
import { objectIdField } from '../../common/validators/shared.validator.js';

export const getMessagesSchema = {
  params: z
    .object({
      conversationId: objectIdField,
    })
    .strict(),
  query: z
    .object({
      limit: z.coerce.number().int().min(1).max(100).optional(),
      startAfter: z.string().optional(),
    })
    .strict(),
};

export const sendMessageSchema = {
  params: z
    .object({
      conversationId: objectIdField,
    })
    .strict(),
  body: z
    .object({
      content: z.string().trim().min(1, 'Message content cannot be empty').max(2000, 'Message is too long'),
      type: z.enum(['text', 'image']).default('text').optional(),
    })
    .strict(),
};

export default {
  getMessagesSchema,
  sendMessageSchema,
};
