import request from 'supertest';
import app from '../../src/app.js';
import { connectTestDB, closeTestDB } from '../setup/db-handler.js';

describe('Health & Error Handling Integration Tests', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  it('GET /api/v1/health should return 200 with JSON status', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Server is healthy',
      data: {
        status: 'healthy',
        mongo: 'connected',
        firebase: expect.any(String),
        redis: 'not_configured',
      },
      meta: null,
    });
  });

  it('should return 404 when calling a nonexistent route', async () => {
    const res = await request(app).get('/api/v1/unknown-route-12345');
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Route not found: /api/v1/unknown-route-12345');
    expect(res.body.data).toBeNull();
  });
});
