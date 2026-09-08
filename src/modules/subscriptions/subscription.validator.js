import { z } from 'zod';

// validate() dispatches on the { body, query, params } keys of the object it is handed --
// it does NOT take a bare Zod schema plus a source name. Every schema in this module used
// to be exported bare, so `validate(checkoutSchema)` matched none of those keys and ran no
// validation at all: .strict() never rejected an unknown field and planCode was never
// required. Wrapping them restores the guarantee the routes already claimed to have.

const planCodeField = z.string().trim().min(1, 'planCode is required');
const billingCycleField = z.enum(['monthly', 'yearly']).default('monthly');

// No paymobSubscriptionId: a provider reference is something the server learns from a
// verified webhook, never something a client is trusted to assert.
export const subscribeSchema = {
  body: z
    .object({
      planCode: planCodeField,
      billingCycle: billingCycleField,
    })
    .strict(),
};

export const checkoutSchema = {
  body: z
    .object({
      planCode: planCodeField,
      billingCycle: billingCycleField,
    })
    .strict(),
};

export const planQuerySchema = {
  query: z
    .object({
      role: z.enum(['client', 'stylist']).optional(),
    })
    .strict(),
};

export const orderIdParamSchema = {
  params: z
    .object({
      orderId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'orderId must be a valid MongoDB ObjectId'),
    })
    .strict(),
};

export default {
  subscribeSchema,
  checkoutSchema,
  planQuerySchema,
  orderIdParamSchema,
};
