import { jest } from '@jest/globals';
import request from 'supertest';
import { DEFAULT_PROFILE_IMAGE_URL } from '../../src/common/constants/defaults.constant.js';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';

const mockUser = {
  _id: { toString: () => '60f719b8f1a2c81234567890' },
  name: 'Integration Client',
  email: 'client@test-phase2.com',
  role: 'client',
  profileImage: DEFAULT_PROFILE_IMAGE_URL,
  isEmailVerified: true,
  accountStatus: 'active',
  verification: { status: 'unverified', documents: [] },
  location: { type: 'Point', coordinates: [0, 0] },
  toObject: function () {
    return this;
  },
};

const mockFindById = jest.fn().mockResolvedValue(mockUser);
const mockUpdateById = jest.fn().mockResolvedValue(mockUser);
const mockSoftDelete = jest.fn().mockResolvedValue(mockUser);
const mockFindVerifications = jest.fn().mockResolvedValue({ users: [mockUser], meta: { total: 1 } });

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: mockFindById,
    updateById: mockUpdateById,
    softDelete: mockSoftDelete,
    findVerifications: mockFindVerifications,
  },
}));

const { default: app } = await import('../../src/app.js');

describe('Users & Verification Integration Tests', () => {
  const userId = '60f719b8f1a2c81234567890';
  const clientToken = generateAccessToken({ sub: userId, role: 'client' });
  const operatorToken = generateAccessToken({ sub: '60f719b8f1a2c81234567891', role: 'operator' });
  const adminToken = generateAccessToken({ sub: '60f719b8f1a2c81234567892', role: 'admin' });

  describe('GET /api/v1/users/me', () => {
    it('returns 401 when calling without access token', async () => {
      const res = await request(app).get('/api/v1/users/me');
      expect(res.statusCode).toBe(401);
    });

    it('returns user profile when authenticated', async () => {
      const res = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.profileImage).toBe(DEFAULT_PROFILE_IMAGE_URL);
      expect(res.body.data.verification.status).toBe('unverified');
    });
  });

  describe('PATCH /api/v1/users/me', () => {
    it('validates lat and lng boundaries', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ lat: 100, lng: 50 });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('Validation Error');
    });
  });

  describe('Admin & Operator Verification RBAC', () => {
    it('allows operator access to GET /api/v1/admin/verifications', async () => {
      const res = await request(app)
        .get('/api/v1/admin/verifications')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('denies operator access to unhandled admin routes (e.g. /api/v1/admin/users)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('denies client access to /api/v1/admin/verifications with 403', async () => {
      const res = await request(app)
        .get('/api/v1/admin/verifications')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.statusCode).toBe(403);
    });
  });
});
