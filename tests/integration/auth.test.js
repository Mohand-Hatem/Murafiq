import { jest } from '@jest/globals';
import request from 'supertest';

const userId = '60f719b8f1a2c81234567890';

const mockUser = {
  _id: { toString: () => userId },
  name: 'Auth Integration User',
  email: 'auth@test.com',
  role: 'client',
  isEmailVerified: true,
  accountStatus: 'active',
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

  // NOTE: the refresh HAPPY PATHS deliberately live in tests/integration/auth.sessions.test.js
  // against a real MongoDB replica set and the real User schema — not here.
  //
  // This suite mocks `auth.repository`, and a mocked repository is exactly how a completely
  // broken refresh flow once shipped with a green test run: the mock returned a fake user
  // carrying a `refreshTokenHash` field that did not exist on the schema at all, so nothing
  // ever exercised persistence. Only the negative cases below — which fail before touching
  // the database — are meaningful with mocks.

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
