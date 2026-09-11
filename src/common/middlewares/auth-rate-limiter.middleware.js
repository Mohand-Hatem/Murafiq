import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import createRateLimitStore from './rate-limit-store.js';

// Keyed on the ACCOUNT alone when one is identifiable, not the account plus IP. That is
// the entire point: a pure per-IP limit lets a distributed attacker spread requests
// across many source addresses and get a fresh budget from each one while still only
// ever targeting one account's `email` — combining IP into the key would silently
// re-introduce exactly that hole (every IP would again get its own bucket for the same
// target account). Falls back to IP alone only when the body has no email at all (a
// malformed request, or a route this key generator is reused for that doesn't take one),
// so the limiter never throws on a request it can't key by account. See
// docs/AUDIT_2026_09_FULL_SYSTEM.md finding X27.
export const accountAwareKey = (req) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : null;
  return email ? `email:${email}` : ipKeyGenerator(req.ip);
};

// Stricter than the global baseline limiter — applied only to sensitive auth routes
// (login, register, forgot-password, verify-email, reset-password) to slow down
// brute-force/credential-stuffing attempts.
export const authRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore(),
  keyGenerator: accountAwareKey,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res, next) => {
    next(new ApiError(429, 'Too many attempts. Please try again in 5 minutes.'));
  },
});

// resend-otp gets its own, tighter cadence (1 per 60s) rather than the 5/15min auth limiter,
// since it's a lower-risk action a legitimate user might genuinely need to retry quickly.
export const otpResendRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore(),
  keyGenerator: accountAwareKey,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res, next) => {
    next(new ApiError(429, 'Please wait a minute before requesting another code.'));
  },
});

// Dedicated rate limiter for payment webhook callbacks. Deliberately generous and
// IP-keyed (unlike the two above): the caller is a payment provider's fixed egress pool,
// not an end user, so an account-aware key makes no sense here.
export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore(),
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res, next) => {
    next(new ApiError(429, 'Too many webhook requests. Please try again later.'));
  },
});
