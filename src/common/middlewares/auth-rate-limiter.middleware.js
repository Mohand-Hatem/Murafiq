import rateLimit from 'express-rate-limit';

// Stricter than the global baseline limiter — applied only to sensitive auth routes
// (login, register, forgot-password) to slow down brute-force/credential-stuffing attempts.
export const authRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
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
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res, next) => {
    next(new ApiError(429, 'Please wait a minute before requesting another code.'));
  },
});
