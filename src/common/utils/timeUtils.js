/**
 * Converts HH:mm time string (e.g. "10:30") to integer minutes since midnight (630).
 */
export const timeToMinutes = (timeStr) => {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * Converts integer minutes since midnight (630) back to HH:mm string ("10:30").
 */
export const minutesToTime = (mins) => {
  if (typeof mins !== 'number' || isNaN(mins)) return '00:00';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export default {
  timeToMinutes,
  minutesToTime,
};
