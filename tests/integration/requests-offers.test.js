import { jest } from '@jest/globals';
import request from 'supertest';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';

const mockVerifiedClient = {
  _id: '60f719b8f1a2c81234567891',
  name: 'Verified Client',
  email: 'client@test.com',
  role: 'client',
  isEmailVerified: true,
  accountStatus: 'active',
  verification: { status: 'verified' },
  toObject: function () {
    return this;
  },
};

const mockUnverifiedClient = {
  _id: '60f719b8f1a2c81234567892',
  name: 'Unverified Client',
  email: 'unverified-client@test.com',
  role: 'client',
  isEmailVerified: true,
  accountStatus: 'active',
  verification: { status: 'unverified' },
  toObject: function () {
    return this;
  },
};

const mockVerifiedStylistUser = {
  _id: '60f719b8f1a2c81234567890',
  name: 'Verified Stylist',
  email: 'stylist@test.com',
  role: 'stylist',
  isEmailVerified: true,
  accountStatus: 'active',
  verification: { status: 'verified' },
  toObject: function () {
    return this;
  },
};

const mockStylistProfile = {
  _id: '70f719b8f1a2c81234567890',
  userId: mockVerifiedStylistUser._id,
  specialty: 'stylist',
  hourlyPrice: 200,
  toObject: function () {
    return this;
  },
};

const mockRequestDoc = {
  _id: '80f719b8f1a2c81234567890',
  clientId: mockVerifiedClient,
  stylistId: mockVerifiedStylistUser,
  title: 'Personal Shopping Session',
  status: 'pending',
  expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
  toObject: function () {
    return this;
  },
};

const mockOfferDoc = {
  _id: '90f719b8f1a2c81234567890',
  requestId: mockRequestDoc._id,
  stylistId: mockVerifiedStylistUser,
  clientId: mockVerifiedClient,
  price: 250,
  duration: 120,
  status: 'pending',
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  toObject: function () {
    return this;
  },
};

let clientRequestCount = 0;
let stylistOfferCount = 0;
let activeOfferStore = null;

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: jest.fn().mockImplementation((id) => {
      if (id === mockVerifiedClient._id) return Promise.resolve(mockVerifiedClient);
      if (id === mockUnverifiedClient._id) return Promise.resolve(mockUnverifiedClient);
      if (id === mockVerifiedStylistUser._id) return Promise.resolve(mockVerifiedStylistUser);
      return Promise.resolve(null);
    }),
  },
}));

jest.unstable_mockModule('../../src/modules/stylists/stylist.repository.js', () => ({
  default: {
    findByUserId: jest.fn().mockImplementation((userId) => {
      if (userId === mockVerifiedStylistUser._id) return Promise.resolve(mockStylistProfile);
      return Promise.resolve(null);
    }),
  },
}));

jest.unstable_mockModule('../../src/modules/requests/request.repository.js', () => ({
  default: {
    create: jest.fn().mockImplementation((data) => Promise.resolve({ ...mockRequestDoc, ...data })),
    findById: jest.fn().mockImplementation((id) => Promise.resolve(mockRequestDoc)),
    countDailyClientRequests: jest.fn().mockImplementation(() => Promise.resolve(clientRequestCount)),
    updateById: jest.fn().mockImplementation((id, data) => Promise.resolve({ ...mockRequestDoc, ...data })),
    findMine: jest.fn().mockResolvedValue({ items: [mockRequestDoc], meta: { total: 1 } }),
    findIncoming: jest.fn().mockResolvedValue({ items: [mockRequestDoc], meta: { total: 1 } }),
    expireOldRequests: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  },
}));

jest.unstable_mockModule('../../src/modules/offers/offer.repository.js', () => ({
  default: {
    create: jest.fn().mockImplementation((data) => Promise.resolve({ ...mockOfferDoc, ...data })),
    findById: jest.fn().mockImplementation((id) => Promise.resolve(mockOfferDoc)),
    findActiveForClient: jest.fn().mockImplementation(() => Promise.resolve(activeOfferStore)),
    countDailyStylistOffers: jest.fn().mockImplementation(() => Promise.resolve(stylistOfferCount)),
    updateById: jest.fn().mockImplementation((id, data) => Promise.resolve({ ...mockOfferDoc, ...data })),
    expireOldOffers: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  },
}));

jest.unstable_mockModule('../../src/modules/bookings/booking.repository.js', () => ({
  default: {
    create: jest.fn().mockImplementation((data) => Promise.resolve({ _id: 'a0f719b8f1a2c81234567890', status: 'confirmed', ...data })),
    findById: jest.fn().mockResolvedValue(null),
    updateById: jest.fn().mockResolvedValue(null),
  },
}));

jest.unstable_mockModule('../../src/modules/bookings/schedule.repository.js', () => ({
  default: {
    findOverlap: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ _id: 'b0f719b8f1a2c81234567890' }),
  },
}));

const { default: app } = await import('../../src/app.js');

describe('Phase 4 Integration — Requests & Offers', () => {
  const clientToken = generateAccessToken({ sub: mockVerifiedClient._id, role: 'client' });
  const unverifiedClientToken = generateAccessToken({ sub: mockUnverifiedClient._id, role: 'client' });
  const stylistToken = generateAccessToken({ sub: mockVerifiedStylistUser._id, role: 'stylist' });

  beforeEach(() => {
    clientRequestCount = 0;
    stylistOfferCount = 0;
    activeOfferStore = null;
  });

  describe('POST /api/v1/requests', () => {
    it('should reject request creation if client is unverified (403)', async () => {
      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${unverifiedClientToken}`)
        .send({
          stylistId: mockVerifiedStylistUser._id,
          title: 'Shopping Session',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/verified/i);
    });

    it('should allow verified client to create a request', async () => {
      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          stylistId: mockVerifiedStylistUser._id,
          title: 'Shopping Session',
          budgetRange: { min: 150, max: 300 },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('Shopping Session');
    });

    it('should enforce client daily request cap (max 2/day)', async () => {
      clientRequestCount = 2; // Already created 2 today!

      const res = await request(app)
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          stylistId: mockVerifiedStylistUser._id,
          title: '3rd Request of the Day',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Daily request limit reached/i);
    });
  });

  describe('POST /api/v1/requests/:id/offers', () => {
    it('should allow verified stylist to send an offer', async () => {
      const res = await request(app)
        .post(`/api/v1/offers/requests/${mockRequestDoc._id}`)
        .set('Authorization', `Bearer ${stylistToken}`)
        .send({
          price: 250,
          duration: 120,
          message: 'Available on Monday at 2 PM',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.price).toBe(250);
    });

    it('should enforce stylist daily offer cap (max 5/day)', async () => {
      stylistOfferCount = 5; // Already sent 5 offers today!

      const res = await request(app)
        .post(`/api/v1/offers/requests/${mockRequestDoc._id}`)
        .set('Authorization', `Bearer ${stylistToken}`)
        .send({
          price: 250,
          duration: 120,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Daily offer limit reached/i);
    });

    it('should enforce cross-request one active offer per client rule (409)', async () => {
      activeOfferStore = mockOfferDoc; // Stylist already has an active offer with this client!

      const res = await request(app)
        .post(`/api/v1/offers/requests/${mockRequestDoc._id}`)
        .set('Authorization', `Bearer ${stylistToken}`)
        .send({
          price: 300,
          duration: 90,
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already have an active offer/i);
    });
  });

  describe('PATCH /api/v1/offers/:id/accept', () => {
    it('should allow client to accept an offer', async () => {
      const res = await request(app)
        .patch(`/api/v1/offers/${mockOfferDoc._id}/accept`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('confirmed');
    });
  });
});
