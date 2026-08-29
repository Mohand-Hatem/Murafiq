import jwt from 'jsonwebtoken';
import env from '../../config/env.config.js';

// Lifetimes come from configuration, not literals — a deployment that needs a shorter
// access-token window (or a longer refresh window for a mobile-heavy audience) should not
// require a code change.

export const generateAccessToken = (payload) => {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_EXPIRES_IN });
};

export const generateRefreshToken = (payload) => {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: env.REFRESH_TOKEN_EXPIRES_IN });
};

export default { generateAccessToken, generateRefreshToken };
