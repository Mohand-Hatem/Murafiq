import { z } from 'zod';

export const addBlockedDomainSchema = z
  .object({
    domain: z
      .string()
      .trim()
      .min(3, 'Domain must be at least 3 characters')
      .max(100, 'Domain must be at most 100 characters')
      .toLowerCase(),
    category: z.string().trim().max(50).optional(),
  })
  .strict();

export const getModerationEventsSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    reviewStatus: z.enum(['PENDING', 'APPROVED', 'DISMISSED']).optional(),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    senderId: z.string().trim().optional(),
  })
  .strict();

export default {
  addBlockedDomainSchema,
  getModerationEventsSchema,
};
