export const DEFAULT_PROFILE_IMAGE_URL =
  'https://res.cloudinary.com/s2mm691a/image/upload/v1787433580/murafiq-avatar.png';

export const BUSINESS_TIMEZONE = 'Africa/Cairo';

// Platform commission (product owner decision 2026-10-22). Every fallback uses this; each
// payment snapshots the percentage it was charged, so changing it never rewrites history.
export const PLATFORM_FEE_DEFAULT_PERCENTAGE = 20;

export const DEFAULT_CAPS = {
  CLIENT_DAILY_REQUESTS_VERIFIED: 5,
  STYLIST_DAILY_OFFERS: 5,
};

export default {
  DEFAULT_PROFILE_IMAGE_URL,
  BUSINESS_TIMEZONE,
  PLATFORM_FEE_DEFAULT_PERCENTAGE,
  DEFAULT_CAPS,
};
