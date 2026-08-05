import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import authRepository from './auth.repository.js';
import mailService from '../mail/mail.service.js';
import generateOtp from '../../common/utils/generateOtp.js';
import { generateAccessToken, generateRefreshToken } from '../../common/utils/generateTokens.js';
import { ACCOUNT_STATUS } from '../../common/constants/statuses.constant.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import eventBus from '../../common/events/event-bus.js';
import env from '../../config/env.config.js';

const SALT_ROUNDS = 12;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

const otpEmailHtml = (otp) =>
  `<p>Your Murafiq verification code is:</p><h2>${otp}</h2><p>This code expires in 10 minutes.</p>`;

const issueTokensFor = async (user) => {
  const payload = { sub: user._id.toString(), role: user.role };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);
  user.refreshTokenHash = await bcrypt.hash(refreshToken, SALT_ROUNDS);
  await user.save();
  return { accessToken, refreshToken };
};

const register = async ({ nameEn, nameAr, email, phone, password, role }) => {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const otp = generateOtp(6);
  const otpCode = await bcrypt.hash(otp, SALT_ROUNDS);

  const user = await authRepository.createUser({
    nameEn,
    nameAr,
    email,
    phone,
    passwordHash,
    role,
    otpCode,
    otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  await mailService.sendMail({ to: user.email, subject: 'Verify your Murafiq account', html: otpEmailHtml(otp) });

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
    throw new ApiError(400, 'Invalid or expired OTP');
  }

  user.isEmailVerified = true;
  user.otpCode = undefined;
  user.otpExpiresAt = undefined;
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
  await user.save();

  await mailService.sendMail({ to: user.email, subject: 'Your Murafiq verification code', html: otpEmailHtml(otp) });
};

const login = async ({ email, password }) => {
  const user = await authRepository.findByEmail(email, { withSecrets: true });
  if (!user) {
    throw new ApiError(401, 'Invalid credentials');
  }
  if (user.accountStatus === ACCOUNT_STATUS.SUSPENDED) {
    throw new ApiError(403, 'Account suspended. Contact support.');
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

  const tokens = await issueTokensFor(user);
  return { user, ...tokens };
};

const googleLogin = async ({ idToken, role }) => {
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
      nameEn: name || email.split('@')[0],
      email,
      googleId,
      role,
      isEmailVerified: true, // Google already verified it — no OTP step for this account
    });
    eventBus.emit(EVENTS.USER_REGISTERED, { userId: user._id.toString() });
  }

  if (user.accountStatus === ACCOUNT_STATUS.SUSPENDED) {
    throw new ApiError(403, 'Account suspended. Contact support.');
  }

  const tokens = await issueTokensFor(user);
  return { user, ...tokens };
};

const logout = async (userId) => {
  const user = await authRepository.findById(userId, { withSecrets: true });
  if (!user) return;
  user.refreshTokenHash = undefined;
  await user.save();
};

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

  const user = await authRepository.findById(decoded.sub, { withSecrets: true });
  if (!user || !user.refreshTokenHash) {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  const matches = await bcrypt.compare(refreshToken, user.refreshTokenHash);
  if (!matches) {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  return issueTokensFor(user); // rotates the refresh token too
};

const forgotPassword = async ({ email }) => {
  const user = await authRepository.findByEmail(email, { withSecrets: true });
  if (!user) return; // never reveal whether the email exists — controller always responds generically

  const otp = generateOtp(6);
  user.otpCode = await bcrypt.hash(otp, SALT_ROUNDS);
  user.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
  await user.save();

  await mailService.sendMail({ to: user.email, subject: 'Reset your Murafiq password', html: otpEmailHtml(otp) });
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
    throw new ApiError(400, 'Invalid or expired OTP');
  }

  user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  user.otpCode = undefined;
  user.otpExpiresAt = undefined;
  user.refreshTokenHash = undefined; // invalidate all existing sessions
  await user.save();
};

const changePassword = async (userId, { currentPassword, newPassword }) => {
  const user = await authRepository.findById(userId, { withSecrets: true });
  if (!user) {
    throw new ApiError(404, 'User not found');
  }
  const matches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!matches) {
    throw new ApiError(401, 'Current password is incorrect');
  }
  user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await user.save();
};

export default {
  register,
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
