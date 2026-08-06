import { z } from 'zod';
import { ROLES } from '../../common/constants/roles.constant.js';
import { emailField, passwordField, otpField } from '../../common/validators/shared.validator.js';

export const registerSchema = {
  body: z
    .object({
      nameEn: z.string().trim().min(1, 'nameEn is required'),
      nameAr: z.string().trim().min(1).optional(),
      email: emailField,
      phone: z.string().trim().min(1).optional(),
      password: passwordField,
      // Self-registration only allows client/stylist — admin accounts are never created via this endpoint.
      role: z.enum([ROLES.CLIENT, ROLES.STYLIST]).optional().default(ROLES.CLIENT),
    })
    .strict(),
};

export const loginSchema = {
  body: z
    .object({
      email: emailField,
      password: z.string().min(1, 'Password is required'),
    })
    .strict(),
};

export const verifyEmailSchema = {
  body: z
    .object({
      email: emailField,
      otp: otpField,
    })
    .strict(),
};

export const resendOtpSchema = {
  body: z
    .object({
      email: emailField,
    })
    .strict(),
};

export const forgotPasswordSchema = {
  body: z
    .object({
      email: emailField,
    })
    .strict(),
};

export const resetPasswordSchema = {
  body: z
    .object({
      email: emailField,
      otp: otpField,
      newPassword: passwordField,
    })
    .strict(),
};

export const changePasswordSchema = {
  body: z
    .object({
      currentPassword: z.string().min(1, 'Current password is required'),
      newPassword: passwordField,
    })
    .strict(),
};

export const googleAuthSchema = {
  body: z
    .object({
      idToken: z.string().min(1, 'idToken is required'),
      // Only meaningful the first time this Google account is seen (new-user creation) —
      // ignored when linking to or logging into an existing account.
      role: z.enum([ROLES.CLIENT, ROLES.STYLIST]).optional().default(ROLES.CLIENT),
    })
    .strict(),
};
