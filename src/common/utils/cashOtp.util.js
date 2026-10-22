import crypto from 'crypto';
import env from '../../config/env.config.js';

/**
 * Demo (cash-on-delivery) OTP: a 4-digit code derived from the booking id with a server secret.
 * Nothing is stored -- not the code, not even a hash -- so a database leak reveals no code, while
 * the stylist can still be shown the same code on every read.
 *
 * shortcut: keyed by JWT_ACCESS_SECRET (no extra env var), so rotating that secret changes the
 * code of any demo session still in progress; add a dedicated CASH_OTP_SECRET if that matters.
 */
export const deriveCashOtp = (bookingId, secret = env.JWT_ACCESS_SECRET) => {
  const digest = crypto.createHmac('sha256', secret).update(`cash-otp:${bookingId}`).digest();
  return String(1000 + (digest.readUInt32BE(0) % 9000));
};

export const matchesCashOtp = (bookingId, submitted) => {
  if (!/^\d{4}$/.test(String(submitted))) return false;
  return crypto.timingSafeEqual(
    Buffer.from(deriveCashOtp(bookingId)),
    Buffer.from(String(submitted))
  );
};

export default { deriveCashOtp, matchesCashOtp };
