import { z } from 'zod';

const objectIdRegex = /^[a-f0-9]{24}$/;

const garmentInputSchema = z
  .object({
    source: z.enum(['wardrobe', 'upload'], {
      required_error: 'Garment source is required',
    }),
    itemId: z.string().regex(objectIdRegex, 'Invalid itemId ObjectId').optional(),
    imageRef: z.string().trim().optional(),
    slot: z.enum(['top', 'bottom', 'outerwear', 'shoes', 'dress', 'accessory']).optional(),
    label: z.string().trim().max(100).optional(),
  })
  .strict();

export const createTryOnSchema = {
  body: z
    .object({
      shapeModelId: z
        .string({
          required_error: 'shapeModelId is required',
        })
        .regex(objectIdRegex, 'Invalid shapeModelId ObjectId'),
      garments: z
        .array(garmentInputSchema)
        .min(1, 'At least 1 garment is required')
        .max(4, 'At most 4 garments can be tried on simultaneously')
        .optional(),
      outfitId: z.string().regex(objectIdRegex, 'Invalid outfitId ObjectId').optional(),
      itemId: z.string().regex(objectIdRegex, 'Invalid itemId ObjectId').optional(),
      promptVersion: z.string().trim().default('v1').optional(),
      resolution: z.enum(['512x512', '1024x1024']).default('1024x1024').optional(),
    })
    .strict()
    .refine(
      (data) => Boolean(data.outfitId || data.itemId || (Array.isArray(data.garments) && data.garments.length > 0)),
      {
        message: 'Must provide at least one of outfitId, itemId, or garments',
        path: ['garments'],
      }
    ),
};

export const tryOnIdParamSchema = {
  params: z
    .object({
      id: z.string().regex(objectIdRegex, 'Invalid try-on generation ID'),
    })
    .strict(),
};

export const listTryOnSchema = {
  query: z
    .object({
      page: z.coerce.number().int().positive().default(1).optional(),
      limit: z.coerce.number().int().positive().max(50).default(20).optional(),
    })
    .strict(),
};

export default {
  createTryOnSchema,
  tryOnIdParamSchema,
  listTryOnSchema,
};
