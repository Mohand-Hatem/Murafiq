import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';

const clientId = '60f719b8f1a2c81234567891';
const stylistId = '60f719b8f1a2c81234567890';
const stylistProfileId = '60f719b8f1a2c81234567877';

const clientToken = generateAccessToken({ sub: clientId, role: 'client' });
const stylistToken = generateAccessToken({ sub: stylistId, role: 'stylist' });

const mockClientUser = {
  _id: clientId,
  name: 'Layla Ahmed',
  email: 'layla@example.com',
  phone: '+201098765432',
  role: 'client',
  profileImage: 'https://cloudinary.com/layla.jpg',
  verification: { status: 'verified' },
  completedBookings: 5,
  clientRating: 4.9,
  clientTotalReviews: 4,
  governorate: 'Cairo',
  city: 'Maadi',
  createdAt: new Date('2025-02-01'),
};

const mockStylistUser = {
  _id: stylistId,
  name: 'Ahmed Stylist',
  email: 'ahmed@example.com',
  phone: '+201011112222',
  role: 'stylist',
  profileImage: 'https://cloudinary.com/ahmed.jpg',
  verification: { status: 'verified' },
};

const mockStylistProfile = {
  _id: stylistProfileId,
  userId: mockStylistUser,
  specialty: 'Hair Styling',
  hourlyPrice: 350,
  rating: 4.8,
  totalReviews: 15,
  completedSessions: 22,
  bio: 'Professional stylist with 8 years experience',
};

const mockUserFindById = jest.fn();
jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: mockUserFindById,
    updateById: jest.fn(),
  },
  findById: mockUserFindById,
  updateById: jest.fn(),
}));

const mockStylistFindByUserId = jest.fn();
jest.unstable_mockModule('../../src/modules/stylists/stylist.repository.js', () => ({
  default: {
    findByUserId: mockStylistFindByUserId,
  },
  findByUserId: mockStylistFindByUserId,
}));

const mockFindClientReviews = jest.fn();
jest.unstable_mockModule('../../src/modules/reviews/review.repository.js', () => ({
  default: {
    findClientReviews: mockFindClientReviews,
  },
  findClientReviews: mockFindClientReviews,
}));

const { default: app } = await import('../../src/app.js');

describe('User Public Profile & Mutual Discovery (Integration)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/users/:id', () => {
    it('allows a stylist to fetch a sanitized client profile without email or phone', async () => {
      mockUserFindById.mockResolvedValue(mockClientUser);

      const res = await request(app)
        .get(`/api/v1/users/${clientId}`)
        .set('Authorization', `Bearer ${stylistToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(clientId);
      expect(res.body.data.name).toBe('Layla Ahmed');
      expect(res.body.data.role).toBe('client');
      expect(res.body.data.completedBookings).toBe(5);
      expect(res.body.data.clientRating).toBe(4.9);
      expect(res.body.data.governorate).toBe('Cairo');

      // Zero-PII assertions
      expect(res.body.data.email).toBeUndefined();
      expect(res.body.data.phone).toBeUndefined();
      expect(res.body.data.verification).toBeUndefined();
    });

    it('allows a client to fetch a stylist public profile', async () => {
      mockUserFindById.mockResolvedValue(mockStylistUser);
      mockStylistFindByUserId.mockResolvedValue(mockStylistProfile);

      const res = await request(app)
        .get(`/api/v1/users/${stylistId}`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Ahmed Stylist');
      expect(res.body.data.specialty).toBe('Hair Styling');
      expect(res.body.data.hourlyPrice).toBe(350);

      // Zero-PII assertions
      expect(res.body.data.email).toBeUndefined();
      expect(res.body.data.phone).toBeUndefined();
    });

    it('returns 404 for non-existent user', async () => {
      mockUserFindById.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/users/60f719b8f1a2c81234567899')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/not found/i);
    });
  });

  describe('GET /api/v1/reviews/client/:id', () => {
    it('returns reviews written for a client by stylists', async () => {
      mockFindClientReviews.mockResolvedValue({
        items: [
          {
            _id: 'rev1',
            rating: 5,
            comment: 'Great client, very punctual and friendly!',
            raterId: { name: 'Ahmed Stylist', profileImage: null },
            createdAt: new Date(),
          },
        ],
        meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
      });

      const res = await request(app)
        .get(`/api/v1/reviews/client/${clientId}`)
        .set('Authorization', `Bearer ${stylistToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].rating).toBe(5);
    });
  });
});
