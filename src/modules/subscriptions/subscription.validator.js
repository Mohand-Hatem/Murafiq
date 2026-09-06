import { z } from 'zod';

export const subscribeSchema = z
  .object({
    planCode: z.string().min(1, 'planCode is required'),
    billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
    paymobSubscriptionId: z.string().optional(),
  })
  .strict();

export const planQuerySchema = z
  .object({
    role: z.enum(['client', 'stylist']).optional(),
  })
  .strict();

export const checkoutSchema = z
  .object({
    planCode: z.string().min(1, 'planCode is required'),
    billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
  })
  .strict();

export default {
  subscribeSchema,
  checkoutSchema,
  planQuerySchema,
};
