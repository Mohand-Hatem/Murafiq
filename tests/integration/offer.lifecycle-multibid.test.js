import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';

const clientId = '60f719b8f1a2c81234567891';
const stylistId = '60f719b8f1a2c81234567890';
const requestId = '60f719b8f1a2c81234567888';
const offerId1 = '60f719b8f1a2c81234567871';

const clientToken = generateAccessToken({ sub: clientId, role: 'client' });
const stylistToken = generateAccessToken({ sub: stylistId, role: 'stylist' });

const mockOffer = {
  _id: offerId1,
  requestId,
  stylistId: { _id: stylistId, name: 'Stylist User', profileImage: null },
  clientId: { _id: clientId, name: 'Client User', profileImage: null },
  price: 300,
  duration: 60,
  status: 'PENDING',
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  toObject: function () {
    return this;
  },
};

const mockRequestDoc = {
  _id: requestId,
  clientId: { _id: clientId, toString: () => clientId },
  visibility: 'broadcast',
  status: 'OPEN',
  offerCount: 1,
  expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
  toObject: function () {
    return this;
  },
};

const mockFindOfferById = jest.fn().mockResolvedValue(mockOffer);
const mockUpdateOfferById = jest.fn().mockImplementation((id, data) =>
  Promise.resolve({ ...mockOffer, ...data })
);
const mockCreateOffer = jest.fn().mockImplementation((data) =>
  Promise.resolve({ ...mockOffer, ...data })
);
const mockCountByStylist = jest.fn().mockResolvedValue(0);

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: jest.fn().mockImplementation((id) => {
      if (id.toString() === stylistId) {
        return Promise.resolve({
          _id: stylistId,
          role: 'stylist',
          verification: { status: 'verified' },
        });
      }
      return Promise.resolve({
        _id: clientId,
        role: 'client',
        verification: { status: 'verified' },
      });
    }),
  },
}));

jest.unstable_mockModule('../../src/modules/requests/request.repository.js', () => ({
  default: {
    findById: jest.fn().mockResolvedValue(mockRequestDoc),
    updateById: jest.fn().mockResolvedValue(mockRequestDoc),
    expireOldRequests: jest.fn().mockResolvedValue({}),
  },
}));

jest.unstable_mockModule('../../src/modules/offers/offer.repository.js', () => ({
  default: {
    findById: mockFindOfferById,
    updateById: mockUpdateOfferById,
    create: mockCreateOffer,
    countByStylistAndRequest: mockCountByStylist,
    findAllByRequestId: jest.fn().mockResolvedValue([mockOffer]),
    closeSiblingOffers: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    expireOldOffers: jest.fn().mockResolvedValue({}),
  },
}));

jest.unstable_mockModule('../../src/modules/subscriptions/entitlement.service.js', () => ({
  default: {
    capacity: jest.fn().mockResolvedValue({ limit: 6, used: 2, available: 4, hasCapacity: true }),
    consume: jest.fn().mockResolvedValue({ success: true, used: 3, limit: 6 }),
    refundQuota: jest.fn().mockResolvedValue({}),
  },
  capacity: jest.fn().mockResolvedValue({ limit: 6, used: 2, available: 4, hasCapacity: true }),
  consume: jest.fn().mockResolvedValue({ success: true, used: 3, limit: 6 }),
  refundQuota: jest.fn().mockResolvedValue({}),
}));

const { default: app } = await import('../../src/app.js');

describe('Stage R5 Integration — Offer Lifecycle & Withdraw Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/offers/requests/:id', () => {
    it('allows stylist to place a multi-bid offer on a broadcast request', async () => {
      const res = await request(app)
        .post(`/api/v1/offers/requests/${requestId}`)
        .set('Authorization', `Bearer ${stylistToken}`)
        .send({
          price: 450,
          duration: 90,
          message: 'Revised quote with premium styling kit',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.price).toBe(450);
    });
  });

  describe('PATCH /api/v1/offers/:id/withdraw', () => {
    it('allows stylist to withdraw their pending offer', async () => {
      const res = await request(app)
        .patch(`/api/v1/offers/${offerId1}/withdraw`)
        .set('Authorization', `Bearer ${stylistToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockUpdateOfferById).toHaveBeenCalledWith(
        offerId1,
        expect.objectContaining({ status: 'WITHDRAWN' })
      );
    });

    it('rejects offer withdrawal from a client token', async () => {
      const res = await request(app)
        .patch(`/api/v1/offers/${offerId1}/withdraw`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(403);
    });
  });
});
