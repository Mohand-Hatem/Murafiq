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

/**
 * Returns start and end Date objects for the current calendar month in BUSINESS_TIMEZONE ('Africa/Cairo').
 *
 * Derives the Cairo-local year/month, then reuses getBusinessDayRange's already-correct UTC-offset
 * math for the 1st and last day of that month, rather than duplicating timezone arithmetic. The
 * previous implementation computed pure-UTC month boundaries despite its own docstring claiming
 * BUSINESS_TIMEZONE — Cairo is UTC+2/+3, so the first ~2-3 hours of a Cairo month were attributed
 * to the previous month (and the last ~2-3 hours of a Cairo month were dropped).
 */
export const getBusinessMonthRange = (date = new Date(), timeZone = BUSINESS_TIMEZONE) => {
  const { year, month } = (() => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(date);
    return {
      year: parseInt(parts.find((p) => p.type === 'year').value, 10),
      month: parseInt(parts.find((p) => p.type === 'month').value, 10), // 1-12
    };
  })();

  // Anchor at UTC noon so formatting in `timeZone` can never roll onto an adjacent calendar day
  // (Cairo's offset is at most +3h, nowhere near the ±12h needed to shift a noon-UTC instant).
  const firstOfMonthAnchor = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  const lastOfMonthAnchor = new Date(Date.UTC(year, month, 0, 12, 0, 0)); // day 0 of next month = last day of this one

  const { startOfDay: startOfMonth } = getBusinessDayRange(firstOfMonthAnchor, timeZone);
  const { endOfDay: endOfMonth } = getBusinessDayRange(lastOfMonthAnchor, timeZone);

  return { startOfMonth, endOfMonth };
};

getBusinessDayRange.getBusinessDayRange = getBusinessDayRange;
getBusinessDayRange.getBusinessMonthRange = getBusinessMonthRange;

export default getBusinessDayRange;
