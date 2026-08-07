import { z } from 'zod';

export const createOfferSchema = {
  body: z
    .object({
      price: z.number({ required_error: 'price is required' }).min(100, 'Offer price must be at least 100 EGP'),
      duration: z.number({ required_error: 'duration in minutes is required' }).positive(),
      message: z.string().trim().optional(),
    })
    .strict(),
};
