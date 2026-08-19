import { timeToMinutes, minutesToTime } from '../../src/common/utils/timeUtils.js';

describe('timeUtils (Unit)', () => {
  describe('timeToMinutes', () => {
    it('should convert HH:mm strings to integer minutes', () => {
      expect(timeToMinutes('00:00')).toBe(0);
      expect(timeToMinutes('10:30')).toBe(630);
      expect(timeToMinutes('14:00')).toBe(840);
      expect(timeToMinutes('23:59')).toBe(1439);
    });

    it('should handle invalid inputs gracefully', () => {
      expect(timeToMinutes(null)).toBe(0);
      expect(timeToMinutes('')).toBe(0);
      expect(timeToMinutes(123)).toBe(0);
    });
  });

  describe('minutesToTime', () => {
    it('should convert integer minutes back to HH:mm strings', () => {
      expect(minutesToTime(0)).toBe('00:00');
      expect(minutesToTime(630)).toBe('10:30');
      expect(minutesToTime(840)).toBe('14:00');
      expect(minutesToTime(1439)).toBe('23:59');
    });

    it('should handle invalid inputs gracefully', () => {
      expect(minutesToTime(null)).toBe('00:00');
      expect(minutesToTime(NaN)).toBe('00:00');
    });
  });
});
