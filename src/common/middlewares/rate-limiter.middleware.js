import rateLimit from 'express-rate-limit';
import createRateLimitStore from './rate-limit-store.js';

// Exported standalone so it is unit-testable without exercising the rate-limit machinery
// itself (which is unconditionally skipped under NODE_ENV=test, making the path logic
// otherwise untestable in this suite).
//
// Two exemptions, same reasoning: neither is "user traffic" competing for the per-IP
// budget. A health check is infrastructure noise a load balancer polls every few seconds
// from one source IP. A payment webhook already has its own dedicated, HMAC-gated
// `webhookRateLimiter` (auth-rate-limiter.middleware.js) — stacking the global
// 100-per-15-minutes limiter in front of it meant a legitimate Paymob retry burst could
// be 429'd by the OUTER limiter even though the inner one would have allowed it, leaving
// an order stuck 'pending' after money was actually taken. See
// docs/AUDIT_2026_09_FULL_SYSTEM.md finding X27.
export const EXEMPT_PATHS = new Set([
  '/api/v1/health',
  '/api/v1/payments/callback',
  '/api/v1/subscriptions/webhook',
]);

export const shouldSkipGlobalRateLimit = (req) =>
  process.env.NODE_ENV === 'test' || EXEMPT_PATHS.has(req.path);

const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore(),
  skip: shouldSkipGlobalRateLimit,
  handler: (req, res, next) => {
    next(new ApiError(429, 'Too many requests from this IP, please try again after 15 minutes'));
  },
});

export default globalRateLimiter;
