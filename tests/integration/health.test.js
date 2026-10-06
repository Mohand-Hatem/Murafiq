import request from 'supertest';
import mongoose from 'mongoose';
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
        status: expect.stringMatching(/^(healthy|degraded)$/),
        mongo: 'connected',
        firebase: expect.any(String),
        redis: expect.stringMatching(/^(connected|unavailable)$/),
      },
      meta: null,
    });
  });

  it('GET /health (root probe) should return 200 with matching schema', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Server is healthy');
    expect(res.body.data.mongo).toBe('connected');
    expect(res.body.data.status).toMatch(/^(healthy|degraded)$/);
  });

  it('GET /health returns 503 when MongoDB is disconnected', async () => {
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', { value: 0, writable: true, configurable: true });
    try {
      const res = await request(app).get('/health');
      expect(res.statusCode).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.status).toBe('unhealthy');
      expect(res.body.mongo).toBe('disconnected');
    } finally {
      Object.defineProperty(mongoose.connection, 'readyState', { value: originalReadyState, writable: true, configurable: true });
    }
  });

  it('should return 404 when calling a nonexistent route', async () => {
    const res = await request(app).get('/api/v1/unknown-route-12345');
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Route not found: /api/v1/unknown-route-12345');
    expect(res.body.data).toBeNull();
  });
});
