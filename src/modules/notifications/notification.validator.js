import { z } from 'zod';
import { objectIdField } from '../../common/validators/shared.validator.js';

export const notificationIdSchema = {
  params: z
    .object({
      id: objectIdField,
    })
    .strict(),
};

export const deviceTokenSchema = {
  body: z
    .object({
      token: z.string().trim().min(1, 'Token cannot be empty'),
    })
    .strict(),
};

export default {
  notificationIdSchema,
  deviceTokenSchema,
};
