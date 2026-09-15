import {
  DRESS_CODE_MAP,
  EVENT_TYPES,
  resolveDressCode,
  deriveSeason,
} from '../../src/common/constants/dress-code.constant.js';
import {
  WARDROBE_FORMALITIES,
  WARDROBE_CATEGORIES,
} from '../../src/modules/wardrobe/wardrobe-item.model.js';

describe('Dress-Code Constants & Season Derivation (Unit)', () => {
  describe('DRESS_CODE_MAP and EVENT_TYPES', () => {
    it('covers at least 20 event types', () => {
      expect(EVENT_TYPES.length).toBeGreaterThanOrEqual(20);
      expect(Object.keys(DRESS_CODE_MAP).length).toBeGreaterThanOrEqual(20);
    });

    it('includes all mandatory canonical events from the specification', () => {
      const requiredEvents = [
        'wedding_formal',
        'wedding_casual',
        'engagement',
        'birthday_party',
        'dinner_casual',
        'dinner_fine_dining',
        'business_meeting',
        'interview',
        'work_office',
        'work_smart_casual',
        'university',
        'travel',
        'gym_sport',
        'beach',
        'funeral',
        'eid_religious',
        'date_night',
        'family_gathering',
      ];

      for (const event of requiredEvents) {
        expect(DRESS_CODE_MAP).toHaveProperty(event);
      }
    });

    it('ensures each event mapping only uses valid WARDROBE_FORMALITIES and WARDROBE_CATEGORIES', () => {
      for (const config of Object.values(DRESS_CODE_MAP)) {
        expect(Array.isArray(config.formality)).toBe(true);
        expect(config.formality.length).toBeGreaterThan(0);
        config.formality.forEach((f) => {
          expect(WARDROBE_FORMALITIES).toContain(f);
        });

        expect(Array.isArray(config.requiredSlots)).toBe(true);
        expect(config.requiredSlots.length).toBeGreaterThan(0);
        config.requiredSlots.forEach((slot) => {
          expect(WARDROBE_CATEGORIES).toContain(slot);
        });

        expect(Array.isArray(config.optionalSlots)).toBe(true);
        config.optionalSlots.forEach((slot) => {
          expect(WARDROBE_CATEGORIES).toContain(slot);
        });

        expect(typeof config.highStakes).toBe('boolean');
      }
    });
  });

  describe('resolveDressCode', () => {
    it('resolves known event types accurately and case-insensitively', () => {
      const formalWedding = resolveDressCode('wedding_formal');
      expect(formalWedding.resolved).toBe(true);
      expect(formalWedding.eventType).toBe('wedding_formal');
      expect(formalWedding.highStakes).toBe(true);
      expect(formalWedding.requiredSlots).toEqual(['top', 'bottom', 'shoes']);
      expect(formalWedding.formality).toContain('formal');

      const upperCaseDinner = resolveDressCode('  DINNER_CASUAL  ');
      expect(upperCaseDinner.resolved).toBe(true);
      expect(upperCaseDinner.eventType).toBe('dinner_casual');
      expect(upperCaseDinner.highStakes).toBe(false);
      expect(upperCaseDinner.formality).toContain('casual');
    });

    it('returns an explicit unresolved result for unknown events and NEVER silently defaults to casual', () => {
      const unknown1 = resolveDressCode('alien_invasion_party');
      expect(unknown1.resolved).toBe(false);
      expect(unknown1.eventType).toBe('alien_invasion_party');
      expect(unknown1).not.toHaveProperty('formality');

      const empty = resolveDressCode('');
      expect(empty.resolved).toBe(false);

      const nullInput = resolveDressCode(null);
      expect(nullInput.resolved).toBe(false);

      const undefinedInput = resolveDressCode(undefined);
      expect(undefinedInput.resolved).toBe(false);
    });
  });

  describe('deriveSeason in Africa/Cairo', () => {
    it('correctly maps dates across all four seasons in Cairo', () => {
      // Spring: March (3), April (4), May (5)
      expect(deriveSeason(new Date('2026-03-21T12:00:00Z'))).toBe('spring');
      expect(deriveSeason(new Date('2026-04-15T12:00:00Z'))).toBe('spring');
      expect(deriveSeason(new Date('2026-05-31T20:00:00Z'))).toBe('spring');

      // Summer: June (6), July (7), August (8)
      expect(deriveSeason(new Date('2026-06-01T12:00:00Z'))).toBe('summer');
      expect(deriveSeason(new Date('2026-07-20T12:00:00Z'))).toBe('summer');
      expect(deriveSeason(new Date('2026-08-31T12:00:00Z'))).toBe('summer');

      // Fall: September (9), October (10), November (11)
      expect(deriveSeason(new Date('2026-09-01T12:00:00Z'))).toBe('fall');
      expect(deriveSeason(new Date('2026-10-15T12:00:00Z'))).toBe('fall');
      expect(deriveSeason(new Date('2026-11-30T12:00:00Z'))).toBe('fall');

      // Winter: December (12), January (1), February (2)
      expect(deriveSeason(new Date('2026-12-01T12:00:00Z'))).toBe('winter');
      expect(deriveSeason(new Date('2026-01-15T12:00:00Z'))).toBe('winter');
      expect(deriveSeason(new Date('2026-02-28T12:00:00Z'))).toBe('winter');
    });

    it('respects the Africa/Cairo timezone boundary near month-turn at midnight', () => {
      // Cairo is UTC+2 or UTC+3.
      // 2026-05-31 22:30:00 UTC is 2026-06-01 01:30:00 in Cairo (Summer, not Spring)
      const lateMayUtc = new Date('2026-05-31T22:30:00Z');
      expect(deriveSeason(lateMayUtc)).toBe('summer');
    });

    it('throws when given an invalid date', () => {
      expect(() => deriveSeason('invalid-date-string')).toThrow('Invalid date provided to deriveSeason');
    });
  });
});
