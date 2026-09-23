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
  priceEgp: 250,
  priceYearlyEgp: 2842,
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
    'ai.messages.lifetime': 10,
    'wardrobe.photos.max': 7,
  },
  isActive: true,
};

const mockFindActiveByUserId = jest.fn().mockResolvedValue(mockSubscription);
const mockCreateSubscription = jest.fn().mockResolvedValue(mockSubscription);
const mockUpdateSubscriptionById = jest.fn().mockImplementation((id, data) =>
  Promise.resolve({ ...mockSubscription, ...data })
);
const mockReplaceActivePlanCAS = jest.fn().mockImplementation((id, data) =>
  Promise.resolve({ ...mockSubscription, ...data, _id: id })
);
const mockCreateHistoryEntry = jest.fn().mockResolvedValue({});
const mockFindOrCreateActiveSubscription = jest.fn().mockResolvedValue(mockSubscription);
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
    findOrCreateActiveSubscription: mockFindOrCreateActiveSubscription,
    findByUserId: mockFindActiveByUserId,
    createSubscription: mockCreateSubscription,
    updateById: mockUpdateSubscriptionById,
    replaceActivePlanCAS: mockReplaceActivePlanCAS,
    createHistoryEntry: mockCreateHistoryEntry,
    findExpiringSubscriptions: jest.fn().mockResolvedValue([]),
  },
  findActiveByUserId: mockFindActiveByUserId,
  findOrCreateActiveSubscription: mockFindOrCreateActiveSubscription,
  findByUserId: mockFindActiveByUserId,
  createSubscription: mockCreateSubscription,
  updateById: mockUpdateSubscriptionById,
  replaceActivePlanCAS: mockReplaceActivePlanCAS,
  createHistoryEntry: mockCreateHistoryEntry,
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

jest.unstable_mockModule('../../src/modules/wardrobe/wardrobe-item.model.js', () => ({
  default: {
    countDocuments: jest.fn().mockResolvedValue(0),
  },
  WARDROBE_CATEGORIES: ['top', 'bottom', 'shoes', 'outerwear', 'accessory', 'dress'],
  WARDROBE_PATTERNS: ['solid', 'striped', 'plaid', 'floral', 'graphic', 'checkered', 'polka_dot', 'animal_print', 'other'],
  WARDROBE_FORMALITIES: ['casual', 'smart_casual', 'business', 'formal', 'loungewear', 'sportswear'],
  WARDROBE_SEASONS: ['spring', 'summer', 'fall', 'winter', 'all_season'],
  WARDROBE_MATERIALS: ['cotton', 'denim', 'leather', 'wool', 'silk', 'linen', 'synthetic', 'knitwear', 'other'],
  WARDROBE_FITS: ['slim', 'regular', 'relaxed', 'oversized'],
  WARDROBE_COLOR_FAMILIES: ['black', 'white', 'grey', 'navy', 'blue', 'brown', 'beige', 'green', 'red', 'pink', 'purple', 'yellow', 'orange', 'metallic', 'multicolor'],
  WARDROBE_GENDER_PRESENTATIONS: ['masculine', 'feminine', 'unisex'],
  WARDROBE_ORIGINS: ['upload', 'chat_save'],
  CLASSIFICATION_STATUS: { PENDING: 'pending', DONE: 'done', FAILED: 'failed', NEEDS_REVIEW: 'needs_review' },
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
    // This suite previously asserted that an authenticated user could POST themselves a paid
    // plan and receive 200 — i.e. it encoded the vulnerability as the specification. The
    // route collects no money, so a priced plan must be refused and the caller sent to
    // /checkout. Nothing may be written to the subscription row on the way out.
    it('refuses to grant a PAID plan — no payment is collected on this route', async () => {
      const res = await request(app)
        .post('/api/v1/subscriptions/subscribe')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          planCode: 'client.pro',
          billingCycle: 'monthly',
        });

      expect(res.status).toBe(402);
      expect(res.body.message).toMatch(/requires payment/i);
      expect(mockUpdateSubscriptionById).not.toHaveBeenCalled();
      expect(mockReplaceActivePlanCAS).not.toHaveBeenCalled();
    });

    it('refuses a paid YEARLY plan too', async () => {
      const res = await request(app)
        .post('/api/v1/subscriptions/subscribe')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          planCode: 'client.pro',
          billingCycle: 'yearly',
        });

      expect(res.status).toBe(402);
      expect(mockUpdateSubscriptionById).not.toHaveBeenCalled();
      expect(mockReplaceActivePlanCAS).not.toHaveBeenCalled();
    });

    it('rejects an unknown field — .strict() is now actually enforced', async () => {
      // Every validator in this module used to be exported bare, which made validate() a
      // no-op: .strict() never ran and a client could smuggle in extra fields.
      const res = await request(app)
        .post('/api/v1/subscriptions/subscribe')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          planCode: 'client.free',
          paymobSubscriptionId: 'attacker-supplied-reference',
        });

      expect(res.status).toBe(400);
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
