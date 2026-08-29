import getBusinessDayRange, { getBusinessMonthRange } from '../../src/common/utils/businessDay.util.js';

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

describe('getBusinessMonthRange — Cairo-anchored month boundaries', () => {
  // Regression test: a prior implementation computed pure-UTC month boundaries despite claiming
  // BUSINESS_TIMEZONE in its docstring — revenue for the first/last ~2-3 hours of a Cairo month
  // was silently attributed to the wrong month. This asserts against hand-verified Cairo instants,
  // not against the implementation's own math, so it would have caught that bug.

  it('winter standard time (UTC+2): March 2026 starts/ends on Cairo-local boundaries, not UTC ones', () => {
    const midMonth = new Date('2026-03-15T10:00:00.000Z');
    const { startOfMonth, endOfMonth } = getBusinessMonthRange(midMonth);

    // Cairo midnight March 1 2026 = UTC Feb 28 22:00 (UTC+2, no DST yet in March per Egypt's
    // current DST calendar — verified independently via Intl, not derived from the code under test)
    expect(startOfMonth.toISOString()).toBe('2026-02-28T22:00:00.000Z');
    expect(endOfMonth.toISOString()).toBe('2026-03-31T21:59:59.999Z');
  });

  it('a UTC instant that is still "last month" in UTC but already "this month" in Cairo is bucketed correctly', () => {
    // 2026-03-31T22:30:00Z is UTC+2 Cairo-local April 1, 00:30 — pure-UTC month math would
    // wrongly treat this as still being inside March.
    const rolloverInstant = new Date('2026-03-31T22:30:00.000Z');
    const { startOfMonth, endOfMonth } = getBusinessMonthRange(rolloverInstant);

    expect(startOfMonth.toISOString()).toBe('2026-03-31T22:00:00.000Z'); // Cairo April 1 00:00
    expect(rolloverInstant.getTime()).toBeGreaterThanOrEqual(startOfMonth.getTime());
    expect(rolloverInstant.getTime()).toBeLessThanOrEqual(endOfMonth.getTime());
  });

  it('handles a month where Cairo DST changes mid-month without a fixed offset assumption', () => {
    // Egypt's DST (introduced 2023) starts in late April — a naive implementation using one
    // offset for the whole month would get either boundary wrong.
    const midApril = new Date('2026-04-15T10:00:00.000Z');
    const { startOfMonth, endOfMonth } = getBusinessMonthRange(midApril);

    // Start-of-month still UTC+2 (before the spring-forward), end-of-month already UTC+3 —
    // these offsets differ, so a single-offset implementation cannot produce both correctly.
    expect(startOfMonth.toISOString()).toBe('2026-03-31T22:00:00.000Z');
    expect(endOfMonth.toISOString()).toBe('2026-04-30T20:59:59.999Z');
  });
});
