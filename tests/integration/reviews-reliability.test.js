import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';

const clientId = '60f719b8f1a2c81234567891';
const stylistId = '60f719b8f1a2c81234567890';
const bookingId = '60f719b8f1a2c81234567888';

const clientToken = generateAccessToken({ sub: clientId, role: 'client' });

const mockBookingCompletedFresh = {
  _id: bookingId,
  clientId: { _id: clientId },
  stylistId: { _id: stylistId },
  status: 'completed',
  completedAt: new Date(), // Just completed
};

const mockBookingCompletedStale = {
  _id: bookingId,
  clientId: { _id: clientId },
  stylistId: { _id: stylistId },
  status: 'completed',
  completedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
};

const mockReviewDoc = {
  _id: '60f719b8f1a2c81234567877',
  bookingId,
  raterId: { _id: clientId, name: 'Client User' },
  revieweeId: { _id: stylistId, name: 'Stylist User' },
  direction: 'client_to_stylist',
  rating: 5,
  comment: 'Excellent styling experience!',
  isHidden: false,
};

const mockBookingFindById = jest.fn();
const mockFindCompletedAndCancelled = jest.fn().mockResolvedValue([]);

jest.unstable_mockModule('../../src/modules/bookings/booking.repository.js', () => ({
  default: {
    findById: mockBookingFindById,
    findCompletedAndCancelledByStylistId: mockFindCompletedAndCancelled,
  },
  findById: mockBookingFindById,
  findCompletedAndCancelledByStylistId: mockFindCompletedAndCancelled,
}));

jest.unstable_mockModule('../../src/modules/penalties/penalty.repository.js', () => ({
  default: {
    findOutstandingByStylistId: jest.fn().mockResolvedValue([]),
  },
  findOutstandingByStylistId: jest.fn().mockResolvedValue([]),
}));

jest.unstable_mockModule('../../src/modules/reviews/review.repository.js', () => ({
  default: {
    create: jest.fn().mockResolvedValue(mockReviewDoc),
    findById: jest.fn().mockResolvedValue(mockReviewDoc),
    findByBookingAndDirection: jest.fn().mockResolvedValue(null),
    findByBookingId: jest.fn().mockResolvedValue([mockReviewDoc]),
    aggregateRating: jest.fn().mockResolvedValue({ avgRating: 5.0, totalReviews: 1 }),
  },
}));

jest.unstable_mockModule('../../src/modules/stylists/stylist.repository.js', () => ({
  default: {
    updateByUserId: jest.fn().mockResolvedValue({}),
    findById: jest.fn().mockResolvedValue({ userId: stylistId }),
  },
}));

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: jest.fn().mockImplementation((id) =>
      Promise.resolve({
        _id: id,
        role: id === stylistId ? 'stylist' : 'client',
        name: 'Test User',
      })
    ),
    updateById: jest.fn().mockResolvedValue({}),
  },
}));

jest.unstable_mockModule('../../src/modules/moderation/moderation.service.js', () => ({
  default: {
    scanAndEnforce: jest.fn().mockImplementation(async (userId, contentType, text) => {
      const { default: envConfig } = await import('../../src/config/env.config.js');
      const { default: ApiError } = await import('../../src/common/utils/ApiError.js');
      if (text && text.includes('01012345678') && envConfig.MODERATION_MODE === 'ENFORCE') {
        throw new ApiError(422, 'Content violation: Off-platform contact not permitted');
      }
      return { isAllowed: true, flagged: false };
    }),
  },
}));

const { default: app } = await import('../../src/app.js');
const { default: env } = await import('../../src/config/env.config.js');

describe('Stage R8 Integration — Reviews & Reliability Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/bookings/:bookingId/review — 14-day window & safety', () => {
    it('accepts review for freshly completed booking', async () => {
      mockBookingFindById.mockResolvedValue(mockBookingCompletedFresh);

      const res = await request(app)
        .post(`/api/v1/bookings/${bookingId}/review`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          rating: 5,
          comment: 'Great hair cut and very punctual!',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('rejects review submitted after 14 days with 400', async () => {
      mockBookingFindById.mockResolvedValue(mockBookingCompletedStale);

      const res = await request(app)
        .post(`/api/v1/bookings/${bookingId}/review`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          rating: 5,
          comment: 'Late review after 15 days',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/14-day window/i);
    });

    it('blocks off-platform contact in review comments under ENFORCE mode with 422', async () => {
      env.MODERATION_MODE = 'ENFORCE';
      mockBookingFindById.mockResolvedValue(mockBookingCompletedFresh);

      const res = await request(app)
        .post(`/api/v1/bookings/${bookingId}/review`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          rating: 5,
          comment: 'Loved it! Call me at 01012345678 next time',
        });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/Content violation/i);
    });
  });

  describe('GET /api/v1/stylists/:id/reliability', () => {
    it('returns public reliability metrics breakdown for a stylist', async () => {
      const res = await request(app).get(`/api/v1/stylists/${stylistId}/reliability`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('score');
      expect(res.body.data).toHaveProperty('tier');
      expect(res.body.data).toHaveProperty('metrics');
    });
  });

  describe('GET /api/v1/bookings/:bookingId/reviews', () => {
    it('returns reviews submitted for the booking to participants', async () => {
      mockBookingFindById.mockResolvedValue(mockBookingCompletedFresh);

      const res = await request(app)
        .get(`/api/v1/bookings/${bookingId}/reviews`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });
  });
});
