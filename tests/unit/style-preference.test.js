import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import StylePreference, { MODESTY_PREFERENCES } from '../../src/modules/ai/preferences/style-preference.model.js';
import * as stylePreferenceService from '../../src/modules/ai/preferences/style-preference.service.js';

describe('StylePreference Model & Service (Unit)', () => {
  const userId = new mongoose.Types.ObjectId();
  const otherUserId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    await connectTestDB();
    await StylePreference.init();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    await StylePreference.init();
  });

  describe('Schema Constraints & Indexes', () => {
    it('requires userId', async () => {
      const pref = new StylePreference({});
      let err;
      try {
        await pref.validate();
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      expect(err.errors.userId).toBeDefined();
    });

    it('enforces unique index on userId', async () => {
      await StylePreference.create({ userId });
      let err;
      try {
        await StylePreference.create({ userId });
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      expect(err.code).toBe(11000);
    });

    it('rejects invalid colorFamily in favoriteColors and avoidedColors', async () => {
      const pref = new StylePreference({
        userId,
        favoriteColors: ['invalid_neon_color'],
      });
      let err;
      try {
        await pref.validate();
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      expect(err.errors['favoriteColors.0']).toBeDefined();
    });

    it('rejects invalid modestyPreference enum value', async () => {
      const pref = new StylePreference({
        userId,
        modestyPreference: 'ultra_revealing',
      });
      let err;
      try {
        await pref.validate();
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      expect(err.errors.modestyPreference).toBeDefined();
    });

    it('supports all canonical modesty preferences', () => {
      expect(MODESTY_PREFERENCES).toEqual(['modest', 'standard', 'relaxed']);
    });

    it('enforces notes maximum length of 1000 characters', async () => {
      const pref = new StylePreference({
        userId,
        notes: 'a'.repeat(1001),
      });
      let err;
      try {
        await pref.validate();
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      expect(err.errors.notes).toBeDefined();
    });
  });

  describe('Lazy Creation & Retrieval Service', () => {
    it('getPreferences creates default profile on first read when absent', async () => {
      const countBefore = await StylePreference.countDocuments({ userId });
      expect(countBefore).toBe(0);

      const pref = await stylePreferenceService.getPreferences(userId);
      expect(pref).toBeDefined();
      expect(pref.userId.toString()).toBe(userId.toString());
      expect(pref.modestyPreference).toBe('standard');
      expect(pref.favoriteColors).toEqual([]);
      expect(pref.avoidedColors).toEqual([]);
      expect(pref.sizes.toObject()).toEqual({ top: '', bottom: '', shoes: '', outerwear: '' });

      const countAfter = await StylePreference.countDocuments({ userId });
      expect(countAfter).toBe(1);
    });

    it('getPreferences returns existing document without duplicate creation', async () => {
      await StylePreference.create({
        userId,
        favoriteColors: ['navy', 'white'],
        modestyPreference: 'modest',
      });

      const pref = await stylePreferenceService.getPreferences(userId);
      expect(pref.favoriteColors).toEqual(['navy', 'white']);
      expect(pref.modestyPreference).toBe('modest');

      const count = await StylePreference.countDocuments({ userId });
      expect(count).toBe(1);
    });
  });

  describe('Update Preferences Service', () => {
    it('updatePreferences updates fields and persists them accurately', async () => {
      await stylePreferenceService.getPreferences(userId);

      const updated = await stylePreferenceService.updatePreferences(userId, {
        favoriteColors: ['black', 'beige'],
        avoidedColors: ['orange'],
        preferredFormality: 'smart_casual',
        sizes: { top: 'M', bottom: '32', shoes: '42', outerwear: 'L' },
        modestyPreference: 'modest',
        notes: 'Prefers breathable natural fabrics',
      });

      expect(updated.favoriteColors).toEqual(['black', 'beige']);
      expect(updated.avoidedColors).toEqual(['orange']);
      expect(updated.preferredFormality).toBe('smart_casual');
      expect(updated.sizes.top).toBe('M');
      expect(updated.sizes.bottom).toBe('32');
      expect(updated.modestyPreference).toBe('modest');
      expect(updated.notes).toBe('Prefers breathable natural fabrics');

      // Verify isolated per user
      const otherPref = await stylePreferenceService.getPreferences(otherUserId);
      expect(otherPref.favoriteColors).toEqual([]);
      expect(otherPref.modestyPreference).toBe('standard');
    });
  });
});
