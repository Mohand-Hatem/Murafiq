import { z } from 'zod';

// Genuinely reused field atoms — composed into each module's own request schemas
// (auth.validator.js, and future modules) rather than redefined per module.
export const emailField = z.string().trim().toLowerCase().email('Invalid email address');
export const passwordField = z.string().min(8, 'Password must be at least 8 characters');
export const otpField = z.string().regex(/^\d{6}$/, 'OTP must be a 6-digit code');
export const objectIdField = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId format');

// Trusted-host check for any field that is supposed to hold an uploaded-image
// reference. An unrestricted URL here is an SSRF vector for anything that later
// fetches it server-side, and — for chat specifically — the gap this closes is that
// without it a `type: 'image'` message could carry arbitrary free text as `content`,
// skipping the moderation scan that only runs for `type === 'text'` (a bare-name
// change of `type` is not itself a security boundary). See
// docs/AUDIT_2026_09_FULL_SYSTEM.md finding X12. Reused from the identical pattern in
// wardrobe.validator.js / user.validator.js rather than left as a third local copy.
export const isCloudinaryUrl = (val) => {
  try {
    return new URL(val).hostname === 'res.cloudinary.com';
  } catch {
    return false;
  }
};

export default {
  emailField,
  passwordField,
  otpField,
  objectIdField,
  isCloudinaryUrl,
};
