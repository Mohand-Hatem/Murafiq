import { jest } from '@jest/globals';
import request from 'supertest';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';

const mockStylistUser = {
  _id: '60f719b8f1a2c81234567890',
  name: 'Sara Stylist',
  email: 'sara@stylist.com',
  role: 'stylist',
  profileImage: 'http://example.com/sara.jpg',
  isEmailVerified: true,
  accountStatus: 'active',
  country: 'Egypt',
  governorate: 'Cairo',
  city: 'Cairo',
  area: 'Maadi',
  location: { type: 'Point', coordinates: [31.2357, 30.0444] },
  verification: { status: 'verified', documents: [] },
  toObject: function () {
    return this;
  },
};

const mockClientUser = {
  _id: '60f719b8f1a2c81234567891',
  name: 'John Client',
  email: 'john@client.com',
  role: 'client',
  isEmailVerified: true,
  accountStatus: 'active',
  toObject: function () {
    return this;
  },
};

const mockStylistProfile = {
  _id: '70f719b8f1a2c81234567890',
  userId: mockStylistUser,
  specialty: 'stylist',
  hourlyPrice: 200,
  bio: 'Cairo Fashion Expert',
  serviceDescription: 'Wardrobe audit and shopping assistance',
  experienceYears: 5,
  languages: ['Arabic', 'English'],
  services: ['Personal Shopping'],
  portfolio: ['http://example.com/portfolio.jpg'],
  workingAreas: ['Maadi', 'Zamalek'],
  weeklyAvailability: [{ day: 'mon', startTime: '10:00', endTime: '18:00' }],
  rating: 4.8,
  totalReviews: 12,
  completedSessions: 25,
  gender: 'female',
  country: 'Egypt',
  governorate: 'Cairo',
  city: 'Cairo',
  area: 'Maadi',
  location: { type: 'Point', coordinates: [31.2357, 30.0444] },
  locationSet: true,
  toObject: function () {
    return this;
  },
};

let profileStore = null;

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: jest.fn().mockImplementation((id) => {
      if (id === mockStylistUser._id) return Promise.resolve(mockStylistUser);
      if (id === mockClientUser._id) return Promise.resolve(mockClientUser);
      return Promise.resolve(null);
    }),
  },
}));

jest.unstable_mockModule('../../src/modules/stylists/stylist.repository.js', () => ({
  default: {
    findByUserId: jest.fn().mockImplementation((_userId) => Promise.resolve(profileStore)),
    findById: jest.fn().mockImplementation((id) => Promise.resolve(id === mockStylistProfile._id ? mockStylistProfile : null)),
    create: jest.fn().mockImplementation((data) => {
      profileStore = { ...mockStylistProfile, ...data };
      return Promise.resolve(profileStore);
    }),
    updateByUserId: jest.fn().mockImplementation((userId, data) => {
      profileStore = { ...mockStylistProfile, ...data };
      return Promise.resolve(profileStore);
    }),
  },
}));

jest.unstable_mockModule('../../src/modules/stylists/stylist-search.service.js', () => ({
  default: {
    searchStylists: jest.fn().mockResolvedValue({
      items: [
        {
          id: mockStylistProfile._id,
          name: mockStylistUser.name,
          hourlyPrice: mockStylistProfile.hourlyPrice,
          city: mockStylistProfile.city,
        },
      ],
      meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
    }),
  },
}));

const { default: app } = await import('../../src/app.js');

describe('Phase 3 Integration — Stylist Profiles & Search', () => {
  const stylistToken = generateAccessToken({ sub: mockStylistUser._id, role: mockStylistUser.role });
  const clientToken = generateAccessToken({ sub: mockClientUser._id, role: mockClientUser.role });

  beforeEach(() => {
    profileStore = null;
  });

  describe('POST /api/v1/stylists/profile', () => {
    it('should reject hourly rates below 100 EGP with a 400 error', async () => {
      const res = await request(app)
        .post('/api/v1/stylists/profile')
        .set('Authorization', `Bearer ${stylistToken}`)
        .send({
          specialty: 'stylist',
          hourlyPrice: 50,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should forbid clients from creating a stylist profile (403)', async () => {
      const res = await request(app)
        .post('/api/v1/stylists/profile')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          specialty: 'stylist',
          hourlyPrice: 150,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should allow a verified stylist to create a profile', async () => {
      const res = await request(app)
        .post('/api/v1/stylists/profile')
        .set('Authorization', `Bearer ${stylistToken}`)
        .send({
          specialty: 'stylist',
          hourlyPrice: 250,
          bio: 'Expert Cairo Personal Stylist',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hourlyPrice).toBe(250);
    });
  });

  describe('GET /api/v1/stylists', () => {
    it('should list verified stylists matching search criteria', async () => {
      const res = await request(app)
        .get('/api/v1/stylists')
        .query({ city: 'Cairo', specialty: 'stylist', minPrice: 100 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Sara Stylist');
    });
  });

  describe('GET /api/v1/stylists/:id', () => {
    it('should return public stylist profile by ID', async () => {
      const res = await request(app).get(`/api/v1/stylists/${mockStylistProfile._id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hourlyPrice).toBe(200);
      expect(res.body.data.name).toBe('Sara Stylist');
    });
  });
});
