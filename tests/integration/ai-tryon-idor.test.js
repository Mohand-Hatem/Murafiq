/**
 * Phase 15F Step 8 — IDOR & Security Isolation Integration Test Suite.
 *
 * Rigorous multi-tenant security verification asserting:
 * 1. User B cannot access, overwrite, or delete User A's Shape Model.
 * 2. User B cannot hijack User A's Shape Model for a Try-On request (403 Forbidden).
 * 3. User B cannot steal or reference User A's Wardrobe items in a Try-On request (404 Not Found).
 * 4. User B cannot forge imageRef upload paths outside their own user namespace (400 Bad Request).
 * 5. User B cannot read User A's Try-On generation details or results (403 Forbidden).
 * 6. User B cannot delete User A's Try-On generation (403 Forbidden).
 * 7. Paginated listing of Try-On generations never leaks records across users.
 * 8. Output responses conceal raw authenticated storage URIs and only expose 1-hour signed URLs.
 */

import '../../src/common/globals.js';
import { describe, it, expect, jest, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import env from '../../src/config/env.config.js';
import User from '../../src/modules/users/user.model.js';
import WardrobeItem from '../../src/modules/wardrobe/wardrobe-item.model.js';
import TryOnGeneration from '../../src/modules/ai/try-on/try-on-generation.model.js';
import ShapeModel from '../../src/modules/ai/shape-model/shape-model.model.js';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import uploadService from '../../src/modules/uploads/upload.service.js';
import entitlementService from '../../src/modules/subscriptions/entitlement.service.js';

describe('Integration — Phase 15F IDOR & Security Isolation Suite', () => {
  let userA;
  let tokenA;
  let userB;
  let tokenB;

  let userAShapeModel;
  let userBShapeModel;
  let userAWardrobeItem;
  let userBWardrobeItem;
  let userAGeneration;

  let originalKillSwitch;

  beforeAll(async () => {
    originalKillSwitch = env.AI_TRY_ON_ENABLED;
    env.AI_TRY_ON_ENABLED = true;

    await connectTestDB();
    await clearTestDB();

    userA = await User.create({
      name: 'User Alpha',
      email: 'user.a@example.com',
      passwordHash: '$2b$12$e6mZc0U7v59n8f4B0/11ae4e6L8M8Zk0s3.V0pQ5gC2W0K.Q2e5.q',
      role: 'client',
      isEmailVerified: true,
      accountStatus: 'active',
    });
    tokenA = generateAccessToken({ sub: userA._id.toString(), role: userA.role });

    userB = await User.create({
      name: 'User Beta (Attacker)',
      email: 'user.b@example.com',
      passwordHash: '$2b$12$e6mZc0U7v59n8f4B0/11ae4e6L8M8Zk0s3.V0pQ5gC2W0K.Q2e5.q',
      role: 'client',
      isEmailVerified: true,
      accountStatus: 'active',
    });
    tokenB = generateAccessToken({ sub: userB._id.toString(), role: userB.role });
  });

  afterAll(async () => {
    env.AI_TRY_ON_ENABLED = originalKillSwitch;
    await clearTestDB();
    await closeTestDB();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await ShapeModel.deleteMany({});
    await WardrobeItem.deleteMany({});
    await TryOnGeneration.deleteMany({});

    jest.spyOn(uploadService, 'getSignedUrl').mockImplementation((publicId) => {
      return `https://signed.cloudinary.mock/${publicId}?sig=valid_token&expires=3600`;
    });
    jest.spyOn(uploadService, 'deleteFile').mockResolvedValue({ result: 'ok' });
    jest.spyOn(entitlementService, 'consumeTryOnQuota').mockResolvedValue({
      success: true,
      quotaSource: 'monthly',
    });

    // Create User A resources
    userAShapeModel = await ShapeModel.create({
      userId: userA._id,
      publicId: `murafiq/shape-models/${userA._id}/shape_a_uuid`,
      imageUrl: `authenticated://murafiq/shape-models/${userA._id}/shape_a_uuid`,
      status: 'active',
      consentAt: new Date(),
    });

    userAWardrobeItem = await WardrobeItem.create({
      userId: userA._id,
      imageUrl: 'https://cloudinary.com/user_a_blazer.jpg',
      sourceUploadRef: `murafiq/wardrobe/${userA._id}/blazer_uuid`,
      category: 'top',
      formality: 'formal',
      season: 'all_season',
      primaryColor: 'navy',
    });

    userAGeneration = await TryOnGeneration.create({
      userId: userA._id,
      shapeModelId: userAShapeModel._id,
      garments: [
        {
          source: 'wardrobe',
          itemId: userAWardrobeItem._id,
          slot: 'top',
          label: 'User A Blazer',
          resolvedPublicId: userAWardrobeItem.sourceUploadRef,
        },
      ],
      status: 'completed',
      jobId: 'deterministic_job_id_user_a',
      resolution: '1024x1024',
      promptVersion: 'v1',
      quotaSource: 'monthly',
      resultPublicId: `murafiq/try-on-results/${userA._id}/result_a`,
      resultUrl: `authenticated://murafiq/try-on-results/${userA._id}/result_a`,
      completedAt: new Date(),
    });

    // Create User B resources
    userBShapeModel = await ShapeModel.create({
      userId: userB._id,
      publicId: `murafiq/shape-models/${userB._id}/shape_b_uuid`,
      imageUrl: `authenticated://murafiq/shape-models/${userB._id}/shape_b_uuid`,
      status: 'active',
      consentAt: new Date(),
    });

    userBWardrobeItem = await WardrobeItem.create({
      userId: userB._id,
      imageUrl: 'https://cloudinary.com/user_b_tee.jpg',
      sourceUploadRef: `murafiq/wardrobe/${userB._id}/tee_uuid`,
      category: 'top',
      formality: 'casual',
      season: 'summer',
      primaryColor: 'white',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Shape Model Multi-Tenant Security', () => {
    it('User B cannot register a Shape Model using an imageRef scoped to User A (Namespace Guard)', async () => {
      const forgedImageRef = `murafiq/shape-models/${userA._id}/malicious_upload_uuid`;

      const res = await request(app)
        .post('/api/v1/ai/shape-model')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          imageRef: forgedImageRef,
          consent: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('must belong to the authenticated user');

      // Assert User A shape model was NOT modified or replaced
      const unchanged = await ShapeModel.findById(userAShapeModel._id);
      expect(unchanged.status).toBe('active');
    });

    it('User B requesting GET /shape-model receives only their own shape model, never User A data', async () => {
      const res = await request(app)
        .get('/api/v1/ai/shape-model')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(userBShapeModel._id.toString());
      expect(res.body.data.id).not.toBe(userAShapeModel._id.toString());
    });
  });

  describe('Cross-User Resource Hijacking in Try-On', () => {
    it('rejects User B attempting to use User A Shape Model with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/ai/try-on')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          shapeModelId: userAShapeModel._id.toString(), // Belongs to User A
          garments: [{ source: 'wardrobe', itemId: userBWardrobeItem._id.toString() }],
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Forbidden: You do not own this shape model');
    });

    it('rejects User B attempting to include User A wardrobe item with 404 Not Found', async () => {
      const res = await request(app)
        .post('/api/v1/ai/try-on')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          shapeModelId: userBShapeModel._id.toString(),
          garments: [{ source: 'wardrobe', itemId: userAWardrobeItem._id.toString() }], // Belongs to User A
        });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('Wardrobe item not found or you do not have permission');
    });

    it('rejects User B attempting to include an upload imageRef scoped to User A with 400 Bad Request', async () => {
      const forgedImageRef = `murafiq/ai-chat/${userA._id}/stolen_photo_uuid`;

      const res = await request(app)
        .post('/api/v1/ai/try-on')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          shapeModelId: userBShapeModel._id.toString(),
          garments: [{ source: 'upload', imageRef: forgedImageRef, slot: 'top' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('must belong to the authenticated user');
    });
  });

  describe('Try-On Generation Direct Object Reference (IDOR)', () => {
    it('rejects User B attempting to read User A generation with 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/v1/ai/try-on/${userAGeneration._id}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Forbidden: You do not have access');
      // Assert result signedUrl was NOT leaked
      expect(res.body.data).toBeFalsy();
    });

    it('rejects User B attempting to delete User A generation with 403 Forbidden', async () => {
      const res = await request(app)
        .delete(`/api/v1/ai/try-on/${userAGeneration._id}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(403);

      // Assert User A record remains intact and completed
      const checkDoc = await TryOnGeneration.findById(userAGeneration._id);
      expect(checkDoc.status).toBe('completed');
    });

    it('User B listing generations sees 0 records when having none, 0 leakage from User A', async () => {
      const res = await request(app)
        .get('/api/v1/ai/try-on')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(0);
    });
  });

  describe('Storage URL Concealment & Privacy Invariants', () => {
    it('Shape Model DTO strictly omits raw authenticated storage URLs', async () => {
      const res = await request(app)
        .get('/api/v1/ai/shape-model')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.signedUrl).toMatch(/^https:\/\/signed\.cloudinary/);
      expect(data.imageUrl).toBeUndefined();
      expect(data.publicId).toBeUndefined();
      expect(data.userId).toBeUndefined();
    });

    it('Try-On DTO strictly omits raw internal result URLs and internal storage keys', async () => {
      const res = await request(app)
        .get(`/api/v1/ai/try-on/${userAGeneration._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.result.signedUrl).toMatch(/^https:\/\/signed\.cloudinary/);
      expect(data.resultUrl).toBeUndefined();
      expect(data.resultPublicId).toBeUndefined();
      expect(data.jobId).toBeUndefined();
    });
  });
});
