import '../../src/common/globals.js';
import request from 'supertest';
import app from '../../src/app.js';
import User from '../../src/modules/users/user.model.js';
import WardrobeItem from '../../src/modules/wardrobe/wardrobe-item.model.js';
import AiConversation from '../../src/modules/ai/conversation/ai-conversation.model.js';
import AiMessage from '../../src/modules/ai/conversation/ai-message.model.js';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';
import { processWardrobeJob } from '../../src/jobs/workers/wardrobe-classification.worker.js';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';

describe('Wardrobe Module Integration Tests', () => {
  let clientUser;
  let clientToken;
  let otherClientUser;
  let otherClientToken;
  let stylistUser;
  let stylistToken;

  beforeAll(async () => {
    await connectTestDB();
    await clearTestDB();

    // 1. Create client user
    clientUser = await User.create({
      name: 'Wardrobe Client',
      email: 'wardrobe.client@example.com',
      passwordHash: '$2b$12$e6mZc0U7v59n8f4B0/11ae4e6L8M8Zk0s3.V0pQ5gC2W0K.Q2e5.q',
      role: 'client',
      isEmailVerified: true,
      accountStatus: 'active',
    });
    clientToken = generateAccessToken({ sub: clientUser._id.toString(), role: clientUser.role });

    // 2. Create other client user for multi-tenant isolation testing
    otherClientUser = await User.create({
      name: 'Other Client',
      email: 'other.client@example.com',
      passwordHash: '$2b$12$e6mZc0U7v59n8f4B0/11ae4e6L8M8Zk0s3.V0pQ5gC2W0K.Q2e5.q',
      role: 'client',
      isEmailVerified: true,
      accountStatus: 'active',
    });
    otherClientToken = generateAccessToken({ sub: otherClientUser._id.toString(), role: otherClientUser.role });

    // 3. Create stylist user for RBAC testing
    stylistUser = await User.create({
      name: 'Wardrobe Stylist',
      email: 'wardrobe.stylist@example.com',
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

  describe('RBAC & Validation Guards', () => {
    it('should reject non-client roles (stylist) with 403', async () => {
      const res = await request(app)
        .post('/api/v1/wardrobe')
        .set('Authorization', `Bearer ${stylistToken}`)
        .send({ uploadRef: `murafiq/wardrobe/${stylistUser._id}/pic-1` });

      expect(res.status).toBe(403);
    });

    it('should reject unauthenticated requests with 401', async () => {
      const res = await request(app)
        .get('/api/v1/wardrobe/mine');

      expect(res.status).toBe(401);
    });

    it('should reject raw external URLs with 400 (SSRF guard)', async () => {
      const res = await request(app)
        .post('/api/v1/wardrobe')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ uploadRef: 'https://evil.com/exploit.jpg' });

      expect(res.status).toBe(400);
    });

    it('should reject uploadRef belonging to another user with 400', async () => {
      const res = await request(app)
        .post('/api/v1/wardrobe')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ uploadRef: `murafiq/wardrobe/${otherClientUser._id}/foreign-item` });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('does not belong to the authenticated user');
    });

    it('should reject with 429 when client exceeds wardrobe.photos.max (7 on free plan)', async () => {
      const currentCount = await WardrobeItem.countDocuments({ userId: clientUser._id });
      const itemsToSeed = [];
      for (let i = currentCount; i < 7; i++) {
        itemsToSeed.push({
          userId: clientUser._id,
          imageUrl: `https://res.cloudinary.com/test-${i}.jpg`,
          sourceUploadRef: `murafiq/wardrobe/${clientUser._id}/seed-${i}`,
          classificationStatus: 'done',
        });
      }
      if (itemsToSeed.length > 0) {
        await WardrobeItem.insertMany(itemsToSeed);
      }

      // 8th item attempt must be rejected with 429
      const res = await request(app)
        .post('/api/v1/wardrobe')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ uploadRef: `murafiq/wardrobe/${clientUser._id}/item-exceeding-cap` });

      expect(res.status).toBe(429);
      expect(res.body.message).toContain('Wardrobe photo limit reached');

      // Clean up seeded items so later lifecycle tests start fresh
      await WardrobeItem.deleteMany({ userId: clientUser._id });
    });
  });

  describe('Full Wardrobe Lifecycle', () => {
    let createdItemId;
    let validUploadRef;

    it('POST /wardrobe — should create pending wardrobe item and return 201 immediately', async () => {
      validUploadRef = `murafiq/wardrobe/${clientUser._id}/my-jacket-uuid`;
      const res = await request(app)
        .post('/api/v1/wardrobe')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ uploadRef: validUploadRef });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.classificationStatus).toBe('pending');
      expect(res.body.data.imageUrl).toContain(validUploadRef);

      createdItemId = res.body.data.id;
    });

    it('Simulate Worker Job — should classify and index the item', async () => {
      const job = {
        data: {
          itemId: createdItemId,
          userId: clientUser._id.toString(),
          imageUrl: 'https://res.cloudinary.com/murafiq/image/upload/v1/wardrobe/my-jacket.jpg',
        },
      };

      await processWardrobeJob(job);

      const dbItem = await WardrobeItem.findById(createdItemId);
      expect(dbItem.classificationStatus).toBe('done');
      expect(dbItem.category).toBeDefined();
      expect(dbItem.aiDescription).toBeDefined();
      expect(dbItem.embeddingId).toBe(createdItemId);
    });

    it('GET /wardrobe/mine — should list the classified item for the owner', async () => {
      const res = await request(app)
        .get('/api/v1/wardrobe/mine')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      const found = res.body.data.items.find((i) => i.id === createdItemId);
      expect(found).toBeDefined();
      expect(found.classificationStatus).toBe('done');
    });

    it('Multi-tenant isolation — other client cannot see first client items', async () => {
      const res = await request(app)
        .get('/api/v1/wardrobe/mine')
        .set('Authorization', `Bearer ${otherClientToken}`);

      expect(res.status).toBe(200);
      const found = res.body.data.items.find((i) => i.id === createdItemId);
      expect(found).toBeUndefined();
    });

    it('GET /wardrobe/:id — should retrieve item details for owner', async () => {
      const res = await request(app)
        .get(`/api/v1/wardrobe/${createdItemId}`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(createdItemId);
    });

    it('GET /wardrobe/:id — should return 404 for other client', async () => {
      const res = await request(app)
        .get(`/api/v1/wardrobe/${createdItemId}`)
        .set('Authorization', `Bearer ${otherClientToken}`);

      expect(res.status).toBe(404);
    });

    it('PATCH /wardrobe/:id — should update item attributes including genderPresentation and isArchived', async () => {
      const res = await request(app)
        .patch(`/api/v1/wardrobe/${createdItemId}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          category: 'outerwear',
          subcategory: 'trench coat',
          primaryColor: 'Charcoal',
          formality: 'smart_casual',
          genderPresentation: 'masculine',
          isArchived: true,
          styleTags: ['minimalist', 'winter'],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.category).toBe('outerwear');
      expect(res.body.data.subcategory).toBe('trench coat');
      expect(res.body.data.genderPresentation).toBe('masculine');
      expect(res.body.data.isArchived).toBe(true);
    });

    it('GET /wardrobe/mine — should exclude archived item by default, and include when isArchived=true', async () => {
      // Default query: excludes isArchived: true
      const defaultRes = await request(app)
        .get('/api/v1/wardrobe/mine')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(defaultRes.status).toBe(200);
      const inDefault = defaultRes.body.data.items.find((i) => i.id === createdItemId);
      expect(inDefault).toBeUndefined();

      // Query with isArchived=true: includes the item
      const archivedRes = await request(app)
        .get('/api/v1/wardrobe/mine?isArchived=true')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(archivedRes.status).toBe(200);
      const inArchived = archivedRes.body.data.items.find((i) => i.id === createdItemId);
      expect(inArchived).toBeDefined();

      // Query with genderPresentation=masculine: includes the item
      const genderRes = await request(app)
        .get('/api/v1/wardrobe/mine?isArchived=true&genderPresentation=masculine')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(genderRes.status).toBe(200);
      const inGender = genderRes.body.data.items.find((i) => i.id === createdItemId);
      expect(inGender).toBeDefined();

      // Query with genderPresentation=feminine: excludes the item
      const feminineRes = await request(app)
        .get('/api/v1/wardrobe/mine?isArchived=true&genderPresentation=feminine')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(feminineRes.status).toBe(200);
      const inFeminine = feminineRes.body.data.items.find((i) => i.id === createdItemId);
      expect(inFeminine).toBeUndefined();
    });

    it('DELETE /wardrobe/:id — should hard-delete item from DB', async () => {
      const res = await request(app)
        .delete(`/api/v1/wardrobe/${createdItemId}`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);

      const dbCheck = await WardrobeItem.findById(createdItemId);
      expect(dbCheck).toBeNull();
    });
  });

  describe('POST /api/v1/wardrobe/from-chat', () => {
    it('saves garment from chat message, clears expiry, sets savedWardrobeItemId, and returns 201', async () => {
      const conv = await AiConversation.create({
        userId: clientUser._id,
        title: 'Test Chat',
      });

      const msg = await AiMessage.create({
        conversationId: conv._id,
        role: 'user',
        content: 'Check out this shirt',
        imageRef: `murafiq/ai-chat/${clientUser._id}/shirt_save_test`,
        imageUrl: 'https://cloudinary.com/test-shirt.jpg',
        imageAnalysis: {
          category: 'top',
          subcategory: 'linen_shirt',
          colors: ['blue'],
          colorFamily: 'blue',
          pattern: 'solid',
          formality: 'smart_casual',
          material: 'linen',
          confidence: 0.95,
        },
        imageExpiresAt: new Date(Date.now() + 86400000),
      });

      const res = await request(app)
        .post('/api/v1/wardrobe/from-chat')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ messageId: msg._id.toString() });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.origin).toBe('chat_save');
      expect(res.body.data.category).toBe('top');
      expect(res.body.data.subcategory).toBe('linen_shirt');

      // Verify AiMessage was updated
      const updatedMsg = await AiMessage.findById(msg._id);
      expect(updatedMsg.imageExpiresAt).toBeNull();
      expect(updatedMsg.savedWardrobeItemId).toBeDefined();
      expect(updatedMsg.savedWardrobeItemId.toString()).toBe(res.body.data.id);

      // Verify idempotency on second call
      const res2 = await request(app)
        .post('/api/v1/wardrobe/from-chat')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ messageId: msg._id.toString() });

      expect(res2.status).toBe(201);
      expect(res2.body.data.id).toBe(res.body.data.id);
    });

    it('rejects save attempt for message belonging to another user with 404', async () => {
      const otherConv = await AiConversation.create({
        userId: otherClientUser._id,
        title: 'Other Chat',
      });

      const otherMsg = await AiMessage.create({
        conversationId: otherConv._id,
        role: 'user',
        content: 'Other user shirt',
        imageRef: `murafiq/ai-chat/${otherClientUser._id}/other_shirt`,
        imageUrl: 'https://cloudinary.com/other-shirt.jpg',
        imageAnalysis: { category: 'top' },
      });

      const res = await request(app)
        .post('/api/v1/wardrobe/from-chat')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ messageId: otherMsg._id.toString() });

      expect(res.status).toBe(404);
    });

    it('rejects invalid role with 403', async () => {
      const res = await request(app)
        .post('/api/v1/wardrobe/from-chat')
        .set('Authorization', `Bearer ${stylistToken}`)
        .send({ messageId: '507f1f77bcf86cd799439011' });

      expect(res.status).toBe(403);
    });
  });
});
