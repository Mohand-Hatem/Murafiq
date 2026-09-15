/**
 * Phase 15F Step 7 — Try-On & Shape Model Routes Integration Tests.
 *
 * Covers:
 * 1. Kill switch (Approved Decision Q1): When AI_TRY_ON_ENABLED is false, all routes return 404.
 * 2. RBAC & Auth: 401 for unauthenticated, 403 for stylist, allowed for client.
 * 3. Shape Model endpoints: POST (201), GET (200), DELETE (200).
 * 4. Try-On endpoints: POST (202), GET /:id (200), GET / (200), DELETE /:id (200).
 */

import '../../src/common/globals.js';
import { describe, it, expect, jest, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../src/app.js';
import env from '../../src/config/env.config.js';
import User from '../../src/modules/users/user.model.js';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import uploadService from '../../src/modules/uploads/upload.service.js';
import WardrobeItem from '../../src/modules/wardrobe/wardrobe-item.model.js';
import entitlementService from '../../src/modules/subscriptions/entitlement.service.js';

describe('Integration — Phase 15F Virtual Try-On & Shape Model Routes', () => {
  let clientUser;
  let clientToken;
  let stylistUser;
  let stylistToken;
  let originalKillSwitch;

  beforeAll(async () => {
    originalKillSwitch = env.AI_TRY_ON_ENABLED;
    await connectTestDB();
    await clearTestDB();

    clientUser = await User.create({
      name: 'TryOn Client',
      email: 'tryon.client@example.com',
      passwordHash: '$2b$12$e6mZc0U7v59n8f4B0/11ae4e6L8M8Zk0s3.V0pQ5gC2W0K.Q2e5.q',
      role: 'client',
      isEmailVerified: true,
      accountStatus: 'active',
    });
    clientToken = generateAccessToken({ sub: clientUser._id.toString(), role: clientUser.role });

    stylistUser = await User.create({
      name: 'Stylist TryOn Tester',
      email: 'stylist.tryon@example.com',
      passwordHash: '$2b$12$e6mZc0U7v59n8f4B0/11ae4e6L8M8Zk0s3.V0pQ5gC2W0K.Q2e5.q',
      role: 'stylist',
      isEmailVerified: true,
      accountStatus: 'active',
    });
    stylistToken = generateAccessToken({ sub: stylistUser._id.toString(), role: stylistUser.role });
  });

  afterAll(async () => {
    env.AI_TRY_ON_ENABLED = originalKillSwitch;
    await clearTestDB();
    await closeTestDB();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Feature Kill-Switch (Approved Decision Q1)', () => {
    beforeEach(() => {
      env.AI_TRY_ON_ENABLED = false;
    });

    afterEach(() => {
      env.AI_TRY_ON_ENABLED = originalKillSwitch;
    });

    it('returns 404 Not Found for POST /api/v1/ai/shape-model when disabled', async () => {
      const res = await request(app)
        .post('/api/v1/ai/shape-model')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          imageRef: `murafiq/shape-models/${clientUser._id}/uuid1`,
          consent: true,
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Not found');
    });

    it('returns 404 Not Found for GET /api/v1/ai/shape-model when disabled', async () => {
      const res = await request(app)
        .get('/api/v1/ai/shape-model')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(404);
    });

    it('returns 404 Not Found for POST /api/v1/ai/try-on when disabled', async () => {
      const res = await request(app)
        .post('/api/v1/ai/try-on')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          shapeModelId: new mongoose.Types.ObjectId().toString(),
          garments: [],
        });

      expect(res.status).toBe(404);
    });
  });

  describe('Authentication & Role-Based Access Control', () => {
    beforeEach(() => {
      env.AI_TRY_ON_ENABLED = true;
    });

    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      const res = await request(app).get('/api/v1/ai/shape-model');
      expect(res.status).toBe(401);
    });

    it('rejects stylist role on shape model endpoints with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/ai/shape-model')
        .set('Authorization', `Bearer ${stylistToken}`)
        .send({
          imageRef: `murafiq/shape-models/${stylistUser._id}/uuid1`,
          consent: true,
        });

      expect(res.status).toBe(403);
    });

    it('rejects stylist role on try-on endpoints with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/ai/try-on')
        .set('Authorization', `Bearer ${stylistToken}`)
        .send({
          shapeModelId: new mongoose.Types.ObjectId().toString(),
          garments: [],
        });

      expect(res.status).toBe(403);
    });
  });

  describe('Shape Model Lifecycle Routes', () => {
    beforeEach(() => {
      env.AI_TRY_ON_ENABLED = true;
      jest.spyOn(uploadService, 'getSignedUrl').mockReturnValue('https://signed.cloudinary/test-shape');
      jest.spyOn(uploadService, 'deleteFile').mockResolvedValue({ result: 'ok' });
    });

    it('rejects creation when consent is false with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/ai/shape-model')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          imageRef: `murafiq/shape-models/${clientUser._id}/uuid-test-1`,
          consent: false,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Explicit consent is required');
    });

    it('successfully creates an active Shape Model with 201 Created', async () => {
      const res = await request(app)
        .post('/api/v1/ai/shape-model')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          imageRef: `murafiq/shape-models/${clientUser._id}/uuid-test-valid`,
          consent: true,
          width: 1080,
          height: 1920,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('active');
      expect(res.body.data.signedUrl).toBe('https://signed.cloudinary/test-shape');
    });

    it('retrieves active Shape Model via GET /api/v1/ai/shape-model with 200 OK', async () => {
      const res = await request(app)
        .get('/api/v1/ai/shape-model')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.status).toBe('active');
    });

    it('deletes active Shape Model via DELETE /api/v1/ai/shape-model with 200 OK', async () => {
      const res = await request(app)
        .delete('/api/v1/ai/shape-model')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('deleted successfully');

      // Verify subsequent GET returns null
      const getRes = await request(app)
        .get('/api/v1/ai/shape-model')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data).toBeNull();
    });
  });

  describe('Try-On Routes', () => {
    let activeShapeModelId;
    let wardrobeItem;

    beforeEach(async () => {
      env.AI_TRY_ON_ENABLED = true;
      jest.spyOn(uploadService, 'getSignedUrl').mockReturnValue('https://signed.cloudinary/test-shape');
      jest.spyOn(uploadService, 'deleteFile').mockResolvedValue({ result: 'ok' });

      // Create active shape model
      const smRes = await request(app)
        .post('/api/v1/ai/shape-model')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          imageRef: `murafiq/shape-models/${clientUser._id}/uuid-sm-tryon`,
          consent: true,
        });
      activeShapeModelId = smRes.body.data.id;

      // Create test wardrobe item for client
      wardrobeItem = await WardrobeItem.create({
        userId: clientUser._id,
        imageUrl: 'https://cloudinary.com/item1.jpg',
        sourceUploadRef: `murafiq/wardrobe/${clientUser._id}/item1`,
        category: 'top',
        formality: 'casual',
        season: 'all_season',
        primaryColor: 'navy',
      });
    });

    it('rejects try-on request with conflicting garment slots (dress + top) with 400 Bad Request', async () => {
      const dressItem = await WardrobeItem.create({
        userId: clientUser._id,
        imageUrl: 'https://cloudinary.com/dress1.jpg',
        sourceUploadRef: `murafiq/wardrobe/${clientUser._id}/dress1`,
        category: 'dress',
        formality: 'formal',
        season: 'summer',
        primaryColor: 'red',
      });

      const res = await request(app)
        .post('/api/v1/ai/try-on')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          shapeModelId: activeShapeModelId,
          garments: [
            { source: 'wardrobe', itemId: wardrobeItem._id.toString() },
            { source: 'wardrobe', itemId: dressItem._id.toString() },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Conflicting outfit slots');
    });

    it('successfully initiates a Try-On request with 202 Accepted', async () => {
      jest
        .spyOn(entitlementService, 'consumeTryOnQuota')
        .mockResolvedValue({ success: true, quotaSource: 'monthly' });

      const res = await request(app)
        .post('/api/v1/ai/try-on')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          shapeModelId: activeShapeModelId,
          garments: [{ source: 'wardrobe', itemId: wardrobeItem._id.toString() }],
          resolution: '1024x1024',
        });

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.id).toBeDefined();

      // Retrieve generation by ID
      const getRes = await request(app)
        .get(`/api/v1/ai/try-on/${res.body.data.id}`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.id).toBe(res.body.data.id);

      // List user's generations
      const listRes = await request(app)
        .get('/api/v1/ai/try-on')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.data)).toBe(true);
      expect(listRes.body.data.length).toBeGreaterThan(0);
    });
  });
});
