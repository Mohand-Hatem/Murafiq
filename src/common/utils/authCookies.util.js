import env from '../../config/env.config.js';

const parseTtlMs = (raw, fallbackMs) => {
  const m = String(raw || '').trim().match(/^(\d+)\s*([smhd])$/i);
  if (!m) return fallbackMs;
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2].toLowerCase()];
  return Number(m[1]) * unit;
};

const ACCESS_TOKEN_MAX_AGE_MS = parseTtlMs(env.ACCESS_TOKEN_EXPIRES_IN, 60 * 60 * 1000); // mirrors ACCESS_TOKEN_EXPIRES_IN
const REFRESH_TOKEN_MAX_AGE_MS = parseTtlMs(env.REFRESH_TOKEN_EXPIRES_IN, 30 * 24 * 60 * 60 * 1000); // mirrors REFRESH_TOKEN_EXPIRES_IN

const cookieOptions = (maxAge) => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge,
});

// Web clients (default, or explicit X-Client-Type: web) get httpOnly cookies and nothing in the
// response body. Mobile clients (X-Client-Type: mobile) get no cookies — tokens are returned in
// the JSON body instead by the controller, which stores/sends them itself.
export const isMobileClient = (req) => req.headers['x-client-type'] === 'mobile';

export const setAuthCookies = (res, { accessToken, refreshToken }) => {
  res.cookie('accessToken', accessToken, cookieOptions(ACCESS_TOKEN_MAX_AGE_MS));
  res.cookie('refreshToken', refreshToken, cookieOptions(REFRESH_TOKEN_MAX_AGE_MS));
};

export const clearAuthCookies = (res) => {
  res.clearCookie('accessToken', cookieOptions(0));
  res.clearCookie('refreshToken', cookieOptions(0));
};
