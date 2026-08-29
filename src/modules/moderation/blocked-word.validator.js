import { z } from 'zod';
import { objectIdField } from '../../common/validators/shared.validator.js';

export const addBlockedWordSchema = z
  .object({
    word: z
      .string()
      .trim()
      .min(2, 'Word must be at least 2 characters')
      .max(100, 'Word must be at most 100 characters')
      .toLowerCase(),
    language: z.enum(['ar', 'en', 'both']).optional().default('both'),
    category: z
      .enum(['PROFANITY', 'INSULT', 'SEXUAL', 'HATE', 'THREAT', 'HARASSMENT'])
      .optional()
      .default('PROFANITY'),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional().default('MEDIUM'),
  })
  .strict();

export const addBlockedWordsBulkSchema = z
  .object({
    words: z
      .array(
        z.object({
          word: z.string().trim().min(2).max(100).toLowerCase(),
          language: z.enum(['ar', 'en', 'both']).optional().default('both'),
          category: z
            .enum(['PROFANITY', 'INSULT', 'SEXUAL', 'HATE', 'THREAT', 'HARASSMENT'])
            .optional()
            .default('PROFANITY'),
          severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional().default('MEDIUM'),
        })
      )
      .min(1, 'At least one word is required')
      .max(100, 'Maximum 100 words per bulk request'),
  })
  .strict();

export const getBlockedWordsSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    language: z.enum(['ar', 'en', 'both']).optional(),
    category: z.enum(['PROFANITY', 'INSULT', 'SEXUAL', 'HATE', 'THREAT', 'HARASSMENT']).optional(),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    isActive: z
      .enum(['true', 'false'])
      .transform((val) => val === 'true')
      .optional(),
  })
  .strict();

export const deleteBlockedWordSchema = {
  params: z.object({
    id: objectIdField,
  }),
};

export default {
  addBlockedWordSchema,
  addBlockedWordsBulkSchema,
  getBlockedWordsSchema,
  deleteBlockedWordSchema,
};
