import '../../src/common/globals.js';
import { describe, it, expect, jest, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../src/app.js';
import User from '../../src/modules/users/user.model.js';
import Outfit from '../../src/modules/ai/outfits/outfit.model.js';
import AiConversation from '../../src/modules/ai/conversation/ai-conversation.model.js';
import AiMessage from '../../src/modules/ai/conversation/ai-message.model.js';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import stylistRequestService from '../../src/modules/ai/stylist/stylist-request.service.js';

describe('Integration — Phase 15 Mobile AI Routes', () => {
  let userA;
  let tokenA;
  let userB;
  let tokenB;

  beforeAll(async () => {
    await connectTestDB();
    await clearTestDB();

    userA = await User.create({
      name: 'Client User A',
      email: 'client.a@example.com',
      passwordHash: '$2b$12$e6mZc0U7v59n8f4B0/11ae4e6L8M8Zk0s3.V0pQ5gC2W0K.Q2e5.q',
      role: 'client',
      isEmailVerified: true,
      accountStatus: 'active',
    });
    tokenA = generateAccessToken({ sub: userA._id.toString(), role: userA.role });

    userB = await User.create({
      name: 'Client User B',
      email: 'client.b@example.com',
      passwordHash: '$2b$12$e6mZc0U7v59n8f4B0/11ae4e6L8M8Zk0s3.V0pQ5gC2W0K.Q2e5.q',
      role: 'client',
      isEmailVerified: true,
      accountStatus: 'active',
    });
    tokenB = generateAccessToken({ sub: userB._id.toString(), role: userB.role });
  });

  afterAll(async () => {
    await clearTestDB();
    await closeTestDB();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  // ── 1. Stylist Requests Status & Cancel ───────────────────────────
  describe('Stylist Request Status & Cancellation', () => {
    const requestId = 'mock-req-' + Date.now();

    beforeEach(async () => {
      await stylistRequestService.createRequest({
        requestId,
        userId: userA._id.toString(),
        message: 'Wedding outfit',
      });
    });

    it('returns request status for the owner', async () => {
      await stylistRequestService.updateRequest(requestId, {
        status: 'completed',
        responseType: 'success',
        searchStatus: 'skipped',
        assistantMessage: 'Look ready',
        result: { outfits: [] },
      });

      const res = await request(app)
        .get(`/api/v1/ai/stylist/requests/${requestId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.requestId).toBe(requestId);
      expect(res.body.data.status).toBe('completed');
      expect(res.body.data.responseType).toBe('success');
      expect(res.body.data.searchStatus).toBe('skipped');
      expect(res.body.data.assistantMessage).toBe('Look ready');
      expect(res.body.data.result).toEqual({ outfits: [] });
    });

    it('enforces ownership protection on request status (returns 404 for other user)', async () => {
      const res = await request(app)
        .get(`/api/v1/ai/stylist/requests/${requestId}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
    });

    it('cancels an active request and updates status', async () => {
      const cancelReqId = 'cancel-test-' + Date.now();
      await stylistRequestService.createRequest({
        requestId: cancelReqId,
        userId: userA._id.toString(),
        message: 'Casual look',
      });

      const res = await request(app)
        .post(`/api/v1/ai/stylist/requests/${cancelReqId}/cancel`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cancelled');
      expect(res.body.data.responseType).toBe('error');

      // Idempotent: second cancel returns existing cancelled state without error
      const res2 = await request(app)
        .post(`/api/v1/ai/stylist/requests/${cancelReqId}/cancel`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe('cancelled');
    });

    it('forbids cancellation of another user request (returns 404)', async () => {
      const res = await request(app)
        .post(`/api/v1/ai/stylist/requests/${requestId}/cancel`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
    });
  });

  // ── 2. Stylist Feedback ───────────────────────────────────────────
  describe('Stylist Feedback (POST /api/v1/ai/stylist/feedback)', () => {
    let outfitA;

    beforeEach(async () => {
      outfitA = await Outfit.create({
        userId: userA._id,
        items: [new mongoose.Types.ObjectId()],
        rationale: 'Stylish outfit',
      });
    });

    it('submits valid liked feedback', async () => {
      const res = await request(app)
        .post('/api/v1/ai/stylist/feedback')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          outfitId: outfitA._id.toString(),
          feedback: 'liked',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.userFeedback).toBe('liked');
    });

    it('submits valid disliked feedback', async () => {
      const res = await request(app)
        .post('/api/v1/ai/stylist/feedback')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          outfitId: outfitA._id.toString(),
          feedback: 'disliked',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.userFeedback).toBe('disliked');
    });

    it('rejects invalid feedback value with 400', async () => {
      const res = await request(app)
        .post('/api/v1/ai/stylist/feedback')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          outfitId: outfitA._id.toString(),
          feedback: 'neutral',
        });

      expect(res.status).toBe(400);
    });

    it('returns 404 for non-owned outfit feedback', async () => {
      const res = await request(app)
        .post('/api/v1/ai/stylist/feedback')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          outfitId: outfitA._id.toString(),
          feedback: 'liked',
        });

      expect(res.status).toBe(404);
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post('/api/v1/ai/stylist/feedback')
        .send({
          outfitId: outfitA._id.toString(),
          feedback: 'liked',
        });

      expect(res.status).toBe(401);
    });
  });

  // ── 3. Wardrobe Save from Chat Alias ──────────────────────────────
  describe('Wardrobe Save From Chat Alias (POST /api/v1/ai/wardrobe/from-chat)', () => {
    it('successfully proxies to wardrobeService.saveWardrobeItemFromChat', async () => {
      const mockImageRef = `murafiq/ai-chat/${userA._id}/shirt-uuid`;

      const conv = await AiConversation.create({
        userId: userA._id,
        title: 'Chat to Save From',
      });

      const msg = await AiMessage.create({
        conversationId: conv._id,
        role: 'user',
        content: 'Shirt image',
        imageRef: mockImageRef,
        imageUrl: 'https://cloudinary.com/ai-chat/shirt.jpg',
        imageAnalysis: {
          category: 'top',
          subcategory: 'oxford_shirt',
          primaryColor: 'navy',
        },
      });

      const res = await request(app)
        .post('/api/v1/ai/wardrobe/from-chat')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ messageId: msg._id.toString() });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.category).toBe('top');
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post('/api/v1/ai/wardrobe/from-chat')
        .send({ messageId: new mongoose.Types.ObjectId().toString() });

      expect(res.status).toBe(401);
    });
  });

  // ── 4. Conversations ──────────────────────────────────────────────
  describe('AI Conversations API', () => {
    let convA;

    beforeEach(async () => {
      convA = await AiConversation.create({
        userId: userA._id,
        title: 'Spring Look',
      });
    });

    it('POST /conversations creates a new conversation', async () => {
      const res = await request(app)
        .post('/api/v1/ai/conversations')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ title: 'New Event' });

      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe('New Event');
      expect(res.body.data.id).toBeDefined();
    });

    it('GET /conversations lists user conversations newest first', async () => {
      const res = await request(app)
        .get('/api/v1/ai/conversations')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.conversations.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.pagination).toBeDefined();
    });

    it('GET /conversations/:id retrieves a conversation for the owner', async () => {
      const res = await request(app)
        .get(`/api/v1/ai/conversations/${convA._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(convA._id.toString());
    });

    it('GET /conversations/:id returns 404 for non-owner', async () => {
      const res = await request(app)
        .get(`/api/v1/ai/conversations/${convA._id}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
    });

    it('GET /conversations/:id/messages returns conversation messages', async () => {
      await AiMessage.create({
        conversationId: convA._id,
        role: 'user',
        content: 'I need a suit',
      });
      await AiMessage.create({
        conversationId: convA._id,
        role: 'assistant',
        content: 'Here is a navy suit',
        structuredResult: { outfits: [] },
      });

      const res = await request(app)
        .get(`/api/v1/ai/conversations/${convA._id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.messages.length).toBe(2);
      expect(res.body.data.messages[0].role).toBe('user');
      expect(res.body.data.messages[1].role).toBe('assistant');
      expect(res.body.data.messages[0].traceId).toBeUndefined(); // stripped from mobile DTO
    });

    it('DELETE /conversations/:id deletes conversation and returns 200', async () => {
      const res = await request(app)
        .delete(`/api/v1/ai/conversations/${convA._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);

      // Verify deletion
      const findRes = await request(app)
        .get(`/api/v1/ai/conversations/${convA._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(findRes.status).toBe(404);
    });

    it('DELETE /conversations/:id returns 404 for non-owner', async () => {
      const res = await request(app)
        .delete(`/api/v1/ai/conversations/${convA._id}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
    });
  });

  // ── 5. Outfits ────────────────────────────────────────────────────
  describe('Outfits History API', () => {
    let outfitA;

    beforeEach(async () => {
      outfitA = await Outfit.create({
        userId: userA._id,
        items: [new mongoose.Types.ObjectId()],
        rationale: 'Formal tuxedo look',
        score: 95,
      });
    });

    it('GET /outfits lists authenticated user outfits', async () => {
      const res = await request(app)
        .get('/api/v1/ai/outfits')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.outfits.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.pagination).toBeDefined();
    });

    it('GET /outfits/:id returns outfit for owner', async () => {
      const res = await request(app)
        .get(`/api/v1/ai/outfits/${outfitA._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(outfitA._id.toString());
      expect(res.body.data.score).toBe(95);
    });

    it('GET /outfits/:id returns 404 for non-owner', async () => {
      const res = await request(app)
        .get(`/api/v1/ai/outfits/${outfitA._id}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
    });

    it('DELETE /outfits/:id deletes outfit for owner', async () => {
      const res = await request(app)
        .delete(`/api/v1/ai/outfits/${outfitA._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);

      const findRes = await request(app)
        .get(`/api/v1/ai/outfits/${outfitA._id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(findRes.status).toBe(404);
    });

    it('DELETE /outfits/:id returns 404 for non-owner', async () => {
      const res = await request(app)
        .delete(`/api/v1/ai/outfits/${outfitA._id}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
    });
  });

  // ── 6. Inactive Preferences Verification ──────────────────────────
  describe('Preferences Route Inactivity Verification', () => {
    it('confirms GET /api/v1/ai/preferences is NOT active (returns 404)', async () => {
      const res = await request(app)
        .get('/api/v1/ai/preferences')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
    });

    it('confirms PATCH /api/v1/ai/preferences is NOT active (returns 404)', async () => {
      const res = await request(app)
        .patch('/api/v1/ai/preferences')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ favoriteColors: ['navy'] });

      expect(res.status).toBe(404);
    });
  });
});
