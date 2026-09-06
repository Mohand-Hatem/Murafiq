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
  },
  isActive: true,
};

const mockStylistPlan = {
  _id: '60f719b8f1a2c81234567844',
  code: 'stylist.pro',
  name: 'Stylist Pro',
  role: 'stylist',
  tier: 'pro',
  billingCycle: 'monthly',
  priceEgp: 300,
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

const mockUpdateOrderById = jest.fn().mockImplementation((id, data) => {
  for (const key of Object.keys(mockOrderStore)) {
    if (mockOrderStore[key]._id === id || String(mockOrderStore[key]._id) === String(id)) {
      mockOrderStore[key] = { ...mockOrderStore[key], ...data };
      return Promise.resolve(mockOrderStore[key]);
    }
  }
  return Promise.resolve({ _id: id, ...data });
});

const mockFindActiveByUserId = jest.fn().mockResolvedValue(mockSubscription);
const mockCreateSubscription = jest.fn().mockResolvedValue(mockSubscription);
const mockUpdateSubscriptionById = jest.fn().mockImplementation((id, data) =>
  Promise.resolve({ ...mockSubscription, ...data })
);

const mockFindByCode = jest.fn().mockImplementation((code) => {
  if (code === 'client.pro') return Promise.resolve(mockProPlan);
  if (code === 'client.free') return Promise.resolve(mockFreePlan);
  if (code === 'stylist.pro') return Promise.resolve(mockStylistPlan);
  return Promise.resolve(null);
});

jest.unstable_mockModule('../../src/modules/subscriptions/subscription-order.repository.js', () => ({
  default: {
    createOrder: mockCreateOrder,
    findBySpecialReference: mockFindBySpecialReference,
    findByTransactionId: mockFindByTransactionId,
    updateById: mockUpdateOrderById,
  },
  createOrder: mockCreateOrder,
  findBySpecialReference: mockFindBySpecialReference,
  findByTransactionId: mockFindByTransactionId,
  updateById: mockUpdateOrderById,
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
    findByUserId: mockFindActiveByUserId,
    createSubscription: mockCreateSubscription,
    updateById: mockUpdateSubscriptionById,
  },
  findActiveByUserId: mockFindActiveByUserId,
  findByUserId: mockFindActiveByUserId,
  createSubscription: mockCreateSubscription,
  updateById: mockUpdateSubscriptionById,
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
    egpToPiastres: mockEgpToPiastres,
    piastresToEgp: mockPiastresToEgp,
  },
  postEntry: mockPostEntry,
  egpToPiastres: mockEgpToPiastres,
  piastresToEgp: mockPiastresToEgp,
}));

const { default: app } = await import('../../src/app.js');

describe('Subscription Checkout & Webhook Integration Tests', () => {
  beforeEach(() => {
    mockOrderStore = {};
    jest.clearAllMocks();
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
      expect(webhookRes.body.data.order.status).toBe('paid');

      // Verify subscription updated
      expect(mockUpdateSubscriptionById).toHaveBeenCalledWith(
        mockSubscription._id,
        expect.objectContaining({
          planCode: 'client.pro',
          status: 'active',
        })
      );
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
      expect(res.body.data.order.status).toBe('paid');
    });
  });
});
