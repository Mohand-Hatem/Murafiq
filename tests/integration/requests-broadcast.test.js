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

const mockBroadcastRequestDoc = {
  _id: '80f719b8f1a2c81234567890',
  clientId: mockVerifiedClient,
  visibility: 'broadcast',
  stylistId: null,
  title: 'Open Bridal Styling Request',
  status: 'pending',
  expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
  toObject: function () {
    return this;
  },
};

const mockBroadcastOfferDoc = {
  _id: '90f719b8f1a2c81234567890',
  requestId: mockBroadcastRequestDoc._id,
  stylistId: mockVerifiedStylistUser,
  clientId: mockVerifiedClient,
  requestVisibility: 'broadcast',
  price: 500,
  duration: 90,
  status: 'pending',
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  toObject: function () {
    return this;
  },
};

let clientRequestCount = 0;
let stylistOfferCount = 0;

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: jest.fn().mockImplementation((id) => {
      if (id === mockVerifiedClient._id) return Promise.resolve(mockVerifiedClient);
      if (id === mockVerifiedStylistUser._id) return Promise.resolve(mockVerifiedStylistUser);
      return Promise.resolve(null);
    }),
  },
}));

jest.unstable_mockModule('../../src/modules/stylists/stylist.repository.js', () => ({
  default: {
    findByUserId: jest.fn().mockResolvedValue({ _id: '70f719b8f1a2c81234567890' }),
    findVerifiedInArea: jest.fn().mockResolvedValue([{ userId: mockVerifiedStylistUser._id }]),
  },
}));

jest.unstable_mockModule('../../src/modules/requests/request.repository.js', () => ({
  default: {
    create: jest.fn().mockImplementation((data) => Promise.resolve({ ...mockBroadcastRequestDoc, ...data })),
    findById: jest.fn().mockImplementation((_id) => Promise.resolve(mockBroadcastRequestDoc)),
    countDailyClientRequests: jest.fn().mockImplementation(() => Promise.resolve(clientRequestCount)),
    updateById: jest.fn().mockImplementation((id, data) => Promise.resolve({ ...mockBroadcastRequestDoc, ...data })),
    expireOldRequests: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  },
}));

jest.unstable_mockModule('../../src/modules/offers/offer.repository.js', () => ({
  default: {
    create: jest.fn().mockImplementation((data) => Promise.resolve({ ...mockBroadcastOfferDoc, ...data })),
    findById: jest.fn().mockImplementation((_id) => Promise.resolve(mockBroadcastOfferDoc)),
    findActiveForClient: jest.fn().mockResolvedValue(null),
    countDailyStylistOffers: jest.fn().mockImplementation(() => Promise.resolve(stylistOfferCount)),
    updateById: jest.fn().mockImplementation((id, data) => Promise.resolve({ ...mockBroadcastOfferDoc, ...data })),
    expireOldOffers: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  },
}));

const { default: app } = await import('../../src/app.js');

describe('Open Broadcast Requests — Integration Tests', () => {
  const clientToken = generateAccessToken({ sub: mockVerifiedClient._id, role: 'client' });
  const stylistToken = generateAccessToken({ sub: mockVerifiedStylistUser._id, role: 'stylist' });

  beforeEach(() => {
    clientRequestCount = 0;
    stylistOfferCount = 0;
  });

  it('should create a broadcast request without stylistId', async () => {
    const res = await request(app)
      .post('/api/v1/requests')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        visibility: 'broadcast',
        title: 'Open Bridal Styling Request',
        budgetRange: { min: 400, max: 800 },
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.visibility).toBe('broadcast');
  });

  it('should reject direct request when stylistId is missing (400)', async () => {
    const res = await request(app)
      .post('/api/v1/requests')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({
        visibility: 'direct',
        title: 'Direct Request Missing Stylist',
      });

    expect(res.status).toBe(400);
  });

  it('should allow stylist to submit an offer on open broadcast request', async () => {
    const res = await request(app)
      .post(`/api/v1/offers/requests/${mockBroadcastRequestDoc._id}`)
      .set('Authorization', `Bearer ${stylistToken}`)
      .send({
        price: 500,
        duration: 90,
        message: 'Available and ready for bridal styling.',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('should enforce daily offer cap on broadcast offers (max 10/day)', async () => {
    stylistOfferCount = 10; // Already sent 10 broadcast offers today

    const res = await request(app)
      .post(`/api/v1/offers/requests/${mockBroadcastRequestDoc._id}`)
      .set('Authorization', `Bearer ${stylistToken}`)
      .send({
        price: 500,
        duration: 90,
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Daily broadcast offer limit reached/i);
  });
});
