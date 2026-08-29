import authService from './auth.service.js';
import { toPublicUser } from './auth.dto.js';
import { isMobileClient, setAuthCookies, clearAuthCookies } from '../../common/utils/authCookies.util.js';

// Web (default): tokens as httpOnly cookies only. Mobile (X-Client-Type: mobile): tokens in the
// response body only, no cookies — see PHASE_01_AUTH.md step 5.
/**
 * A human-readable label for the "your devices" list. Derived from headers the client
 * already sends — no fingerprinting, no extra data collection beyond what identifies the
 * device to its owner.
 */
const deviceLabelFrom = (req) => {
  const explicit = req.headers['x-device-name'];
  if (explicit) return String(explicit).slice(0, 80);
  const ua = String(req.headers['user-agent'] || '');
  if (isMobileClient(req)) return ua ? `Mobile — ${ua.slice(0, 60)}` : 'Mobile device';
  if (/iPhone|iPad/i.test(ua)) return 'iOS browser';
  if (/Android/i.test(ua)) return 'Android browser';
  if (/Chrome/i.test(ua)) return 'Chrome';
  if (/Firefox/i.test(ua)) return 'Firefox';
  if (/Safari/i.test(ua)) return 'Safari';
  return ua ? ua.slice(0, 60) : 'Unknown device';
};

const respondWithTokens = (req, res, { statusCode, message, user, accessToken, refreshToken }) => {
  const data = { user: toPublicUser(user) };

  if (isMobileClient(req)) {
    data.accessToken = accessToken;
    data.refreshToken = refreshToken;
  } else {
    setAuthCookies(res, { accessToken, refreshToken });
  }

  return ApiResponse.success(res, { statusCode, message, data });
};

export const register = asyncHandler(async (req, res) => {
  const user = await authService.register(req.body);
  return ApiResponse.success(res, {
    statusCode: 201,
    message: 'Registration successful. Check your email for a verification code (or request a new one if not received).',
    data: { user: toPublicUser(user) },
  });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const user = await authService.verifyEmail(req.body);
  return ApiResponse.success(res, {
    message: 'Email verified successfully. You can now log in.',
    data: { user: toPublicUser(user) },
  });
});

export const resendOtp = asyncHandler(async (req, res) => {
  await authService.resendOtp(req.body);
  return ApiResponse.success(res, { message: 'A new verification code has been sent to your email.' });
});

export const login = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.login(req.body, {
    deviceLabel: deviceLabelFrom(req),
  });
  return respondWithTokens(req, res, { message: 'Login successful.', user, accessToken, refreshToken });
});

export const googleAuth = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.googleLogin(req.body, {
    deviceLabel: deviceLabelFrom(req),
  });
  return respondWithTokens(req, res, { message: 'Google sign-in successful.', user, accessToken, refreshToken });
});

// Current-device logout. The refresh token identifies WHICH session to end, so other
// devices stay signed in.
export const logout = asyncHandler(async (req, res) => {
  const incoming = isMobileClient(req) ? req.body?.refreshToken : req.cookies?.refreshToken;
  await authService.logout(req.user.id, incoming);
  clearAuthCookies(res);
  return ApiResponse.success(res, { message: 'Logged out successfully.' });
});

// Sign out everywhere: clears all sessions and bumps tokenVersion so outstanding access
// tokens are rejected immediately rather than lingering until they expire.
export const logoutAll = asyncHandler(async (req, res) => {
  await authService.logoutAll(req.user.id);
  clearAuthCookies(res);
  return ApiResponse.success(res, { message: 'Signed out of all devices.' });
});

// The user's own active devices. Token hashes are never included.
export const listSessions = asyncHandler(async (req, res) => {
  const sessions = await authService.listSessions(req.user.id);
  return ApiResponse.success(res, { message: 'Active sessions retrieved.', data: sessions });
});

export const refreshToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken = isMobileClient(req) ? req.body.refreshToken : req.cookies?.refreshToken;
  const { user, accessToken, refreshToken: newRefreshToken } = await authService.refreshTokens(incomingRefreshToken);
  return respondWithTokens(req, res, {
    message: 'Token refreshed.',
    user,
    accessToken,
    refreshToken: newRefreshToken,
  });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body);
  return ApiResponse.success(res, {
    message: 'If an account with that email exists, a reset code has been sent.',
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body);
  return ApiResponse.success(res, { message: 'Password reset successfully. Please log in again.' });
});

export const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword(req.user.id, req.body);
  return ApiResponse.success(res, { message: 'Password changed successfully.' });
});
