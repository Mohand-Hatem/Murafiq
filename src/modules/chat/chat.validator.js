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

export const reportMessageSchema = {
  body: z
    .object({
      reportedUserId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid user id'),
      messageId: z.string().trim().max(128).optional(),
      reason: z.string().trim().min(3).max(1000),
      snippet: z.string().trim().max(500).optional(),
    })
    .strict(),
};
