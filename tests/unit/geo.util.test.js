import { describe, it, expect } from '@jest/globals';
import {
  haversineDistanceKm,
  normalizeGovernorate,
  normalizeCity,
  getGovernorateCentroid,
} from '../../src/common/utils/geo.util.js';
import { EGYPT_GOVERNORATES } from '../../src/common/constants/locations.constant.js';

describe('Egyptian Geo Utilities (Unit)', () => {
  describe('EGYPT_GOVERNORATES constant', () => {
    it('contains all 27 official Egyptian governorates', () => {
      expect(EGYPT_GOVERNORATES).toHaveLength(27);
      const cairo = EGYPT_GOVERNORATES.find((g) => g.code === 'EG-C');
      expect(cairo).toBeDefined();
      expect(cairo.nameEn).toBe('Cairo');
      expect(cairo.nameAr).toBe('القاهرة');
      expect(cairo.cities.length).toBeGreaterThan(5);
    });
  });

  describe('haversineDistanceKm', () => {
    it('accurately calculates distance between Cairo and Alexandria (~180-220km)', () => {
      const cairo = [31.2357, 30.0444];
      const alex = [29.9553, 31.2001];

      const distance = haversineDistanceKm(cairo, alex);
      expect(distance).toBeGreaterThan(170);
      expect(distance).toBeLessThan(230);
    });

    it('returns 0 for identical points', () => {
      const p = [31.2357, 30.0444];
      expect(haversineDistanceKm(p, p)).toBe(0);
    });

    it('returns null for missing or [0, 0] uninitialized coordinates', () => {
      expect(haversineDistanceKm([0, 0], [31.2, 30.0])).toBeNull();
      expect(haversineDistanceKm(null, [31.2, 30.0])).toBeNull();
    });
  });

  describe('normalizeGovernorate', () => {
    it('normalizes standard English and Arabic names', () => {
      expect(normalizeGovernorate('Cairo')?.nameEn).toBe('Cairo');
      expect(normalizeGovernorate('القاهرة')?.nameEn).toBe('Cairo');
      expect(normalizeGovernorate('Giza')?.nameEn).toBe('Giza');
      expect(normalizeGovernorate('الجيزة')?.nameEn).toBe('Giza');
      expect(normalizeGovernorate('Alexandria')?.nameEn).toBe('Alexandria');
      expect(normalizeGovernorate('الإسكندرية')?.nameEn).toBe('Alexandria');
    });

    it('handles transliterations, diacritics, and aliases', () => {
      expect(normalizeGovernorate('Al Qahirah')?.nameEn).toBe('Cairo');
      expect(normalizeGovernorate('El Giza')?.nameEn).toBe('Giza');
      expect(normalizeGovernorate('Tagamoa')?.nameEn).toBe('Cairo');
      expect(normalizeGovernorate('October')?.nameEn).toBe('Giza');
      expect(normalizeGovernorate('EG-ALX')?.nameEn).toBe('Alexandria');
    });

    it('returns null for unknown locations', () => {
      expect(normalizeGovernorate('Paris')).toBeNull();
      expect(normalizeGovernorate('')).toBeNull();
      expect(normalizeGovernorate(null)).toBeNull();
    });
  });

  describe('normalizeCity', () => {
    it('matches known cities inside a governorate', () => {
      const city = normalizeCity('Cairo', 'Nasr City');
      expect(city?.nameEn).toBe('Nasr City');

      const zayed = normalizeCity('Giza', 'الشيخ زايد');
      expect(zayed?.nameEn).toBe('Sheikh Zayed');
    });
  });

  describe('getGovernorateCentroid', () => {
    it('returns coordinates centroid for Cairo and Giza', () => {
      const cairoCentroid = getGovernorateCentroid('Cairo');
      expect(cairoCentroid).toEqual([31.2357, 30.0444]);

      const gizaCentroid = getGovernorateCentroid('Giza');
      expect(gizaCentroid).toEqual([31.2089, 30.0131]);
    });
  });
});
