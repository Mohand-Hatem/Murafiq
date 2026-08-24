import { z } from 'zod';

export const updateProfileSchema = {
  body: z
    .object({
      name: z.string().trim().min(2, 'Name must be at least 2 characters').optional(),
      phone: z.string().trim().optional(),
      profileImage: z.string().url('Invalid image URL').optional(),
      country: z.string().trim().optional(),
      governorate: z.string().trim().optional(),
      city: z.string().trim().optional(),
      area: z.string().trim().optional(),
      lat: z.number().min(-90, 'Latitude must be between -90 and 90').max(90, 'Latitude must be between -90 and 90').optional(),
      lng: z.number().min(-180, 'Longitude must be between -180 and 180').max(180, 'Longitude must be between -180 and 180').optional(),
    })
    .strict(),
};

export const uploadVerificationDocsSchema = {
  body: z
    .object({
      documents: z
        .array(
          z
            .object({
              type: z.enum([
                'national_id_front',
                'national_id_back',
                'selfie_with_id',
                'police_clearance_certificate',
              ]),
              documentRef: z
                .string()
                .min(1, 'Document reference (Cloudinary public ID) is required')
                .refine(
                  (val) => !/^https?:\/\/(?!res\.cloudinary\.com)/i.test(val),
                  'External raw URLs are not permitted. Please upload documents via /uploads first.'
                ),
            })
            .strict()
        )
        .min(1, 'At least one document must be provided'),
    })
    .strict(),
};

export const updateProfileImageSchema = {
  body: z
    .object({
      profileImage: z.string().trim().optional(),
    })
    .strict(),
};

export default {
  updateProfileSchema,
  uploadVerificationDocsSchema,
  updateProfileImageSchema,
};
