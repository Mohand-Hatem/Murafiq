import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';

const fakeSession = {
  withTransaction: jest.fn(async (cb) => cb()),
  endSession: jest.fn(async () => {}),
};

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
  priceYearlyEgp: 2900,
  priceUsdDisplay: 5,
  priceUsdYearlyDisplay: 58,
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
  priceEgp: 0,
  priceYearlyEgp: null,
  priceUsdDisplay: 0,
  entitlements: {
    'requests.daily': 1,
    'requests.active': 1,
  },
  isActive: true,
};

const mockStylistPlan = {
  _id: '60f719b8f1a2c81234567844',
  code: 'stylist.pro',
  name: 'Stylist Pro',
  role: 'stylist',
  tier: 'pro',
  priceEgp: 300,
  priceYearlyEgp: 3600,
  isActive: true,
};

let mockOrderStore = {};

const mockCreateOrder = jest.fn().mockImplementation((orderData) => {
  const order = { ...orderData, _id: orderData._id || '60f719b8f1a2c81234567811', status: 'pending' };
  mockOrderStore[order.specialReference] = order;
  return Promise.resolve(order);
});

const mockFindBySpecialReference = jest.fn().mockImplementation((ref) => {
  return Promise.resolve(mockOrderStore[ref] || null);
});

const mockFindByTransactionId = jest.fn().mockImplementation((txId) => {
  const order = Object.values(mockOrderStore).find((o) => o.providerTransactionId === txId);
  return Promise.resolve(order || null);
});

const mockFindOrderById = jest.fn().mockImplementation((id) => {
  const order = Object.values(mockOrderStore).find((o) => String(o._id) === String(id));
  return Promise.resolve(order || null);
});

const mockUpdateOrderById = jest.fn().mockImplementation((id, data) => {
  for (const key of Object.keys(mockOrderStore)) {
    if (mockOrderStore[key]._id === id || String(mockOrderStore[key]._id) === String(id)) {
      mockOrderStore[key] = { ...mockOrderStore[key], ...data };
      return Promise.resolve(mockOrderStore[key]);
    }
  }
  return Promise.resolve({ _id: id, ...data });
});

// CAS mock mirroring subscriptionOrderRepository.transitionStatus's real semantics
// (see docs/AUDIT_2026_09_FULL_SYSTEM.md finding X5): only writes -- and only returns
// non-null -- when the in-memory order's current status matches `fromStatus`.
const mockTransitionOrderStatus = jest.fn().mockImplementation((id, fromStatus, data) => {
  for (const key of Object.keys(mockOrderStore)) {
    if (mockOrderStore[key]._id === id || String(mockOrderStore[key]._id) === String(id)) {
      if (mockOrderStore[key].status !== fromStatus) {
        return Promise.resolve(null);
      }
      mockOrderStore[key] = { ...mockOrderStore[key], ...data };
      return Promise.resolve(mockOrderStore[key]);
    }
  }
  return Promise.resolve(null);
});

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
  if (code === 'client.free') return Promise.resolve(mockFreePlan);
  if (code === 'stylist.pro') return Promise.resolve(mockStylistPlan);
  return Promise.resolve(null);
});

jest.unstable_mockModule('../../src/modules/subscriptions/subscription-order.repository.js', () => ({
  default: {
    createOrder: mockCreateOrder,
    findById: mockFindOrderById,
    findBySpecialReference: mockFindBySpecialReference,
    findByTransactionId: mockFindByTransactionId,
    updateById: mockUpdateOrderById,
    transitionStatus: mockTransitionOrderStatus,
  },
  createOrder: mockCreateOrder,
  findById: mockFindOrderById,
  findBySpecialReference: mockFindBySpecialReference,
  findByTransactionId: mockFindByTransactionId,
  updateById: mockUpdateOrderById,
  transitionStatus: mockTransitionOrderStatus,
}));

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: jest.fn().mockResolvedValue({
      _id: clientId,
      name: 'Test Client',
      email: 'client@example.com',
      phone: '+201012345678',
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
  },
  findActiveByUserId: mockFindActiveByUserId,
  findOrCreateActiveSubscription: mockFindOrCreateActiveSubscription,
  findByUserId: mockFindActiveByUserId,
  createSubscription: mockCreateSubscription,
  updateById: mockUpdateSubscriptionById,
  replaceActivePlanCAS: mockReplaceActivePlanCAS,
  createHistoryEntry: mockCreateHistoryEntry,
}));

jest.unstable_mockModule('../../src/modules/subscriptions/plan.repository.js', () => ({
  default: {
    findByCode: mockFindByCode,
    findActiveByRole: jest.fn().mockResolvedValue([mockFreePlan, mockProPlan]),
    findAllActive: jest.fn().mockResolvedValue([mockFreePlan, mockProPlan]),
  },
  findByCode: mockFindByCode,
}));

const mockPostEntry = jest.fn().mockResolvedValue({});
const mockEgpToPiastres = jest.fn().mockImplementation((egp) => Math.round(egp * 100));
const mockPiastresToEgp = jest.fn().mockImplementation((p) => p / 100);

jest.unstable_mockModule('../../src/modules/ledger/ledger.service.js', () => ({
  default: {
    postEntry: mockPostEntry,
    postDoubleEntry: mockPostEntry,
    egpToPiastres: mockEgpToPiastres,
    piastresToEgp: mockPiastresToEgp,
  },
  postEntry: mockPostEntry,
  postDoubleEntry: mockPostEntry,
  egpToPiastres: mockEgpToPiastres,
  piastresToEgp: mockPiastresToEgp,
}));

const { default: app } = await import('../../src/app.js');

describe('Subscription Checkout & Webhook Integration Tests', () => {
  beforeEach(() => {
    mockOrderStore = {};
    jest.clearAllMocks();
    fakeSession.withTransaction.mockImplementation(async (cb) => cb());
    fakeSession.endSession.mockResolvedValue();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(fakeSession);
  });

  describe('POST /api/v1/subscriptions/checkout', () => {
    it('returns 404 when plan does not exist', async () => {
      const res = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ planCode: 'nonexistent.plan' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not found/i);
    });

    it('returns 403 when user role does not match plan role', async () => {
      const res = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ planCode: 'stylist.pro' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/only available for stylists/i);
    });

    it('returns 400 when attempting checkout on a free plan', async () => {
      const res = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ planCode: 'client.free' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Free plan does not require payment checkout/i);
    });

    it('successfully initiates checkout for client.pro and returns paymentUrl', async () => {
      const res = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          planCode: 'client.pro',
          billingCycle: 'monthly',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('paymentUrl');
      expect(res.body.data).toHaveProperty('orderId');
      expect(res.body.data).toHaveProperty('specialReference');
      expect(res.body.data.amountEgp).toBe(250);
      expect(res.body.data.specialReference).toMatch(/^subord_/);

      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: clientId,
          planCode: 'client.pro',
          amountEgp: 250,
          status: 'pending',
        })
      );
    });
  });

  describe('POST /api/v1/subscriptions/webhook', () => {
    it('returns 400 when mock webhook secret is missing or invalid', async () => {
      const res = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .send({
          secret: 'wrong-secret',
          special_reference: 'subord_123',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('processes successful payment, activates subscription, and updates order status to paid', async () => {
      // First create the checkout order
      const checkoutRes = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ planCode: 'client.pro' });

      const specialReference = checkoutRes.body.data.specialReference;
      expect(specialReference).toBeDefined();

      // Now send webhook callback simulating payment success
      const webhookRes = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .send({
          secret: 'dev_mock_webhook_secret',
          special_reference: specialReference,
          status: 'paid',
          transactionId: 'tx_paymob_12345',
        });

      expect(webhookRes.status).toBe(200);
      expect(webhookRes.body.success).toBe(true);
      // The webhook response is a bare acknowledgement. It deliberately no longer echoes the
      // order, whose rawCallbackData carries the provider's masked PAN and source_data.
      expect(webhookRes.body.data.status).toBe('paid');
      expect(webhookRes.body.data.received).toBe(true);
      expect(webhookRes.body.data.order).toBeUndefined();

      // Verify subscription updated. The grant now lands via replaceActivePlanCAS -- a
      // compare-and-swap keyed on status:'active' -- rather than a bare updateById, so a
      // concurrent webhook redelivery cannot write a second active row.
      expect(mockReplaceActivePlanCAS).toHaveBeenCalledWith(
        mockSubscription._id,
        expect.objectContaining({
          planCode: 'client.pro',
          status: 'active',
          source: 'paid',
        }),
        fakeSession
      );

      // The plan it replaced is snapshotted before being overwritten.
      expect(mockCreateHistoryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          changeType: 'paid',
          newPlanCode: 'client.pro',
          previousPlanCode: mockSubscription.planCode,
        }),
        fakeSession
      );
    });

    // Regression test for docs/AUDIT_2026_09_FULL_SYSTEM.md finding X5: the order used
    // to be marked 'paid' BEFORE the grant was applied, so a grant failure left the
    // customer charged with no entitlement, and a provider retry of the same webhook hit
    // the `status === 'paid'` early-return and never tried the grant again.
    it('leaves the order retryable (not paid) when applying the plan grant fails, and a retry succeeds', async () => {
      const checkoutRes = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ planCode: 'client.pro' });
      const specialReference = checkoutRes.body.data.specialReference;

      // Simulate the grant itself failing (e.g. a lost CAS inside applyPlanGrant) on the
      // FIRST delivery only.
      mockReplaceActivePlanCAS.mockRejectedValueOnce(new Error('Simulated grant failure'));

      const firstAttempt = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .send({
          secret: 'dev_mock_webhook_secret',
          special_reference: specialReference,
          status: 'paid',
          transactionId: 'tx_paymob_retry_1',
        });

      // The webhook responds with an error (prompting the provider's own retry), and the
      // order must NOT be left 'paid' with no entitlement granted.
      expect(firstAttempt.status).toBeGreaterThanOrEqual(400);
      const orderAfterFailure = mockOrderStore[specialReference];
      expect(orderAfterFailure.status).toBe('pending');

      // The provider retries the exact same webhook. This time the grant succeeds.
      const retryAttempt = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .send({
          secret: 'dev_mock_webhook_secret',
          special_reference: specialReference,
          status: 'paid',
          transactionId: 'tx_paymob_retry_1',
        });

      expect(retryAttempt.status).toBe(200);
      expect(mockOrderStore[specialReference].status).toBe('paid');
      // The grant was actually attempted a second time -- once for the failed delivery,
      // once for the successful retry.
      expect(mockReplaceActivePlanCAS).toHaveBeenCalledTimes(2);
    });

    it('returns idempotent response if webhook is re-delivered for an already paid order', async () => {
      const checkoutRes = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ planCode: 'client.pro' });

      const specialReference = checkoutRes.body.data.specialReference;

      // First webhook call
      await request(app)
        .post('/api/v1/subscriptions/webhook')
        .send({
          secret: 'dev_mock_webhook_secret',
          special_reference: specialReference,
          status: 'paid',
        });

      // Duplicate webhook call
      const duplicateRes = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .send({
          secret: 'dev_mock_webhook_secret',
          special_reference: specialReference,
          status: 'paid',
        });

      expect(duplicateRes.status).toBe(200);
      expect(duplicateRes.body.data.alreadyProcessed).toBe(true);
    });
  });

  describe('Defense-in-depth: POST /api/v1/payments/callback for subscription', () => {
    it('delegates subord_ special references to subscription webhook handler', async () => {
      const checkoutRes = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ planCode: 'client.pro' });

      const specialReference = checkoutRes.body.data.specialReference;

      // Webhook sent to payments/callback instead of subscriptions/webhook
      const res = await request(app)
        .post('/api/v1/payments/callback')
        .send({
          secret: 'dev_mock_webhook_secret',
          special_reference: specialReference,
          status: 'paid',
          transactionId: 'tx_paymob_fallback_999',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('paid');
    });
  });

  describe('Retired .yearly plan codes', () => {
    // Yearly used to be a separate plan document. Collapsing it into a second price on the
    // parent retired those codes, so an old client gets a 404 for a call that worked before --
    // it should say what to send instead rather than dead-ending.
    it('names the replacement code instead of a bare "not found"', async () => {
      const res = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ planCode: 'client.pro.yearly', billingCycle: 'yearly' });

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/no longer exists/i);
      expect(res.body.message).toContain('"planCode": "client.pro"');
      expect(res.body.message).toContain('"billingCycle": "yearly"');
    });

    it('leaves an ordinary unknown code with the plain message', async () => {
      const res = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ planCode: 'client.doesnotexist' });

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/not found/i);
      expect(res.body.message).not.toMatch(/no longer exists/i);
    });
  });

  describe('Yearly billing is quoted at the yearly price', () => {
    it('quotes priceYearlyEgp, not the monthly price, for a yearly checkout', async () => {
      // The regression: plan.priceYearlyEgp did not exist, so this quoted 250 EGP for a
      // 2,900 EGP plan and then granted a 365-day period against it.
      const res = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ planCode: 'client.pro', billingCycle: 'yearly' });

      expect(res.status).toBe(200);
      expect(res.body.data.amountEgp).toBe(2900);
      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({ amountEgp: 2900, billingCycle: 'yearly' })
      );
    });

    it('still quotes the monthly price for a monthly checkout', async () => {
      const res = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ planCode: 'client.pro', billingCycle: 'monthly' });

      expect(res.body.data.amountEgp).toBe(250);
    });

    it('rejects a yearly cycle on a plan that has no yearly price', async () => {
      const res = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ planCode: 'client.free', billingCycle: 'yearly' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/subscriptions/orders/:orderId', () => {
    it('reports the order status so the app can confirm payment after the redirect', async () => {
      const checkoutRes = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ planCode: 'client.pro' });

      const { orderId } = checkoutRes.body.data;

      const res = await request(app)
        .get(`/api/v1/subscriptions/orders/${orderId}`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.order.status).toBe('pending');
      expect(res.body.data.order.planCode).toBe('client.pro');
      // Narrow projection: the raw provider payload carries the masked PAN.
      expect(res.body.data.order.rawCallbackData).toBeUndefined();
    });

    it("refuses to expose another user's order", async () => {
      const checkoutRes = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ planCode: 'client.pro' });

      const otherToken = generateAccessToken({
        sub: '60f719b8f1a2c81234567999',
        role: 'client',
      });

      const res = await request(app)
        .get(`/api/v1/subscriptions/orders/${checkoutRes.body.data.orderId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
    });

    it('rejects a malformed orderId with 400 rather than a cast error', async () => {
      const res = await request(app)
        .get('/api/v1/subscriptions/orders/not-an-object-id')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(400);
    });

    it('requires authentication', async () => {
      const res = await request(app).get(
        '/api/v1/subscriptions/orders/60f719b8f1a2c81234567811'
      );

      expect(res.status).toBe(401);
    });
  });
});
