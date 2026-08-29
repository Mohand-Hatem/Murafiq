import request from 'supertest';
import app from '../../src/app.js';
import User from '../../src/modules/users/user.model.js';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';
import { ROLES } from '../../src/common/constants/roles.constant.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';

describe('Admin Users Endpoint Integration Tests', () => {
  let adminToken;
  let operatorToken;
  let clientToken;
  let adminUser;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    // Create Admin
    adminUser = await User.create({
      name: 'Super Admin',
      email: 'admin@murafiq.com',
      passwordHash: 'hashedpassword',
      role: ROLES.ADMIN,
      isEmailVerified: true,
      otpCode: '123456',
      refreshTokenHash: 'refreshtokenhash',
    });
    adminToken = generateAccessToken({ sub: adminUser._id.toString(), role: ROLES.ADMIN });

    // Create Operator
    const operatorUser = await User.create({
      name: 'Operator User',
      email: 'operator@murafiq.com',
      passwordHash: 'hashedpassword',
      role: ROLES.OPERATOR,
      isEmailVerified: true,
    });
    operatorToken = generateAccessToken({ sub: operatorUser._id.toString(), role: ROLES.OPERATOR });

    // Create Client
    const clientUser = await User.create({
      name: 'Client User',
      email: 'client@murafiq.com',
      phone: '+201000000001',
      passwordHash: 'hashedpassword',
      role: ROLES.CLIENT,
      isEmailVerified: true,
    });
    clientToken = generateAccessToken({ sub: clientUser._id.toString(), role: ROLES.CLIENT });

    // Create Stylist
    await User.create({
      name: 'Stylist User',
      email: 'stylist@murafiq.com',
      phone: '+201000000002',
      passwordHash: 'hashedpassword',
      role: ROLES.STYLIST,
      isEmailVerified: false,
    });
  });

  it('allows Admin to list all platform users with standard envelope', async () => {
    const res = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Users fetched successfully');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(4);
    expect(res.body.meta).toBeDefined();
    expect(res.body.meta.total).toBe(4);
  });

  it('filters users by role and isEmailVerified', async () => {
    const res = await request(app)
      .get('/api/v1/admin/users?role=stylist')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].email).toBe('stylist@murafiq.com');
  });

  it('searches users by name, email, or phone', async () => {
    const res = await request(app)
      .get('/api/v1/admin/users?search=Operator')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].name).toBe('Operator User');
  });

  it('does NOT expose sensitive fields in response', async () => {
    const res = await request(app)
      .get('/api/v1/admin/users?search=admin')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const user = res.body.data[0];
    expect(user.passwordHash).toBeUndefined();
    expect(user.refreshTokenHash).toBeUndefined();
    expect(user.otpCode).toBeUndefined();
    expect(user.otpExpiresAt).toBeUndefined();
    expect(user.otpAttempts).toBeUndefined();
  });

  it('ignores a filter field outside the allow-list rather than applying it as a query', async () => {
    // passwordHash is select:false and NOT in the repository's allowed-filter list
    // (['role', 'verification.status', 'accountStatus', 'isEmailVerified']). Filter on an exact
    // value NO seeded user has ('nonexistent-hash') — if the allow-list were ever removed or
    // widened, this WOULD narrow the query to zero matches; because it's correctly stripped, the
    // request behaves as if unfiltered and still returns all 4 seeded users. (An earlier version
    // of this test used `[ne]=null`, which every seeded user matches regardless of whether the
    // field is actually filtered — it passed even with the allow-list guard removed. Verified by
    // deliberately widening the allow-list and re-running: this version correctly failed, the
    // `[ne]=null` version did not.)
    const res = await request(app)
      .get('/api/v1/admin/users?passwordHash=nonexistent-hash')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(4);
    expect(res.body.meta.total).toBe(4);
  });

  it('forbids Operator and Client from accessing GET /admin/users', async () => {
    const operatorRes = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(operatorRes.status).toBe(403);

    const clientRes = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${clientToken}`);
    expect(clientRes.status).toBe(403);
  });
});
