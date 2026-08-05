import { z } from 'zod';

// Genuinely reused field atoms — composed into each module's own request schemas
// (auth.validator.js, and future modules) rather than redefined per module.
export const emailField = z.string().trim().toLowerCase().email('Invalid email address');
export const passwordField = z.string().min(8, 'Password must be at least 8 characters');
export const otpField = z.string().regex(/^\d{6}$/, 'OTP must be a 6-digit code');
