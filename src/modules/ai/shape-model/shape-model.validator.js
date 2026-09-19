import { z } from 'zod';

export const createShapeModelSchema = {
  body: z
    .object({
      imageRef: z
        .string({
          required_error: 'imageRef is required',
        })
        .trim()
        .min(1, 'imageRef cannot be empty')
        .regex(
          /^murafiq\/shape-models\/[a-f0-9]{24}\/[a-zA-Z0-9_-]+$/,
          'imageRef must be a valid shape-models path scoped to the user'
        ),
      consent: z
        .boolean({
          required_error:
            'Explicit consent is required to process and store full-body shape models',
        })
        .refine((val) => val === true, {
          message:
            'Explicit consent is required to process and store full-body shape models',
        }),
      format: z.string().trim().optional(),
      bytes: z.number().int().nonnegative().optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
    })
    .strict(),
};

export default {
  createShapeModelSchema,
};
