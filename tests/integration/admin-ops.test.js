import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';

const adminId = '60f719b8f1a2c81234567899';
const operatorId = '60f719b8f1a2c81234567898';
const clientUserId = '60f719b8f1a2c81234567891';
const eventId = '60f719b8f1a2c81234567888';

const adminToken = generateAccessToken({ sub: adminId, role: 'admin' });
const operatorToken = generateAccessToken({ sub: operatorId, role: 'operator' });
const clientToken = generateAccessToken({ sub: clientUserId, role: 'client' });

const mockEvent = {
  _id: eventId,
  senderId: clientUserId,
  contentType: 'chat_message',
  severity: 'RESTRICT',
  actionTaken: 'BLOCKED',
  reviewOutcome: 'PENDING',
};

const mockUser = {
  _id: clientUserId,
  name: 'Client User',
  email: 'client@example.com',
  role: 'client',
  accountStatus: 'active',
  tokenVersion: 1,
};

const mockEventFindById = jest.fn();
const mockEventUpdateById = jest.fn();
const mockEventFindPaginated = jest.fn();

jest.unstable_mockModule('../../src/modules/moderation/moderation-event.repository.js', () => ({
  default: {
    findById: mockEventFindById,
    updateById: mockEventUpdateById,
    findPaginated: mockEventFindPaginated,
    create: jest.fn(),
  },
  findById: mockEventFindById,
  updateById: mockEventUpdateById,
  findPaginated: mockEventFindPaginated,
  create: jest.fn(),
}));

const mockUserFindById = jest.fn();
const mockUserUpdateById = jest.fn();

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: mockUserFindById,
    updateById: mockUserUpdateById,
    findAllUsers: jest.fn().mockResolvedValue({ users: [], meta: {} }),
  },
  findById: mockUserFindById,
  updateById: mockUserUpdateById,
  findAllUsers: jest.fn().mockResolvedValue({ users: [], meta: {} }),
}));

const mockLedgerFindEntries = jest.fn();
jest.unstable_mockModule('../../src/modules/ledger/ledger.repository.js', () => ({
  default: {
    findEntries: mockLedgerFindEntries,
    createEntry: jest.fn(),
  },
  findEntries: mockLedgerFindEntries,
  createEntry: jest.fn(),
}));

const mockReconcileLedger = jest.fn().mockResolvedValue({
  checkedBookings: 10,
  unbalancedCount: 0,
});
jest.unstable_mockModule('../../src/jobs/ledger-reconciliation.cron.js', () => ({
  reconcileLedger: mockReconcileLedger,
  startLedgerReconciliationCron: jest.fn(),
}));

const { default: app } = await import('../../src/app.js');

describe('Stage R11 Integration — Admin & Operations Controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindById.mockResolvedValue(mockUser);
    mockEventFindById.mockResolvedValue(mockEvent);
    mockEventFindPaginated.mockResolvedValue({
      items: [mockEvent],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    mockLedgerFindEntries.mockResolvedValue({
      items: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  describe('Moderation Events Queue & Review (Admin & Operator)', () => {
    it('allows Operator to query flagged moderation events', async () => {
      const res = await request(app)
        .get('/api/v1/admin/moderation/events')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });

    it('allows Operator to confirm a moderation event', async () => {
      mockEventUpdateById.mockResolvedValue({
        ...mockEvent,
        reviewOutcome: 'CONFIRMED',
        reviewedBy: operatorId,
      });

      const res = await request(app)
        .post(`/api/v1/admin/moderation/events/${eventId}/confirm`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ notes: 'Verified off-platform phone number' });

      expect(res.status).toBe(200);
      expect(res.body.data.reviewOutcome).toBe('CONFIRMED');
    });

    it('allows Operator to overturn a moderation event', async () => {
      mockEventUpdateById.mockResolvedValue({
        ...mockEvent,
        reviewOutcome: 'OVERTURNED',
        reviewedBy: operatorId,
      });

      const res = await request(app)
        .post(`/api/v1/admin/moderation/events/${eventId}/overturn`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ notes: 'False positive context' });

      expect(res.status).toBe(200);
      expect(res.body.data.reviewOutcome).toBe('OVERTURNED');
    });

    it('forbids Clients from accessing the moderation events queue', async () => {
      const res = await request(app)
        .get('/api/v1/admin/moderation/events')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('User Account Restrictions (Admin Only)', () => {
    it('allows Admin to restrict user with timeout', async () => {
      mockUserUpdateById.mockResolvedValue({
        ...mockUser,
        accountStatus: 'restricted',
        tokenVersion: 2,
        chatRestrictedUntil: new Date(),
      });

      const res = await request(app)
        .patch(`/api/v1/admin/users/${clientUserId}/restrict`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ durationDays: 14, reason: 'Repeated off-platform soliciting' });

      expect(res.status).toBe(200);
      expect(res.body.data.accountStatus).toBe('restricted');
    });

    it('allows Admin to unrestrict user and restore active status', async () => {
      mockUserUpdateById.mockResolvedValue({
        ...mockUser,
        accountStatus: 'active',
        chatRestrictedUntil: null,
      });

      const res = await request(app)
        .patch(`/api/v1/admin/users/${clientUserId}/unrestrict`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.accountStatus).toBe('active');
    });

    it('allows Admin to revoke user sessions', async () => {
      mockUserUpdateById.mockResolvedValue({
        ...mockUser,
        tokenVersion: 2,
      });

      const res = await request(app)
        .patch(`/api/v1/admin/users/${clientUserId}/revoke-sessions`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/sessions revoked/i);
    });

    it('forbids Operator from executing user restrictions', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/users/${clientUserId}/restrict`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ durationDays: 7 });

      expect(res.status).toBe(403);
    });
  });

  describe('Financial Ledger Explorer & Reconciliation (Admin Only)', () => {
    it('allows Admin to query ledger statements', async () => {
      const res = await request(app)
        .get('/api/v1/admin/ledger/statements')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('allows Admin to trigger on-demand ledger reconciliation', async () => {
      const res = await request(app)
        .get('/api/v1/admin/ledger/reconciliation')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });
  });
});
