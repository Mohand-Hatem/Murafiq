import { jest } from '@jest/globals';
import request from 'supertest';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';

const clientId = '60f719b8f1a2c81234567891';
const stylistId = '60f719b8f1a2c81234567890';
const outsiderId = '60f719b8f1a2c81234567899';
const adminId = '60f719b8f1a2c81234567895';
const bookingId = '60f719b8f1a2c81234567888';
const reviewId = '60f719b8f1a2c81234567877';

const mockCompletedBooking = {
  _id: bookingId,
  clientId: { _id: clientId, toString: () => clientId },
  stylistId: { _id: stylistId, toString: () => stylistId },
  status: 'completed',
  toObject: function () {
    return this;
  },
};

const mockReview = {
  _id: reviewId,
  bookingId: { _id: bookingId, toString: () => bookingId },
  raterId: { _id: clientId, name: 'Sara Client', profileImage: 'https://example.com/avatar.jpg' },
  revieweeId: { _id: stylistId, name: 'Ahmed Stylist' },
  direction: 'client_to_stylist',
  rating: 5,
  comment: 'Excellent styling session!',
  isHidden: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  toObject: function () {
    return this;
  },
};

const mockFindBookingById = jest.fn().mockImplementation((id) => {
  if (id === bookingId) return Promise.resolve(mockCompletedBooking);
  return Promise.resolve(null);
});

jest.unstable_mockModule('../../src/modules/bookings/booking.repository.js', () => ({
  default: {
    findById: mockFindBookingById,
  },
  findById: mockFindBookingById,
}));

const mockFindReviewById = jest.fn().mockResolvedValue(mockReview);
const mockFindByBookingAndDirection = jest.fn().mockResolvedValue(null);
const mockCreateReview = jest.fn().mockResolvedValue(mockReview);
const mockFindStylistReviews = jest.fn().mockResolvedValue({
  items: [mockReview],
  meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
});
const mockFindUserReviews = jest.fn().mockResolvedValue({
  items: [mockReview],
  meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
});
const mockUpdateReviewById = jest.fn().mockResolvedValue({ ...mockReview, isHidden: true });
const mockAggregateRating = jest.fn().mockResolvedValue({ avgRating: 5.0, totalReviews: 1 });

jest.unstable_mockModule('../../src/modules/reviews/review.repository.js', () => ({
  default: {
    create: mockCreateReview,
    findById: mockFindReviewById,
    findByBookingAndDirection: mockFindByBookingAndDirection,
    findStylistReviews: mockFindStylistReviews,
    findUserReviews: mockFindUserReviews,
    updateById: mockUpdateReviewById,
    aggregateRating: mockAggregateRating,
  },
  create: mockCreateReview,
  findById: mockFindReviewById,
  findByBookingAndDirection: mockFindByBookingAndDirection,
  findStylistReviews: mockFindStylistReviews,
  findUserReviews: mockFindUserReviews,
  updateById: mockUpdateReviewById,
  aggregateRating: mockAggregateRating,
}));

const mockStylistProfile = {
  _id: '60f719b8f1a2c81234567833',
  userId: { _id: stylistId },
  rating: 5.0,
  totalReviews: 1,
};

jest.unstable_mockModule('../../src/modules/stylists/stylist.repository.js', () => ({
  default: {
    findById: jest.fn().mockResolvedValue(mockStylistProfile),
    findByUserId: jest.fn().mockResolvedValue(mockStylistProfile),
    updateByUserId: jest.fn().mockResolvedValue(mockStylistProfile),
  },
}));

const { default: app } = await import('../../src/app.js');

describe('Phase 8 Integration — Reviews & Ratings Endpoints', () => {
  const clientToken = generateAccessToken({ sub: clientId, role: 'client' });
  const outsiderToken = generateAccessToken({ sub: outsiderId, role: 'client' });
  const adminToken = generateAccessToken({ sub: adminId, role: 'admin' });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/bookings/:bookingId/review', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post(`/api/v1/bookings/${bookingId}/review`)
        .send({ rating: 5, comment: 'Great!' });

      expect(res.status).toBe(401);
    });

    it('submits a review successfully for completed booking with 201', async () => {
      mockFindByBookingAndDirection.mockResolvedValueOnce(null);

      const res = await request(app)
        .post(`/api/v1/bookings/${bookingId}/review`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ rating: 5, comment: 'Excellent styling session!' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.rating).toBe(5);
      expect(res.body.data.direction).toBe('client_to_stylist');
    });

    it('rejects duplicate review in same direction with 409 Conflict', async () => {
      mockFindByBookingAndDirection.mockResolvedValueOnce(mockReview);

      const res = await request(app)
        .post(`/api/v1/bookings/${bookingId}/review`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ rating: 5, comment: 'Submitting again' });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('already submitted a review');
    });

    it('rejects non-participant with 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/api/v1/bookings/${bookingId}/review`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ rating: 5 });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/stylists/:id/reviews', () => {
    it('fetches public sanitized reviews for a stylist', async () => {
      const res = await request(app).get(`/api/v1/stylists/${stylistId}/reviews`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data[0].client.name).toBe('Sara Client');
      expect(res.body.meta.total).toBe(1);
    });
  });

  describe('GET /api/v1/reviews/mine', () => {
    it('fetches reviews submitted by authenticated user', async () => {
      const res = await request(app)
        .get('/api/v1/reviews/mine')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });
  });

  describe('PATCH /api/v1/admin/reviews/:id/hide', () => {
    it('rejects non-admin users with 403 Forbidden', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/reviews/${reviewId}/hide`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ isHidden: true });

      expect(res.status).toBe(403);
    });

    it('allows Admin to hide a review and re-aggregate ratings', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/reviews/${reviewId}/hide`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isHidden: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isHidden).toBe(true);
    });
  });
});
