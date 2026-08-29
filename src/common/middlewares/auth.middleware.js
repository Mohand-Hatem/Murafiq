import jwt from 'jsonwebtoken';
import env from '../../config/env.config.js';
import { getCurrentSessionState } from '../utils/tokenVersionCache.js';
import ApiError from '../utils/ApiError.js';
import { ACCOUNT_STATUS } from '../constants/statuses.constant.js';

// Reads the access token from either source — cookie (web) or Authorization: Bearer header
// (mobile) — checked in that order, so one middleware supports both client types.
const authMiddleware = async (req, res, next) => {
  const bearerHeader = req.headers.authorization;
  const bearerToken = bearerHeader?.startsWith('Bearer ') ? bearerHeader.slice('Bearer '.length) : null;
  const token = req.cookies?.accessToken || bearerToken;

  if (!token) {
    return next(new ApiError(401, 'Authentication required'));
  }

  let decoded;
  try {
    decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  } catch {
    return next(new ApiError(401, 'Invalid or expired access token'));
  }

  // Revocation & Account Status check. A signature-valid token is not enough:
  // 1. suspending, restricting, or banning a user bumps `User.tokenVersion`, and any token
  //    minted before that bump must stop working immediately rather than lingering for 15m.
  // 2. an account with status 'suspended' or 'blocked' must be explicitly rejected (403).
  // Cached, so this costs at most one DB read per user per TTL window.
  try {
    const sessionState = await getCurrentSessionState(decoded.sub);

    // undefined => no database connection, so the check could not run. Every downstream
    // handler will fail anyway; nothing is exposed by letting the request continue.
    if (sessionState !== undefined) {
      // null => the user no longer exists (hard-deleted). Outstanding tokens must die.
      if (sessionState.version === null) {
        return next(new ApiError(401, 'Session is no longer valid'));
      }

      // Tokens issued before tokenVersion existed carry no `tv` claim; treat those as 0
      // so sessions live at the moment of deploy are not all invalidated at once.
      const tokenVersion = decoded.tv ?? 0;
      if (tokenVersion !== sessionState.version) {
        return next(new ApiError(401, 'Session has been revoked. Please sign in again.'));
      }

      if (sessionState.accountStatus === ACCOUNT_STATUS.SUSPENDED) {
        return next(new ApiError(403, 'Account suspended. Contact support.'));
      }

      if (sessionState.accountStatus === ACCOUNT_STATUS.BLOCKED) {
        return next(new ApiError(403, 'Account blocked. Contact support.'));
      }
    }
  } catch (err) {
    return next(err);
  }

  req.user = { id: decoded.sub, role: decoded.role };
  return next();
};

export default authMiddleware;
