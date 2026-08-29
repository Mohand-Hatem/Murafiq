import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';

const clientId = '60f719b8f1a2c81234567891';
const clientToken = generateAccessToken({ sub: clientId, role: 'client' });

const mockSubscription = {
  _id: '60f719b8f1a2c81234567877',
  userId: clientId,
  planCode: 'client.free',
  role: 'client',
  billingCycle: 'monthly',
  status: 'active',
  currentPeriodStart: new Date(),
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

const mockProPlan = {
  _id: '60f719b8f1a2c81234567866',
  code: 'client.pro',
  name: 'Client Pro',
  role: 'client',
  tier: 'pro',
  billingCycle: 'monthly',
  priceEgp: 250,
  priceUsdDisplay: 5,
  entitlements: {
    'requests.daily': 4,
    'requests.active': 4,
    'ai.messages.daily': 80,
    'wardrobe.photos.max': 100,
  },
  isActive: true,
};

const mockFreePlan = {
  _id: '60f719b8f1a2c81234567855',
  code: 'client.free',
  name: 'Client Free',
  role: 'client',
  tier: 'free',
  billingCycle: 'monthly',
  priceEgp: 0,
  priceUsdDisplay: 0,
  entitlements: {
    'requests.daily': 1,
    'requests.active': 1,
    'ai.messages.daily': 3,
    'wardrobe.photos.max': 7,
  },
  isActive: true,
};

const mockFindActiveByUserId = jest.fn().mockResolvedValue(mockSubscription);
const mockCreateSubscription = jest.fn().mockResolvedValue(mockSubscription);
const mockUpdateSubscriptionById = jest.fn().mockImplementation((id, data) =>
  Promise.resolve({ ...mockSubscription, ...data })
);
const mockFindByCode = jest.fn().mockImplementation((code) => {
  if (code === 'client.pro') return Promise.resolve(mockProPlan);
  return Promise.resolve(mockFreePlan);
});
const mockFindActiveByRole = jest.fn().mockResolvedValue([mockFreePlan, mockProPlan]);
const mockFindAllActive = jest.fn().mockResolvedValue([mockFreePlan, mockProPlan]);

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: jest.fn().mockResolvedValue({
      _id: clientId,
      name: 'Test Client',
      email: 'client@example.com',
      role: 'client',
    }),
  },
}));

jest.unstable_mockModule('../../src/modules/subscriptions/subscription.repository.js', () => ({
  default: {
    findActiveByUserId: mockFindActiveByUserId,
    findByUserId: mockFindActiveByUserId,
    createSubscription: mockCreateSubscription,
    updateById: mockUpdateSubscriptionById,
    findExpiringSubscriptions: jest.fn().mockResolvedValue([]),
  },
  findActiveByUserId: mockFindActiveByUserId,
  findByUserId: mockFindActiveByUserId,
  createSubscription: mockCreateSubscription,
  updateById: mockUpdateSubscriptionById,
  findExpiringSubscriptions: jest.fn().mockResolvedValue([]),
}));

jest.unstable_mockModule('../../src/modules/subscriptions/plan.repository.js', () => ({
  default: {
    findByCode: mockFindByCode,
    findActiveByRole: mockFindActiveByRole,
    findAllActive: mockFindAllActive,
    upsertPlan: jest.fn(),
    seedPlans: jest.fn(),
  },
  findByCode: mockFindByCode,
  findActiveByRole: mockFindActiveByRole,
  findAllActive: mockFindAllActive,
}));

jest.unstable_mockModule('../../src/modules/subscriptions/usage-counter.model.js', () => ({
  default: {
    find: jest.fn().mockResolvedValue([]),
    findOneAndUpdate: jest.fn().mockResolvedValue({ used: 0 }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  },
}));

jest.unstable_mockModule('../../src/modules/requests/request.model.js', () => ({
  default: {
    countDocuments: jest.fn().mockResolvedValue(0),
  },
}));

jest.unstable_mockModule('../../src/modules/offers/offer.model.js', () => ({
  default: {
    countDocuments: jest.fn().mockResolvedValue(0),
  },
}));

jest.unstable_mockModule('../../src/modules/ledger/ledger.service.js', () => ({
  default: {
    postEntry: jest.fn().mockResolvedValue({}),
    egpToPiastres: (egp) => Math.round(egp * 100),
    piastresToEgp: (piastres) => piastres / 100,
  },
  postEntry: jest.fn().mockResolvedValue({}),
  egpToPiastres: (egp) => Math.round(egp * 100),
  piastresToEgp: (piastres) => piastres / 100,
}));

const { default: app } = await import('../../src/app.js');

describe('Stage R3 Integration — Subscriptions Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/subscriptions/plans', () => {
    it('returns public list of active subscription plans', async () => {
      const res = await request(app).get('/api/v1/subscriptions/plans');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.plans)).toBe(true);
      expect(res.body.data.plans.length).toBe(2);
    });

    it('filters plans by role when query param provided', async () => {
      const res = await request(app).get('/api/v1/subscriptions/plans?role=client');

      expect(res.status).toBe(200);
      expect(mockFindActiveByRole).toHaveBeenCalledWith('client');
    });
  });

  describe('GET /api/v1/subscriptions/me', () => {
    it('returns 401 when calling without authorization token', async () => {
      const res = await request(app).get('/api/v1/subscriptions/me');
      expect(res.status).toBe(401);
    });

    it('returns subscription status and entitlements when authenticated', async () => {
      const res = await request(app)
        .get('/api/v1/subscriptions/me')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.subscription.planCode).toBe('client.free');
      expect(res.body.data.entitlements['requests.daily']).toBe(1);
    });
  });

  describe('GET /api/v1/subscriptions/me/entitlements', () => {
    it('returns flat entitlements map for authenticated user', async () => {
      const res = await request(app)
        .get('/api/v1/subscriptions/me/entitlements')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.planCode).toBe('client.free');
      expect(res.body.data.tier).toBe('free');
    });
  });

  describe('POST /api/v1/subscriptions/subscribe', () => {
    it('successfully upgrades to a new plan tier', async () => {
      const res = await request(app)
        .post('/api/v1/subscriptions/subscribe')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          planCode: 'client.pro',
          billingCycle: 'monthly',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockUpdateSubscriptionById).toHaveBeenCalledWith(
        mockSubscription._id,
        expect.objectContaining({
          planCode: 'client.pro',
          status: 'active',
        })
      );
    });
  });

  describe('POST /api/v1/subscriptions/cancel', () => {
    it('returns 400 when attempting to cancel a free subscription', async () => {
      mockFindActiveByUserId.mockResolvedValueOnce({
        _id: '60f719b8f1a2c81234567877',
        planCode: 'client.free',
      });

      const res = await request(app)
        .post('/api/v1/subscriptions/cancel')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Free plan cannot be cancelled/i);
    });

    it('schedules cancellation at period end for paid subscription', async () => {
      mockFindActiveByUserId.mockResolvedValueOnce({
        _id: '60f719b8f1a2c81234567877',
        planCode: 'client.pro',
        cancelAtPeriodEnd: false,
      });

      const res = await request(app)
        .post('/api/v1/subscriptions/cancel')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockUpdateSubscriptionById).toHaveBeenCalledWith(
        '60f719b8f1a2c81234567877',
        expect.objectContaining({
          cancelAtPeriodEnd: true,
        })
      );
    });
  });
});
