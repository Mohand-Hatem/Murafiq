import rateLimit from 'express-rate-limit';

const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res, next) => {
    next(new ApiError(429, 'Too many requests from this IP, please try again after 15 minutes'));
  },
});

export default globalRateLimiter;
