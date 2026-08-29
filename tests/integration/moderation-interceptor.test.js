import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';

const adminId = '60f719b8f1a2c81234567899';
const clientId = '60f719b8f1a2c81234567891';
const domainId = '60f719b8f1a2c81234567866';
const violationId = '60f719b8f1a2c81234567855';

const adminToken = generateAccessToken({ sub: adminId, role: 'admin' });
const clientToken = generateAccessToken({ sub: clientId, role: 'client' });

const mockEventDoc = {
  _id: '60f719b8f1a2c81234567844',
  conversationId: 'conv-123',
  senderId: { _id: clientId, name: 'Client User', email: 'c@test.com', role: 'client' },
  messageSnippet: 'Call me 01012345678',
  matchedLayer: 'REGEX_CONTACT',
  matchedRule: 'EGYPTIAN_PHONE_NUMBER',
  severity: 'MEDIUM',
  actionTaken: 'OBSERVED',
  reviewStatus: 'PENDING',
  createdAt: new Date(),
};

const mockBlockedDomainDoc = {
  _id: domainId,
  domain: 'phishingsite.com',
  category: 'external_communication',
  isActive: true,
};

jest.unstable_mockModule('../../src/modules/moderation/moderation-event.repository.js', () => ({
  default: {
    findPaginated: jest.fn().mockResolvedValue({
      items: [mockEventDoc],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    }),
    create: jest.fn().mockResolvedValue(mockEventDoc),
  },
}));

jest.unstable_mockModule('../../src/modules/moderation/blocked-domain.repository.js', () => ({
  default: {
    findAllActive: jest.fn().mockResolvedValue([mockBlockedDomainDoc]),
    findAllActiveDomains: jest.fn().mockResolvedValue(['phishingsite.com']),
    create: jest.fn().mockResolvedValue(mockBlockedDomainDoc),
    deleteById: jest.fn().mockResolvedValue(mockBlockedDomainDoc),
  },
}));

jest.unstable_mockModule('../../src/modules/moderation/policy-violation.repository.js', () => ({
  default: {
    findById: jest.fn().mockResolvedValue({ _id: violationId, status: 'ACTIVE' }),
    updateById: jest.fn().mockResolvedValue({ _id: violationId, status: 'RESOLVED' }),
    countActiveByUserId: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockResolvedValue({ _id: 'pv-1' }),
  },
}));

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: jest.fn().mockImplementation((id) =>
      Promise.resolve({
        _id: id,
        role: id === adminId ? 'admin' : 'client',
        verification: { status: 'verified' },
      })
    ),
    updateById: jest.fn().mockResolvedValue({}),
  },
}));

const { default: app } = await import('../../src/app.js');

describe('Stage R7 Integration — Moderation Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/admin/moderation/events', () => {
    it('allows admin to list flagged moderation events', async () => {
      const res = await request(app)
        .get('/api/v1/admin/moderation/events')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });

    it('blocks non-admin users with 403', async () => {
      const res = await request(app)
        .get('/api/v1/admin/moderation/events')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/v1/admin/moderation/blocked-domains', () => {
    it('allows admin to add a domain to the blocklist', async () => {
      const res = await request(app)
        .post('/api/v1/admin/moderation/blocked-domains')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          domain: 'phishingsite.com',
          category: 'external_communication',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.domain).toBe('phishingsite.com');
    });
  });

  describe('DELETE /api/v1/admin/moderation/blocked-domains/:id', () => {
    it('allows admin to delete a domain from the blocklist', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/moderation/blocked-domains/${domainId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('PATCH /api/v1/admin/moderation/violations/:id/forgive', () => {
    it('allows admin to forgive a user policy violation strike', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/moderation/violations/${violationId}/forgive`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
