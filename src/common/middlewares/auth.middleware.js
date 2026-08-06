import jwt from 'jsonwebtoken';
import env from '../../config/env.config.js';

// Reads the access token from either source — cookie (web) or Authorization: Bearer header
// (mobile) — checked in that order, so one middleware supports both client types.
const authMiddleware = (req, res, next) => {
  const bearerHeader = req.headers.authorization;
  const bearerToken = bearerHeader?.startsWith('Bearer ') ? bearerHeader.slice('Bearer '.length) : null;
  const token = req.cookies?.accessToken || bearerToken;

  if (!token) {
    return next(new ApiError(401, 'Authentication required'));
  }

  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    req.user = { id: decoded.sub, role: decoded.role };
    return next();
  } catch {
    return next(new ApiError(401, 'Invalid or expired access token'));
  }
};

export default authMiddleware;
