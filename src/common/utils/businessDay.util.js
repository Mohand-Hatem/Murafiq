import { BUSINESS_TIMEZONE } from '../constants/defaults.constant.js';

/**
 * Returns start and end Date objects for the current calendar day in BUSINESS_TIMEZONE ('Africa/Cairo').
 */
export const getBusinessDayRange = (date = new Date(), timeZone = BUSINESS_TIMEZONE) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const dateStr = formatter.format(date); // YYYY-MM-DD in target timezone
  const utcGuess = new Date(`${dateStr}T00:00:00.000Z`);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(utcGuess);

  const hourPart = parseInt(parts.find((p) => p.type === 'hour').value, 10) % 24;
  const minutePart = parseInt(parts.find((p) => p.type === 'minute').value, 10);
  const offsetMs = (hourPart * 60 + minutePart) * 60 * 1000;

  const startOfDay = new Date(utcGuess.getTime() - offsetMs);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);

  return { startOfDay, endOfDay };
};

export default getBusinessDayRange;
