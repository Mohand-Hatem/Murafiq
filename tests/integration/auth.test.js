import { jest } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { generateRefreshToken } from '../../src/common/utils/generateTokens.js';

const userId = '60f719b8f1a2c81234567890';
const rawRefreshToken = generateRefreshToken({ sub: userId, role: 'client' });

const mockUser = {
  _id: { toString: () => userId },
  name: 'Auth Integration User',
  email: 'auth@test.com',
  role: 'client',
  isEmailVerified: true,
  accountStatus: 'active',
  refreshTokenHash: await bcrypt.hash(rawRefreshToken, 4),
  toObject: function () {
    return this;
  },
  save: jest.fn().mockResolvedValue(true),
};

const mockFindById = jest.fn().mockResolvedValue(mockUser);
const mockFindByEmail = jest.fn().mockResolvedValue(mockUser);

jest.unstable_mockModule('../../src/modules/auth/auth.repository.js', () => ({
  default: {
    findById: mockFindById,
    findByEmail: mockFindByEmail,
    createUser: jest.fn(),
    findByGoogleId: jest.fn(),
  },
}));

const { default: app } = await import('../../src/app.js');

describe('Auth Integration — POST /api/v1/auth/refresh-token', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 200 with populated user and rotated tokens in body for mobile client', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh-token')
      .set('x-client-type', 'mobile')
      .send({ refreshToken: rawRefreshToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toBeDefined();
    expect(res.body.data.user.email).toBe('auth@test.com');
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
  });

  it('returns 200 with cookie delivery on web client', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh-token')
      .set('Cookie', [`refreshToken=${rawRefreshToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toBeDefined();
    expect(res.body.data.user.email).toBe('auth@test.com');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('returns 401 when no refresh token is provided', async () => {
    const res = await request(app).post('/api/v1/auth/refresh-token');
    expect(res.status).toBe(401);
  });

  it('returns 401 when an invalid refresh token is passed', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh-token')
      .set('x-client-type', 'mobile')
      .send({ refreshToken: 'invalid.token.here' });

    expect(res.status).toBe(401);
  });
});
