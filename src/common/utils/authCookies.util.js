import env from '../../config/env.config.js';

const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000; // 15m — mirrors JWT_ACCESS_SECRET expiry
const REFRESH_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30d — mirrors JWT_REFRESH_SECRET expiry

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
