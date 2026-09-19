import env from '../../../config/env.config.js';

/**
 * Feature flag kill-switch middleware for Virtual Try-On.
 *
 * Approved Decision Q1: When AI_TRY_ON_ENABLED is false, return 404 Not Found.
 * Do not consume quota, enqueue jobs, or reveal route existence.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export const tryOnGuard = (req, res, next) => {
  if (!env.AI_TRY_ON_ENABLED) {
    return next(new ApiError(404, 'Not found'));
  }
  next();
};

export default tryOnGuard;
