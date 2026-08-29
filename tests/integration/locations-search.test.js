import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';

describe('Stage R10 Integration — Location Directory & Search Routes', () => {
  describe('GET /api/v1/locations/governorates', () => {
    it('returns all 27 Egyptian governorates with nested cities', async () => {
      const res = await request(app).get('/api/v1/locations/governorates');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(27);

      const cairo = res.body.data.find((g) => g.nameEn === 'Cairo');
      expect(cairo).toBeDefined();
      expect(cairo.nameAr).toBe('القاهرة');
      expect(cairo.cities.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/v1/locations/governorates/:governorate/cities', () => {
    it('returns cities for valid governorate in English or Arabic', async () => {
      const resEn = await request(app).get('/api/v1/locations/governorates/cairo/cities');
      expect(resEn.status).toBe(200);
      expect(resEn.body.data.governorate.nameEn).toBe('Cairo');
      expect(resEn.body.data.cities.length).toBeGreaterThan(0);

      const resAr = await request(app).get('/api/v1/locations/governorates/الجيزة/cities');
      expect(resAr.status).toBe(200);
      expect(resAr.body.data.governorate.nameEn).toBe('Giza');
    });

    it('returns 404 for unknown governorate', async () => {
      const res = await request(app).get('/api/v1/locations/governorates/tokyo/cities');
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/not found/i);
    });
  });
});
