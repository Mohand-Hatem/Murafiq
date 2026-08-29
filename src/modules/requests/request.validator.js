import { z } from 'zod';

const sharedRequestFields = {
  title: z.string().trim().min(1, 'title is required'),
  date: z.string().datetime().optional(),
  time: z.string().trim().optional(),
  meetingLocation: z
    .object({
      address: z.string().trim().optional(),
      country: z.string().trim().optional(),
      governorate: z.string().trim().optional(),
      city: z.string().trim().optional(),
      area: z.string().trim().optional(),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
    })
    .optional(),
  description: z.string().trim().optional(),
  budgetRange: z
    .object({
      min: z.number().min(100, 'Minimum budget must be at least 100 EGP'),
      max: z.number().min(100, 'Maximum budget must be at least 100 EGP'),
    })
    .refine((data) => data.max >= data.min, {
      message: 'max budget must be greater than or equal to min budget',
      path: ['max'],
    })
    .optional(),
  images: z.array(z.string().trim().url()).optional(),
};

export const createRequestSchema = {
  body: z.preprocess((val) => {
    if (val && typeof val === 'object' && !val.visibility) {
      return { ...val, visibility: val.stylistId ? 'direct' : 'broadcast' };
    }
    return val;
  }, z.discriminatedUnion('visibility', [
    z
      .object({
        visibility: z.literal('direct'),
        stylistId: z.string().trim().min(1, 'stylistId is required for a direct request'),
        ...sharedRequestFields,
      })
      .strict(),
    z
      .object({
        visibility: z.literal('broadcast'),
        ...sharedRequestFields,
      })
      .strict(),
  ])),
};

export const editRequestSchema = {
  body: z
    .object({
      title: z.string().trim().min(1).optional(),
      description: z.string().trim().optional(),
      date: z.string().datetime().optional(),
      time: z.string().trim().optional(),
      meetingLocation: z
        .object({
          address: z.string().trim().optional(),
          country: z.string().trim().optional(),
          governorate: z.string().trim().optional(),
          city: z.string().trim().optional(),
          area: z.string().trim().optional(),
          lat: z.number().min(-90).max(90).optional(),
          lng: z.number().min(-180).max(180).optional(),
        })
        .optional(),
      budgetRange: z
        .object({
          min: z.number().min(100, 'Minimum budget must be at least 100 EGP'),
          max: z.number().min(100, 'Maximum budget must be at least 100 EGP'),
        })
        .refine((data) => data.max >= data.min, {
          message: 'max budget must be greater than or equal to min budget',
          path: ['max'],
        })
        .optional(),
      images: z.array(z.string().trim().url()).optional(),
    })
    .strict(),
};

export const createOfferSchema = {
  body: z
    .object({
      price: z.number({ required_error: 'price is required' }).min(100, 'Offer price must be at least 100 EGP'),
      duration: z.number({ required_error: 'duration in minutes is required' }).positive(),
      message: z.string().trim().optional(),
    })
    .strict(),
};

export default {
  createRequestSchema,
  editRequestSchema,
  createOfferSchema,
};
