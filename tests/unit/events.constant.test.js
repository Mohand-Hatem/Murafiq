import { EVENTS } from '../../src/common/constants/events.constant.js';

describe('Domain Events Integrity', () => {
  it('contains no undefined or empty event names', () => {
    Object.entries(EVENTS).forEach(([_key, value]) => {
      expect(value).toBeDefined();
      expect(typeof value).toBe('string');
      expect(value.trim().length).toBeGreaterThan(0);
    });
  });

  it('contains unique values for every event constant', () => {
    const values = Object.values(EVENTS);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });
});
