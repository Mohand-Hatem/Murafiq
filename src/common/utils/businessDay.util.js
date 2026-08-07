import { BUSINESS_TIMEZONE } from '../constants/defaults.constant.js';

/**
 * Returns start and end Date objects for the current calendar day in BUSINESS_TIMEZONE ('Africa/Cairo').
 */
export const getBusinessDayRange = (date = new Date(), timeZone = BUSINESS_TIMEZONE) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === 'year').value;
  const month = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;

  // Construct ISO strings at start and end of day in target timezone
  const startOfDay = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  const endOfDay = new Date(`${year}-${month}-${day}T23:59:59.999Z`);

  return { startOfDay, endOfDay };
};

export default getBusinessDayRange;
