import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';

const clientId = '60f719b8f1a2c81234567891';
const stylistId = '60f719b8f1a2c81234567890';
const requestId = '60f719b8f1a2c81234567888';

const clientToken = generateAccessToken({ sub: clientId, role: 'client' });
const stylistToken = generateAccessToken({ sub: stylistId, role: 'stylist' });

const mockRequestWithOffers = {
  _id: requestId,
  clientId: { _id: clientId, name: 'Client User', profileImage: null },
  title: 'Open Styling Session',
  description: 'Looking for a stylist in Cairo',
  visibility: 'broadcast',
  status: 'OPEN', // Has existing bids
  offerCount: 2,
  pauseCount: 0,
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 40 * 60 * 60 * 1000),
  autoPauseAt: new Date(Date.now() + 40 * 60 * 60 * 1000),
  toObject: function () {
    return this;
  },
};

const mockFindById = jest.fn().mockResolvedValue(mockRequestWithOffers);
const mockUpdateById = jest.fn().mockImplementation((id, data) =>
  Promise.resolve({ ...mockRequestWithOffers, ...data })
);

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
    findById: mockFindById,
    updateById: mockUpdateById,
    expireOldRequests: jest.fn().mockResolvedValue({}),
    findMine: jest.fn().mockResolvedValue({ items: [mockRequestWithOffers], meta: { total: 1 } }),
    findIncoming: jest.fn().mockResolvedValue({ items: [], meta: { total: 0 } }),
  },
}));

jest.unstable_mockModule('../../src/modules/requests/request-feed.service.js', () => ({
  default: {
    getBroadcastFeed: jest.fn().mockResolvedValue({
      items: [mockRequestWithOffers],
      meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
    }),
  },
  getBroadcastFeed: jest.fn().mockResolvedValue({
    items: [mockRequestWithOffers],
    meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
  }),
}));

jest.unstable_mockModule('../../src/modules/subscriptions/entitlement.service.js', () => ({
  default: {
    capacity: jest.fn().mockResolvedValue({ limit: 4, used: 1, available: 3, hasCapacity: true }),
    consume: jest.fn().mockResolvedValue({ success: true, used: 1, limit: 4 }),
    refundQuota: jest.fn().mockResolvedValue({}),
  },
  capacity: jest.fn().mockResolvedValue({ limit: 4, used: 1, available: 3, hasCapacity: true }),
  consume: jest.fn().mockResolvedValue({ success: true, used: 1, limit: 4 }),
  refundQuota: jest.fn().mockResolvedValue({}),
}));

const { default: app } = await import('../../src/app.js');

describe('Stage R4 Integration — Broadcast Multi-Bid Feed & Request Lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/requests/feed', () => {
    it('returns broadcast requests that already have active offers (multi-bid support)', async () => {
      const res = await request(app)
        .get('/api/v1/requests/feed')
        .set('Authorization', `Bearer ${stylistToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].status).toBe('OPEN');
    });

    it('rejects access from clients (stylist role required)', async () => {
      const res = await request(app)
        .get('/api/v1/requests/feed')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/v1/requests/:id (Edit Request)', () => {
    it('updates request successfully when authorized as owner client', async () => {
      const openReq = {
        ...mockRequestWithOffers,
        offerCount: 0,
        status: 'OPEN',
      };
      mockFindById.mockResolvedValueOnce(openReq);

      const res = await request(app)
        .patch(`/api/v1/requests/${requestId}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          title: 'Updated Styling Title',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockUpdateById).toHaveBeenCalledWith(
        requestId,
        expect.objectContaining({ title: 'Updated Styling Title' })
      );
    });
  });

  describe('PATCH /api/v1/requests/:id/close (Close Request)', () => {
    it('closes an open request when requested by owner client', async () => {
      const openReq = {
        ...mockRequestWithOffers,
        status: 'OPEN',
      };
      mockFindById.mockResolvedValueOnce(openReq);

      const res = await request(app)
        .patch(`/api/v1/requests/${requestId}/close`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockUpdateById).toHaveBeenCalledWith(
        requestId,
        expect.objectContaining({ status: 'CLOSED' })
      );
    });
  });
});
