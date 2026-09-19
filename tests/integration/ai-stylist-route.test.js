import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import User from '../../src/modules/users/user.model.js';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import orchestrator from '../../src/modules/ai/stylist/stylist.orchestrator.js';

describe('Integration — AI Stylist Route (POST /api/v1/ai/stylist)', () => {
  let clientUser;
  let clientToken;
  let stylistUser;
  let stylistToken;

  beforeAll(async () => {
    await connectTestDB();
    await clearTestDB();

    clientUser = await User.create({
      name: 'Stylist Client',
      email: 'ai.stylist.client@example.com',
      passwordHash: '$2b$12$e6mZc0U7v59n8f4B0/11ae4e6L8M8Zk0s3.V0pQ5gC2W0K.Q2e5.q',
      role: 'client',
      isEmailVerified: true,
      accountStatus: 'active',
    });
    clientToken = generateAccessToken({ sub: clientUser._id.toString(), role: clientUser.role });

    stylistUser = await User.create({
      name: 'Pro Stylist',
      email: 'pro.stylist@example.com',
      passwordHash: '$2b$12$e6mZc0U7v59n8f4B0/11ae4e6L8M8Zk0s3.V0pQ5gC2W0K.Q2e5.q',
      role: 'stylist',
      isEmailVerified: true,
      accountStatus: 'active',
    });
    stylistToken = generateAccessToken({ sub: stylistUser._id.toString(), role: stylistUser.role });
  });

  afterAll(async () => {
    await clearTestDB();
    await closeTestDB();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects unauthenticated requests with 401 Unauthorized', async () => {
    const res = await request(app)
      .post('/api/v1/ai/stylist')
      .send({ message: 'What should I wear to a wedding?' });

    expect(res.status).toBe(401);
  });

  it('rejects non-client roles (stylist) with 403 Forbidden', async () => {
    const res = await request(app)
      .post('/api/v1/ai/stylist')
      .set('Authorization', `Bearer ${stylistToken}`)
      .send({ message: 'What should I wear to a wedding?' });

    expect(res.status).toBe(403);
  });

  it('rejects empty or whitespace-only messages with 400 Bad Request', async () => {
    const res = await request(app)
      .post('/api/v1/ai/stylist')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ message: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects messages exceeding 500 characters with 400 Bad Request', async () => {
    const longMessage = 'a'.repeat(501);
    const res = await request(app)
      .post('/api/v1/ai/stylist')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ message: longMessage });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects unexpected request fields with 400 due to Zod .strict()', async () => {
    const res = await request(app)
      .post('/api/v1/ai/stylist')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        message: 'Wedding tomorrow evening',
        unexpectedField: 'injection_payload',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('successfully processes valid request and returns 200 with structured data', async () => {
    const mockPipelineResult = {
      outfits: [
        {
          outfitId: 'mock_outfit_1',
          score: 94,
          rationale: 'Sophisticated navy suit with white shirt.',
          fromYourWardrobe: [],
        },
      ],
      sufficiency: 'good',
      missingSlots: [],
      suggestedToAcquire: [],
      suggestBookStylist: false,
      stylistBookingCta: null,
      language: 'en',
      traceId: 'mock-trace-123',
    };

    const orchestratorSpy = jest
      .spyOn(orchestrator, 'runStylistPipeline')
      .mockResolvedValueOnce(mockPipelineResult);

    const res = await request(app)
      .post('/api/v1/ai/stylist')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        message: 'I have a formal wedding tomorrow evening, what should I wear?',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(mockPipelineResult);
    expect(orchestratorSpy).toHaveBeenCalledWith({
      userId: clientUser._id.toString(),
      message: 'I have a formal wedding tomorrow evening, what should I wear?',
      conversationId: undefined,
    });
  });
});
