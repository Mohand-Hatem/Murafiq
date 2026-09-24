import '../../src/common/globals.js';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../src/app.js';
import User from '../../src/modules/users/user.model.js';
import Subscription from '../../src/modules/subscriptions/subscription.model.js';
import { seedPlans } from '../../src/modules/subscriptions/plan.repository.js';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';

describe('Demo Subscription Surface Isolation Integration Tests (Phase 3)', () => {
  let clientUser;
  let stylistUser;
  let clientToken;
  let stylistToken;

  beforeAll(async () => {
    await connectTestDB();
    await seedPlans();
  }, 300000);

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    await seedPlans();

    clientUser = await User.create({
      name: 'Demo Client',
      email: 'client@demo.dev',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'client',
      isEmailVerified: true,
      phone: '+201011112222',
      verification: { status: 'verified' },
    });

    stylistUser = await User.create({
      name: 'Demo Stylist',
      email: 'stylist@demo.dev',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'stylist',
      isEmailVerified: true,
      phone: '+201033334444',
      verification: { status: 'verified' },
    });

    clientToken = generateAccessToken({ sub: clientUser._id.toString(), role: clientUser.role });
    stylistToken = generateAccessToken({ sub: stylistUser._id.toString(), role: stylistUser.role });
  });

  describe('Demo Plan Catalogue Isolation (/api/demo/subscriptions/plans)', () => {
    it('returns only Free plans in Demo and excludes all paid plans', async () => {
      const res = await request(app).get('/api/demo/subscriptions/plans');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.plans)).toBe(true);

      const plans = res.body.data.plans;
      expect(plans.length).toBeGreaterThan(0);

      // Every plan in Demo must be Free tier with 0 price
      for (const plan of plans) {
        expect(plan.tier).toBe('free');
        expect(plan.priceEgp).toBe(0);
      }

      // Explicitly check that paid plans are NOT present
      const planCodes = plans.map((p) => p.code);
      expect(planCodes).toContain('client.free');
      expect(planCodes).toContain('stylist.free');
      expect(planCodes).not.toContain('client.pro');
      expect(planCodes).not.toContain('client.basic');
      expect(planCodes).not.toContain('stylist.pro');
      expect(planCodes).not.toContain('stylist.enterprise');
    });

    it('filters Demo plans by role (returns only client.free for client)', async () => {
      const res = await request(app).get('/api/demo/subscriptions/plans?role=client');

      expect(res.statusCode).toBe(200);
      const plans = res.body.data.plans;
      expect(plans.length).toBe(1);
      expect(plans[0].code).toBe('client.free');
      expect(plans[0].role).toBe('client');
      expect(plans[0].tier).toBe('free');
    });

    it('filters Demo plans by role (returns only stylist.free for stylist)', async () => {
      const res = await request(app).get('/api/demo/subscriptions/plans?role=stylist');

      expect(res.statusCode).toBe(200);
      const plans = res.body.data.plans;
      expect(plans.length).toBe(1);
      expect(plans[0].code).toBe('stylist.free');
      expect(plans[0].role).toBe('stylist');
      expect(plans[0].tier).toBe('free');
    });

    it('V1 /api/v1/subscriptions/plans returns both free and paid plans with zero regression', async () => {
      const res = await request(app).get('/api/v1/subscriptions/plans');

      expect(res.statusCode).toBe(200);
      const plans = res.body.data.plans;
      const planCodes = plans.map((p) => p.code);

      // V1 must contain both free and paid tiers
      expect(planCodes).toContain('client.free');
      expect(planCodes).toContain('client.pro');
      expect(planCodes).toContain('stylist.free');
      expect(planCodes).toContain('stylist.pro');
    });
  });

  describe('Demo User Subscription & Entitlements Inspection', () => {
    it('GET /api/demo/subscriptions/me requires authentication', async () => {
      const res = await request(app).get('/api/demo/subscriptions/me');
      expect(res.statusCode).toBe(401);
    });

    it('GET /api/demo/subscriptions/me returns active Free subscription for client', async () => {
      const res = await request(app)
        .get('/api/demo/subscriptions/me')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.subscription).toBeDefined();
      expect(res.body.data.subscription.planCode).toBe('client.free');
      expect(res.body.data.subscription.status).toBe('active');
      expect(res.body.data.subscription.currentPeriodEnd).toBeNull(); // Free never expires
      expect(res.body.data.entitlements['requests.daily']).toBe(1);
    });

    it('GET /api/demo/subscriptions/me returns active Free subscription for stylist', async () => {
      const res = await request(app)
        .get('/api/demo/subscriptions/me')
        .set('Authorization', `Bearer ${stylistToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.subscription.planCode).toBe('stylist.free');
      expect(res.body.data.entitlements['offers.daily']).toBe(3);
    });

    it('GET /api/demo/subscriptions/me/entitlements returns Free tier limits', async () => {
      const res = await request(app)
        .get('/api/demo/subscriptions/me/entitlements')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.planCode).toBe('client.free');
      expect(res.body.data.tier).toBe('free');
      expect(res.body.data.entitlements['requests.daily']).toBe(1);
      expect(res.body.data.entitlements['wardrobe.photos.max']).toBe(7);
    });
  });

  describe('Commerce & Paid Management Omission in Demo (404 Guarantee)', () => {
    it('omits POST /api/demo/subscriptions/checkout (returns 404)', async () => {
      const res = await request(app)
        .post('/api/demo/subscriptions/checkout')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ planCode: 'client.pro', billingCycle: 'monthly' });

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Route not found');
    });

    it('omits POST /api/demo/subscriptions/subscribe (returns 404)', async () => {
      const res = await request(app)
        .post('/api/demo/subscriptions/subscribe')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ planCode: 'client.free', billingCycle: 'monthly' });

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Route not found');
    });

    it('omits POST /api/demo/subscriptions/cancel (returns 404)', async () => {
      const res = await request(app)
        .post('/api/demo/subscriptions/cancel')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({});

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Route not found');
    });

    it('omits GET /api/demo/subscriptions/orders/:orderId (returns 404)', async () => {
      const fakeOrderId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .get(`/api/demo/subscriptions/orders/${fakeOrderId}`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Route not found');
    });

    it('omits POST /api/demo/subscriptions/webhook (returns 404)', async () => {
      const res = await request(app)
        .post('/api/demo/subscriptions/webhook')
        .send({ type: 'TRANSACTION' });

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Route not found');
    });
  });

  describe('Cross-Version Plan Protection & Isolation', () => {
    it('defensively presents Free plan in Demo even if user has a paid plan on V1', async () => {
      // Simulate user holding a paid plan in the shared database
      await Subscription.create({
        userId: clientUser._id,
        role: 'client',
        planCode: 'client.pro',
        billingCycle: 'monthly',
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
        source: 'paid',
      });

      // Calling Demo /me reflects Free plan
      const demoRes = await request(app)
        .get('/api/demo/subscriptions/me')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(demoRes.statusCode).toBe(200);
      expect(demoRes.body.data.subscription.planCode).toBe('client.free');
      expect(demoRes.body.data.plan.tier).toBe('free');
      expect(demoRes.body.data.subscription.currentPeriodEnd).toBeNull();

      // Calling Demo /me/entitlements reflects Free entitlements
      const demoEntitlementsRes = await request(app)
        .get('/api/demo/subscriptions/me/entitlements')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(demoEntitlementsRes.statusCode).toBe(200);
      expect(demoEntitlementsRes.body.data.planCode).toBe('client.free');
      expect(demoEntitlementsRes.body.data.tier).toBe('free');

      // Calling V1 /me still correctly reflects their paid V1 plan
      const v1Res = await request(app)
        .get('/api/v1/subscriptions/me')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(v1Res.statusCode).toBe(200);
      expect(v1Res.body.data.subscription.planCode).toBe('client.pro');
    });

    it('V1 /api/v1/subscriptions/subscribe continues enforcing paid plan guard (402)', async () => {
      const res = await request(app)
        .post('/api/v1/subscriptions/subscribe')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          planCode: 'client.pro',
          billingCycle: 'monthly',
        });

      expect(res.statusCode).toBe(402);
      expect(res.body.message).toMatch(/requires payment/i);
    });
  });
});
