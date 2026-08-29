import crypto from 'crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import authRepository from './auth.repository.js';
import sessionRepository from './session.repository.js';
import User from '../users/user.model.js';
import mailService from '../mail/mail.service.js';
import generateOtp from '../../common/utils/generateOtp.js';
import { generateAccessToken, generateRefreshToken } from '../../common/utils/generateTokens.js';
import { ACCOUNT_STATUS } from '../../common/constants/statuses.constant.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import eventBus from '../../common/events/event-bus.js';
import env from '../../config/env.config.js';
import logger from '../../config/logger.config.js';
import {
  verifyEmailTemplate,
  otpTemplate,
  forgotPasswordTemplate,
} from '../mail/templates/index.js';
import { ensureUserSubscription } from '../subscriptions/subscription.service.js';
import { invalidate as invalidateSessionCache } from '../../common/utils/tokenVersionCache.js';

const SALT_ROUNDS = 12;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

/**
 * Refresh-token lifetime in ms, derived from the configured string so the stored
 * session expiry always matches the JWT's own expiry rather than drifting from it.
 */
const refreshTtlMs = () => {
  const raw = String(env.REFRESH_TOKEN_EXPIRES_IN || '30d').trim();
  const m = raw.match(/^(\d+)\s*([smhd])$/i);
  if (!m) return 30 * 24 * 60 * 60 * 1000;
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2].toLowerCase()];
  return n * unit;
};

/**
 * Issue a token pair and register a NEW session for this device.
 *
 * The access token carries `tv` (the global revocation stamp). The refresh token carries
 * `sid`, the id of the session row it belongs to — that is what lets rotation target one
 * device atomically instead of clobbering every session the user has.
 */
const issueTokensForNewSession = async (user, { deviceLabel } = {}) => {
  const userId = user._id.toString();
  const accessToken = generateAccessToken({
    sub: userId,
    role: user.role,
    tv: user.tokenVersion ?? 0,
  });

  const sessionId = new mongoose.Types.ObjectId();
  // `jti` is a per-issuance nonce, and it is load-bearing. Without it, two refresh tokens
  // minted for the same session inside the same second are BYTE-IDENTICAL — jsonwebtoken's
  // `iat` has one-second resolution — so a rotation would hand back the very token it was
  // supposed to supersede, and replay detection could never fire.
  const refreshToken = generateRefreshToken({
    sub: userId,
    sid: sessionId.toString(),
    jti: crypto.randomUUID(),
  });
  const expiresAt = new Date(Date.now() + refreshTtlMs());

  await User.updateOne(
    { _id: userId },
    {
      $push: {
        sessions: {
          $each: [
            {
              _id: sessionId,
              tokenHash: sessionRepository.hashToken(refreshToken),
              deviceLabel: deviceLabel || 'Unknown device',
              createdAt: new Date(),
              lastUsedAt: new Date(),
              expiresAt,
            },
          ],
          $slice: -Math.abs(env.MAX_SESSIONS_PER_USER || 10),
        },
      },
    }
  );

  return { accessToken, refreshToken, sessionId: sessionId.toString() };
};

const register = async ({ name, email, password, role }) => {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const otp = generateOtp(6);
  const otpCode = await bcrypt.hash(otp, SALT_ROUNDS);

  const user = await authRepository.createUser({
    name,
    email,
    passwordHash,
    role,
    otpCode,
    otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
    otpAttempts: 0,
  });

  try {
    const { subject, html } = verifyEmailTemplate({ name: user.name, otp });
    await mailService.sendMail({ to: user.email, subject, html });
  } catch (mailErr) {
    logger.error(`Registration verification email failed for user ${user._id} (${user.email}): ${mailErr.message}`);
  }

  try {
    await ensureUserSubscription(user._id, user.role);
  } catch (subErr) {
    logger.error(`Registration subscription auto-provisioning failed for user ${user._id}: ${subErr.message}`);
  }

  eventBus.emit(EVENTS.USER_REGISTERED, { userId: user._id.toString() });

  return user;
};

const verifyEmail = async ({ email, otp }) => {
  const user = await authRepository.findByEmail(email, { withSecrets: true });
  if (!user || !user.otpCode || !user.otpExpiresAt) {
    throw new ApiError(400, 'Invalid or expired OTP');
  }
  if (user.otpExpiresAt.getTime() < Date.now()) {
    throw new ApiError(400, 'Invalid or expired OTP');
  }
  const matches = await bcrypt.compare(otp, user.otpCode);
  if (!matches) {
    user.otpAttempts = (user.otpAttempts || 0) + 1;
    if (user.otpAttempts >= 5) {
      user.otpCode = undefined;
      user.otpExpiresAt = undefined;
      user.otpAttempts = 0;
    }
    await user.save();
    throw new ApiError(400, 'Invalid or expired OTP');
  }

  user.isEmailVerified = true;
  user.otpCode = undefined;
  user.otpExpiresAt = undefined;
  user.otpAttempts = 0;
  await user.save();

  return user;
};

const resendOtp = async ({ email }) => {
  const user = await authRepository.findByEmail(email, { withSecrets: true });
  if (!user) {
    throw new ApiError(404, 'No account found with that email');
  }
  if (user.isEmailVerified) {
    throw new ApiError(400, 'Email is already verified');
  }

  const otp = generateOtp(6);
  user.otpCode = await bcrypt.hash(otp, SALT_ROUNDS);
  user.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
  user.otpAttempts = 0;
  await user.save();

  const { subject, html } = otpTemplate({ name: user.name, otp });
  await mailService.sendMail({ to: user.email, subject, html });
};

const login = async ({ email, password }, { deviceLabel } = {}) => {
  const user = await authRepository.findByEmail(email, { withSecrets: true });
  if (!user) {
    throw new ApiError(401, 'Invalid credentials');
  }
  if (user.accountStatus === ACCOUNT_STATUS.SUSPENDED) {
    throw new ApiError(403, 'Account suspended. Contact support.');
  }
  if (user.accountStatus === ACCOUNT_STATUS.BLOCKED) {
    throw new ApiError(403, 'Account blocked. Contact support.');
  }
  if (!user.isEmailVerified) {
    throw new ApiError(403, 'Account not verified. Please check your email.');
  }
  if (!user.passwordHash) {
    throw new ApiError(400, 'This account uses Google Sign-In. Continue with Google instead of a password.');
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    throw new ApiError(401, 'Invalid credentials');
  }

  const tokens = await issueTokensForNewSession(user, { deviceLabel });
  return { user, ...tokens };
};

const googleLogin = async ({ idToken, role }, { deviceLabel } = {}) => {
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw new ApiError(401, 'Invalid Google token');
  }
  if (!payload?.email_verified) {
    throw new ApiError(401, 'Google account email is not verified');
  }

  const { sub: googleId, email, name } = payload;

  let user = await authRepository.findByGoogleId(googleId, { withSecrets: true });

  if (!user) {
    user = await authRepository.findByEmail(email, { withSecrets: true });
    if (user) {
      // Auto-link: Google only returns emails it has itself verified, so it's safe to attach
      // this Google identity to the existing local account rather than erroring or duplicating it.
      user.googleId = googleId;
      user.isEmailVerified = true; // Google's verification supersedes any pending local OTP step
    }
  }

  if (!user) {
    user = await authRepository.createUser({
      name: name || email.split('@')[0],
      email,
      googleId,
      role,
      isEmailVerified: true, // Google already verified it — no OTP step for this account
    });
    try {
      await ensureUserSubscription(user._id, user.role);
    } catch (subErr) {
      logger.error(`Google login subscription auto-provisioning failed for user ${user._id}: ${subErr.message}`);
    }
    eventBus.emit(EVENTS.USER_REGISTERED, { userId: user._id.toString() });
  }

  // Google Sign-In must not be an alternate door past a suspension or block.
  if (user.accountStatus === ACCOUNT_STATUS.SUSPENDED) {
    throw new ApiError(403, 'Account suspended. Contact support.');
  }
  if (user.accountStatus === ACCOUNT_STATUS.BLOCKED) {
    throw new ApiError(403, 'Account blocked. Contact support.');
  }

  const tokens = await issueTokensForNewSession(user, { deviceLabel });
  return { user, ...tokens };
};

/**
 * Current-device logout. Removes ONLY this device's session; other devices stay signed in.
 *
 * Deliberately does not bump tokenVersion — that is a global stamp, and using it for an
 * ordinary logout would sign the user out of every other device too. The trade-off is that
 * this device's access token stays technically valid until it expires (15m by default).
 * That is acceptable because the token has already been discarded by the client and the
 * refresh token is gone, so the session cannot be extended. Anyone who needs the stronger
 * guarantee uses logout-all, which does bump it.
 */
const logout = async (userId, refreshToken) => {
  if (!refreshToken) {
    return { revoked: false };
  }
  let decoded;
  try {
    decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET);
  } catch {
    return { revoked: false }; // already invalid; nothing to revoke
  }
  if (String(decoded.sub) !== String(userId) || !decoded.sid) {
    return { revoked: false };
  }
  const revoked = await sessionRepository.removeSession(userId, decoded.sid);
  return { revoked };
};

/**
 * Sign out everywhere. Clears every session AND bumps tokenVersion, so outstanding access
 * tokens die immediately rather than lingering for the remainder of their window.
 */
const logoutAll = async (userId) => {
  await sessionRepository.removeAllSessions(userId);
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  invalidateSessionCache(userId);
  return { revoked: true };
};

/** A user's own active devices. Never exposes token hashes. */
const listSessions = async (userId) => sessionRepository.listSessions(userId);

const refreshTokens = async (refreshToken) => {
  if (!refreshToken) {
    throw new ApiError(401, 'Refresh token missing');
  }

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET);
  } catch {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  const user = await authRepository.findById(decoded.sub);
  if (!user) {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  // A suspended or blocked account must not be able to mint fresh credentials. Without
  // this, revoking access at the middleware would still leave the refresh endpoint as an
  // open door back in.
  if (
    user.accountStatus === ACCOUNT_STATUS.SUSPENDED ||
    user.accountStatus === ACCOUNT_STATUS.BLOCKED
  ) {
    throw new ApiError(403, `Account ${user.accountStatus}. Contact support.`);
  }

  if (!decoded.sid) {
    // Pre-sessions token. There is no session row to rotate, so it cannot be honoured.
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  const presentedHash = sessionRepository.hashToken(refreshToken);
  const newRefreshToken = generateRefreshToken({
    sub: decoded.sub,
    sid: decoded.sid,
    jti: crypto.randomUUID(), // see issueTokensForNewSession — guarantees a distinct token
  });
  const newExpiresAt = new Date(Date.now() + refreshTtlMs());

  // Single atomic swap: only lands if this exact token is still the live one for the
  // session. Two concurrent refreshes with the same token cannot both win — the loser
  // gets null and is handled as reuse below.
  const rotated = await sessionRepository.rotateSession(
    decoded.sub,
    decoded.sid,
    presentedHash,
    sessionRepository.hashToken(newRefreshToken),
    newExpiresAt
  );

  if (!rotated) {
    // The signature is valid but this token is no longer the live one for its session:
    // it was already rotated away, or the session is gone.
    //
    // Response is scoped to the AFFECTED SESSION ONLY. Revoking every device would make a
    // single mis-timed client retry sign the user out everywhere — a self-inflicted
    // denial of service on the far more common benign cause. Whoever holds the current
    // token for this session keeps it; only this compromised chain dies.
    //
    // `tokenVersion` is reserved for true GLOBAL revocation — logout-all, password
    // security events, admin action, confirmed compromise — and is deliberately not
    // touched here.
    const stillExists = await sessionRepository.findSessionById(decoded.sub, decoded.sid);
    if (stillExists) {
      await sessionRepository.removeSession(decoded.sub, decoded.sid);
      logger.warn(
        `[SECURITY] Refresh-token reuse detected for user ${decoded.sub}; session ${decoded.sid} revoked.`
      );
      eventBus.emit(EVENTS.REFRESH_TOKEN_REUSE_DETECTED, {
        userId: String(decoded.sub),
        sessionId: String(decoded.sid),
        scope: 'session',
      });
    }
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  const accessToken = generateAccessToken({
    sub: user._id.toString(),
    role: user.role,
    tv: user.tokenVersion ?? 0,
  });

  return { user, accessToken, refreshToken: newRefreshToken };
};

const forgotPassword = async ({ email }) => {
  const user = await authRepository.findByEmail(email, { withSecrets: true });
  if (!user) return; // never reveal whether the email exists — controller always responds generically

  const otp = generateOtp(6);
  user.otpCode = await bcrypt.hash(otp, SALT_ROUNDS);
  user.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
  user.otpAttempts = 0;
  await user.save();

  const { subject, html } = forgotPasswordTemplate({ name: user.name, otp });
  await mailService.sendMail({ to: user.email, subject, html });
};

const resetPassword = async ({ email, otp, newPassword }) => {
  const user = await authRepository.findByEmail(email, { withSecrets: true });
  if (!user || !user.otpCode || !user.otpExpiresAt) {
    throw new ApiError(400, 'Invalid or expired OTP');
  }
  if (user.otpExpiresAt.getTime() < Date.now()) {
    throw new ApiError(400, 'Invalid or expired OTP');
  }
  const matches = await bcrypt.compare(otp, user.otpCode);
  if (!matches) {
    user.otpAttempts = (user.otpAttempts || 0) + 1;
    if (user.otpAttempts >= 5) {
      user.otpCode = undefined;
      user.otpExpiresAt = undefined;
      user.otpAttempts = 0;
    }
    await user.save();
    throw new ApiError(400, 'Invalid or expired OTP');
  }

  user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  user.otpCode = undefined;
  user.otpExpiresAt = undefined;
  user.otpAttempts = 0;
  await user.save();

  // A password reset is the "my account is compromised" flow, so every credential the
  // attacker might hold must die at once — refresh sessions AND outstanding access
  // tokens. Clearing sessions alone left the attacker authenticated for the remainder of
  // their access-token window; bumping tokenVersion closes that gap.
  await User.updateOne(
    { _id: user._id },
    { $set: { sessions: [] }, $inc: { tokenVersion: 1 } }
  );
  invalidateSessionCache(user._id);
};

const changePassword = async (userId, { currentPassword, newPassword }) => {
  const user = await authRepository.findById(userId, { withSecrets: true });
  if (!user) {
    throw new ApiError(404, 'User not found');
  }
  if (!user.passwordHash) {
    throw new ApiError(400, 'This account uses Google Sign-In. Continue with Google instead of a password.');
  }
  const matches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!matches) {
    throw new ApiError(401, 'Current password is incorrect');
  }
  user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await user.save();

  // Same reasoning as reset: a deliberate password change must not leave an older
  // credential working anywhere. Signs the user out of every device, including this one.
  await User.updateOne(
    { _id: user._id },
    { $set: { sessions: [] }, $inc: { tokenVersion: 1 } }
  );
  invalidateSessionCache(user._id);
};

export default {
  register,
  logoutAll,
  listSessions,
  verifyEmail,
  resendOtp,
  login,
  googleLogin,
  logout,
  refreshTokens,
  forgotPassword,
  resetPassword,
  changePassword,
};
