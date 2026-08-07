import { z } from 'zod';

const availabilityItemSchema = z.object({
  day: z.enum(['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri']),
  startTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'startTime must be in HH:MM format'),
  endTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'endTime must be in HH:MM format'),
});

export const createStylistProfileSchema = {
  body: z
    .object({
      specialty: z.enum(['stylist', 'personal_shopper'], {
        required_error: 'specialty is required',
      }),
      bio: z.string().trim().optional(),
      serviceDescription: z.string().trim().optional(),
      experienceYears: z.number().min(0, 'experienceYears cannot be negative').optional(),
      languages: z.array(z.string().trim()).optional(),
      services: z.array(z.string().trim()).optional(),
      hourlyPrice: z.number({ required_error: 'hourlyPrice is required' }).min(100, 'Hourly rate must be at least 100 EGP'),
      portfolio: z.array(z.string().trim().url('Portfolio items must be valid URLs')).optional(),
      workingAreas: z.array(z.string().trim()).optional(),
      weeklyAvailability: z.array(availabilityItemSchema).optional(),
      gender: z.enum(['male', 'female']).optional(),
    })
    .strict(),
};

export const updateStylistProfileSchema = {
  body: z
    .object({
      specialty: z.enum(['stylist', 'personal_shopper']).optional(),
      bio: z.string().trim().optional(),
      serviceDescription: z.string().trim().optional(),
      experienceYears: z.number().min(0, 'experienceYears cannot be negative').optional(),
      languages: z.array(z.string().trim()).optional(),
      services: z.array(z.string().trim()).optional(),
      hourlyPrice: z.number().min(100, 'Hourly rate must be at least 100 EGP').optional(),
      portfolio: z.array(z.string().trim().url('Portfolio items must be valid URLs')).optional(),
      workingAreas: z.array(z.string().trim()).optional(),
      weeklyAvailability: z.array(availabilityItemSchema).optional(),
      gender: z.enum(['male', 'female']).optional(),
    })
    .strict(),
};
