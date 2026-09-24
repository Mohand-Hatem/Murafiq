import '../../src/common/globals.js';
import request from 'supertest';
import app from '../../src/app.js';
import { connectTestDB, closeTestDB } from '../setup/db-handler.js';

describe('Demo OpenAPI Documentation & Contract Integration Tests (Phase 4)', () => {
  beforeAll(async () => {
    await connectTestDB();
  }, 300000);

  afterAll(async () => {
    await closeTestDB();
  });

  describe('GET /api/docs/demo.json and /api/demo/docs.json', () => {
    it('serves valid Demo OpenAPI 3.0 specification from /api/docs/demo.json', async () => {
      const res = await request(app).get('/api/docs/demo.json');

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/i);

      const spec = res.body;
      expect(spec.openapi).toBe('3.0.0');
      expect(spec.info.title).toBe('Murafiq Demo API');
      expect(spec.info.description).toContain('Demo trial release');
      expect(spec.servers[0].url).toContain('/api/demo');

      const paths = Object.keys(spec.paths);
      expect(paths.length).toBeGreaterThan(0);

      // 1. Assert complete absence of /payments, /payouts, /coupons, /admin
      const forbiddenModules = ['/payments', '/payouts', '/coupons', '/admin'];
      for (const path of paths) {
        for (const mod of forbiddenModules) {
          expect(path.startsWith(mod)).toBe(false);
          expect(path.startsWith(`/api/v1${mod}`)).toBe(false);
        }
      }

      // 2. Assert subscriptions module exposes only read-only plans and entitlements
      const subPaths = paths.filter((p) => p.includes('subscriptions'));
      expect(subPaths.sort()).toEqual([
        '/subscriptions/me',
        '/subscriptions/me/entitlements',
        '/subscriptions/plans',
      ]);

      // 3. Count total documented operations
      let demoOpCount = 0;
      for (const ops of Object.values(spec.paths)) {
        for (const method of Object.keys(ops)) {
          if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
            demoOpCount++;
          }
        }
      }
      expect(demoOpCount).toBe(89);

      // 4. Assert bookingMode is documented in PublicBooking schema
      const publicBookingSchema = spec.components?.schemas?.PublicBooking;
      expect(publicBookingSchema).toBeDefined();
      expect(publicBookingSchema.properties.bookingMode).toBeDefined();
      expect(publicBookingSchema.properties.bookingMode.enum).toEqual(['standard', 'demo']);
    });

    it('serves identical Demo OpenAPI specification from /api/demo/docs.json', async () => {
      const demoSubRes = await request(app).get('/api/demo/docs.json');
      const docsDemoRes = await request(app).get('/api/docs/demo.json');

      expect(demoSubRes.statusCode).toBe(200);
      expect(demoSubRes.body).toEqual(docsDemoRes.body);
    });

    it('serves Swagger UI for Demo at /api/docs/demo and /api/demo/docs', async () => {
      const res1 = await request(app).get('/api/docs/demo/');
      expect([200, 301, 302]).toContain(res1.statusCode);

      const res2 = await request(app).get('/api/demo/docs/');
      expect([200, 301, 302]).toContain(res2.statusCode);
    });
  });

  describe('GET /api/docs.json (V1 Documentation Regression Check)', () => {
    it('continues serving full V1 OpenAPI specification with zero regressions', async () => {
      const res = await request(app).get('/api/docs.json');

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/i);

      const spec = res.body;
      expect(spec.openapi).toBe('3.0.0');
      expect(spec.info.title).toBe('Murafiq API');
      expect(spec.servers[0].url).toContain('/api/v1');

      // V1 must contain payments, payouts, coupons, admin, and full subscription commerce
      const paths = Object.keys(spec.paths);
      expect(paths.some((p) => p.includes('payments'))).toBe(true);
      expect(paths.some((p) => p.includes('payouts'))).toBe(true);
      expect(paths.some((p) => p.includes('coupons'))).toBe(true);
      expect(paths.some((p) => p.includes('admin'))).toBe(true);
      expect(paths.some((p) => p.includes('subscriptions/checkout'))).toBe(true);
      expect(paths.some((p) => p.includes('subscriptions/subscribe'))).toBe(true);

      let v1OpCount = 0;
      for (const ops of Object.values(spec.paths)) {
        for (const method of Object.keys(ops)) {
          if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
            v1OpCount++;
          }
        }
      }
      expect(v1OpCount).toBe(146);
    });
  });
});
