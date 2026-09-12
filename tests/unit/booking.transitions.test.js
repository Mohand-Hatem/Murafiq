import { BOOKING_TRANSITIONS, isLegalTransition, legalFromStatesFor }
  from '../../src/modules/bookings/booking.transitions.js';
import { BOOKING_STATUS } from '../../src/common/constants/statuses.constant.js';

describe('BOOKING_TRANSITIONS', () => {
  it('covers every booking status exactly once as a key', () => {
    expect(Object.keys(BOOKING_TRANSITIONS).sort())
      .toEqual(Object.values(BOOKING_STATUS).sort());
  });

  it('only ever targets a real booking status', () => {
    const valid = new Set(Object.values(BOOKING_STATUS));
    for (const targets of Object.values(BOOKING_TRANSITIONS)) {
      for (const t of targets) expect(valid.has(t)).toBe(true);
    }
  });

  it('keeps the three terminal states terminal', () => {
    expect(BOOKING_TRANSITIONS[BOOKING_STATUS.CANCELLED]).toEqual([]);
    expect(BOOKING_TRANSITIONS[BOOKING_STATUS.NO_SHOW_STYLIST]).toEqual([]);
    expect(BOOKING_TRANSITIONS[BOOKING_STATUS.NO_SHOW_CLIENT]).toEqual([]);
  });

  it('forbids cancelling an in-progress session (audit X10)', () => {
    expect(isLegalTransition(BOOKING_STATUS.IN_PROGRESS, BOOKING_STATUS.CANCELLED)).toBe(false);
  });

  it('allows confirmed -> cancelled', () => {
    expect(isLegalTransition(BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CANCELLED)).toBe(true);
  });

  it('allows completed -> disputed (the 48h window)', () => {
    expect(isLegalTransition(BOOKING_STATUS.COMPLETED, BOOKING_STATUS.DISPUTED)).toBe(true);
  });

  it('allows disputed to be restored only to confirmed or in-progress', () => {
    expect(isLegalTransition(BOOKING_STATUS.DISPUTED, BOOKING_STATUS.CONFIRMED)).toBe(true);
    expect(isLegalTransition(BOOKING_STATUS.DISPUTED, BOOKING_STATUS.IN_PROGRESS)).toBe(true);
    expect(isLegalTransition(BOOKING_STATUS.DISPUTED, BOOKING_STATUS.NO_SHOW_CLIENT)).toBe(false);
  });

  it('legalFromStatesFor inverts the map', () => {
    expect(legalFromStatesFor(BOOKING_STATUS.COMPLETED).sort())
      .toEqual([BOOKING_STATUS.DISPUTED, BOOKING_STATUS.IN_PROGRESS].sort());
  });
});
