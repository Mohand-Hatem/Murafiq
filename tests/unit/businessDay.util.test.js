import getBusinessDayRange from '../../src/common/utils/businessDay.util.js';

describe('Cairo Timezone Calculations', () => {
  it('correctly maps 01:30 Cairo time (22:30 UTC previous day) to the current Cairo calendar day', () => {
    // 22:30 UTC on Aug 23 is 01:30 AM Cairo time on Aug 24 (UTC+3 summer DST)
    const instant = new Date('2026-08-23T22:30:00.000Z');
    const { startOfDay, endOfDay } = getBusinessDayRange(instant, 'Africa/Cairo');

    // Cairo midnight on Aug 24 is 2026-08-23T21:00:00.000Z
    expect(startOfDay.toISOString()).toBe('2026-08-23T21:00:00.000Z');
    expect(endOfDay.toISOString()).toBe('2026-08-24T20:59:59.999Z');
    expect(instant.getTime()).toBeGreaterThanOrEqual(startOfDay.getTime());
    expect(instant.getTime()).toBeLessThanOrEqual(endOfDay.getTime());
  });

  it('correctly calculates winter standard time Cairo midnight (UTC+2)', () => {
    const instant = new Date('2026-01-15T12:00:00.000Z');
    const { startOfDay, endOfDay } = getBusinessDayRange(instant, 'Africa/Cairo');

    // Cairo midnight on Jan 15 is 2026-01-14T22:00:00.000Z
    expect(startOfDay.toISOString()).toBe('2026-01-14T22:00:00.000Z');
    expect(endOfDay.toISOString()).toBe('2026-01-15T21:59:59.999Z');
  });

  it('handles minute 0 (midnight) without dropping the offset', () => {
    const sessionDate = new Date('2026-08-25T00:00:00.000Z');
    const { startOfDay } = getBusinessDayRange(sessionDate, 'Africa/Cairo');
    const startMinute = 0; // midnight
    const scheduledDateTime = new Date(startOfDay.getTime() + startMinute * 60 * 1000);

    expect(scheduledDateTime.toISOString()).toBe('2026-08-24T21:00:00.000Z');
  });
});
