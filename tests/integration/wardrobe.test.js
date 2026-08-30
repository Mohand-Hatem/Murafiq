import '../../src/common/globals.js';
import request from 'supertest';
import app from '../../src/app.js';
import User from '../../src/modules/users/user.model.js';
import WardrobeItem from '../../src/modules/wardrobe/wardrobe-item.model.js';
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

  describe('RBAC Guards', () => {
    it('should reject non-client roles (stylist) with 403', async () => {
      const res = await request(app)
        .post('/api/v1/wardrobe')
        .set('Authorization', `Bearer ${stylistToken}`)
        .send({ imageUrl: 'https://example.com/pic.jpg' });

      expect(res.status).toBe(403);
    });

    it('should reject unauthenticated requests with 401', async () => {
      const res = await request(app)
        .get('/api/v1/wardrobe/mine');

      expect(res.status).toBe(401);
    });
  });

  describe('Full Wardrobe Lifecycle', () => {
    let createdItemId;

    it('POST /wardrobe — should create pending wardrobe item and return 201 immediately', async () => {
      const res = await request(app)
        .post('/api/v1/wardrobe')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ imageUrl: 'https://res.cloudinary.com/murafiq/image/upload/v1/wardrobe/my-jacket.jpg' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.classificationStatus).toBe('pending');
      expect(res.body.data.imageUrl).toBe('https://res.cloudinary.com/murafiq/image/upload/v1/wardrobe/my-jacket.jpg');

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

    it('PATCH /wardrobe/:id — should update item attributes', async () => {
      const res = await request(app)
        .patch(`/api/v1/wardrobe/${createdItemId}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          category: 'outerwear',
          primaryColor: 'Charcoal',
          formality: 'smart_casual',
          styleTags: ['minimalist', 'winter'],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.category).toBe('outerwear');
      expect(res.body.data.primaryColor).toBe('Charcoal');
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
});
