import { z } from 'zod';
import { objectIdField } from '../../common/validators/shared.validator.js';

// All three schemas below were previously exported bare (a raw z.object(...) with none
// of .body/.query/.params), which validate.middleware.js reads -- so validate() found
// nothing to parse and silently let every request through unvalidated: page/limit
// defaults never applied, the .toLowerCase() normalization on stored words never ran
// (silently degrading scanner matching against differently-cased content), and the
// bulk endpoint's max(100) cap was unenforced. Wrapped to match the middleware's
// actual contract, matching deleteBlockedWordSchema below (already correctly shaped).
export const addBlockedWordSchema = {
  body: z
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
    .strict(),
};

export const addBlockedWordsBulkSchema = {
  body: z
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
    .strict(),
};

export const getBlockedWordsSchema = {
  query: z
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
    .strict(),
};

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
