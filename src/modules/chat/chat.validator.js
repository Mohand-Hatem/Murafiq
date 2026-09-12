import { z } from 'zod';
import { objectIdField, isCloudinaryUrl } from '../../common/validators/shared.validator.js';

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
    .strict()
    // A 'image' message's `content` must actually BE an image reference, not arbitrary
    // text wearing an 'image' label to dodge the moderation scan that only runs for
    // type:'text' in chat.service.js. See docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X12.
    .refine((data) => data.type !== 'image' || isCloudinaryUrl(data.content), {
      message: 'An image message must reference an uploaded Cloudinary image URL',
      path: ['content'],
    }),
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
