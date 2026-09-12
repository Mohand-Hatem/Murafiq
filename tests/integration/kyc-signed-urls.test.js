import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import User from '../../src/modules/users/user.model.js';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';
import { ROLES } from '../../src/common/constants/roles.constant.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';

describe('KYC Signed URLs for Reviewers (Task B7 / S4.4)', () => {
  let adminToken;
  let operatorToken;
  let clientToken;
  let clientUser;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    const admin = await User.create({
      name: 'Admin Reviewer',
      email: 'admin@murafiq.com',
      passwordHash: 'hash',
      role: ROLES.ADMIN,
      isEmailVerified: true,
    });
    adminToken = generateAccessToken({ sub: admin._id.toString(), role: ROLES.ADMIN });

    const operator = await User.create({
      name: 'Operator Reviewer',
      email: 'operator@murafiq.com',
      passwordHash: 'hash',
      role: ROLES.OPERATOR,
      isEmailVerified: true,
    });
    operatorToken = generateAccessToken({ sub: operator._id.toString(), role: ROLES.OPERATOR });

    clientUser = await User.create({
      name: 'Client User',
      email: 'client@murafiq.com',
      passwordHash: 'hash',
      role: ROLES.CLIENT,
      isEmailVerified: true,
      verification: {
        status: 'pending',
        documents: [
          {
            type: 'national_id_front',
            url: 'murafiq/kyc-documents/client_nid_front_123',
            documentRef: 'murafiq/kyc-documents/client_nid_front_123',
            uploadedAt: new Date(),
          },
          {
            type: 'national_id_back',
            url: 'murafiq/kyc-documents/client_nid_back_123',
            documentRef: 'murafiq/kyc-documents/client_nid_back_123',
            uploadedAt: new Date(),
          },
          {
            type: 'selfie_with_id',
            url: 'murafiq/kyc-documents/client_selfie_123',
            documentRef: 'murafiq/kyc-documents/client_selfie_123',
            uploadedAt: new Date(),
          },
        ],
      },
    });
    clientToken = generateAccessToken({ sub: clientUser._id.toString(), role: ROLES.CLIENT });
  });

  it('returns a signed, fetchable URL to an Admin reviewer on GET /admin/verifications', async () => {
    const res = await request(app)
      .get('/api/v1/admin/verifications')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    const doc = res.body.data[0].verification.documents[0];
    expect(doc.url).toMatch(/^https:\/\/res\.cloudinary\.com\/.*(signature=|s--)/);
  });

  it('returns a signed, fetchable URL to an Operator reviewer on GET /admin/verifications', async () => {
    const res = await request(app)
      .get('/api/v1/admin/verifications')
      .set('Authorization', `Bearer ${operatorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    const doc = res.body.data[0].verification.documents[0];
    expect(doc.url).toMatch(/^https:\/\/res\.cloudinary\.com\/.*(signature=|s--)/);
  });

  it('does not sign documents for the owner reading their own profile on GET /users/me', async () => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${clientToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const doc = res.body.data.verification.documents[0];
    expect(doc.url).not.toMatch(/signature=/);
    expect(doc.url).not.toMatch(/s--/);
    expect(doc.url).toBe('murafiq/kyc-documents/client_nid_front_123');
  });
});
