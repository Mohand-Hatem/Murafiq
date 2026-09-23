import request from 'supertest';
import app from '../../src/app.js';
import User from '../../src/modules/users/user.model.js';
import Plan from '../../src/modules/subscriptions/plan.model.js';
import Subscription from '../../src/modules/subscriptions/subscription.model.js';
import SubscriptionHistory from '../../src/modules/subscriptions/subscription-history.model.js';
import SubscriptionOrder from '../../src/modules/subscriptions/subscription-order.model.js';
import Payment from '../../src/modules/payments/payment.model.js';
import LedgerEntry from '../../src/modules/ledger/ledger-entry.model.js';
import AuditLog from '../../src/modules/audit-log/audit-log.model.js';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';
import { ROLES } from '../../src/common/constants/roles.constant.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';

/**
 * Flow 3 — Admin manual subscription grant.
 *
 * The defining property under test is what does NOT happen: no Paymob call, no Payment, no
 * SubscriptionOrder and no LedgerEntry. An admin comp that mints ledger rows would book revenue
 * nobody paid, and because the rows balance the nightly reconciliation would never notice.
 */

const CLIENT_PRO = {
  code: 'client.pro',
  name: 'Client Pro',
  role: 'client',
  tier: 'pro',
  priceEgp: 250,
  priceYearlyEgp: 2842,
  entitlements: {
    'requests.daily': 4,
    'requests.active': 4,
    'ai.messages.daily': 80,
    'wardrobe.photos.max': 100,
  },
  isActive: true,
};

const CLIENT_FREE = {
  code: 'client.free',
  name: 'Client Free',
  role: 'client',
  tier: 'free',
  priceEgp: 0,
  entitlements: {
    'requests.daily': 1,
    'requests.active': 1,
    'ai.messages.lifetime': 10,
    'wardrobe.photos.max': 7,
  },
  isActive: true,
};

const STYLIST_PRO = {
  code: 'stylist.pro',
  name: 'Stylist Pro',
  role: 'stylist',
  tier: 'pro',
  priceEgp: 400,
  priceYearlyEgp: 4500,
  entitlements: { 'offers.daily': 20, 'offers.active': 20, 'feed.priority': true },
  isActive: true,
};

describe('Admin Manual Subscription Grant', () => {
  let adminUser;
  let adminToken;
  let operatorToken;
  let clientUser;
  let clientToken;
  let stylistUser;
  let stylistToken;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    await Plan.create([CLIENT_FREE, CLIENT_PRO, STYLIST_PRO]);

    adminUser = await User.create({
      name: 'Super Admin',
      email: 'admin@murafiq.com',
      passwordHash: 'hashedpassword',
      role: ROLES.ADMIN,
      isEmailVerified: true,
    });
    adminToken = generateAccessToken({ sub: adminUser._id.toString(), role: ROLES.ADMIN });

    const operatorUser = await User.create({
      name: 'Operator User',
      email: 'operator@murafiq.com',
      passwordHash: 'hashedpassword',
      role: ROLES.OPERATOR,
      isEmailVerified: true,
    });
    operatorToken = generateAccessToken({ sub: operatorUser._id.toString(), role: ROLES.OPERATOR });

    clientUser = await User.create({
      name: 'Client User',
      email: 'client@murafiq.com',
      phone: '+201000000001',
      passwordHash: 'hashedpassword',
      role: ROLES.CLIENT,
      isEmailVerified: true,
    });
    clientToken = generateAccessToken({ sub: clientUser._id.toString(), role: ROLES.CLIENT });

    stylistUser = await User.create({
      name: 'Stylist User',
      email: 'stylist@murafiq.com',
      phone: '+201000000002',
      passwordHash: 'hashedpassword',
      role: ROLES.STYLIST,
      isEmailVerified: true,
    });
    stylistToken = generateAccessToken({ sub: stylistUser._id.toString(), role: ROLES.STYLIST });
  });

  const grantUrl = (userId) => `/api/v1/admin/users/${userId}/subscription`;

  const grant = (userId, token, body) =>
    request(app).post(grantUrl(userId)).set('Authorization', `Bearer ${token}`).send(body);

  describe('RBAC — admin only', () => {
    it('rejects an unauthenticated caller with 401', async () => {
      const res = await request(app)
        .post(grantUrl(clientUser._id))
        .send({ planCode: 'client.pro', reason: 'test' });

      expect(res.status).toBe(401);
    });

    it('rejects a CLIENT with 403 — a user must not upgrade themselves for free', async () => {
      const res = await grant(clientUser._id, clientToken, {
        planCode: 'client.pro',
        reason: 'self upgrade attempt',
      });

      expect(res.status).toBe(403);
      expect(await Subscription.countDocuments({ planCode: 'client.pro' })).toBe(0);
    });

    it('rejects a STYLIST with 403', async () => {
      const res = await grant(stylistUser._id, stylistToken, {
        planCode: 'stylist.pro',
        reason: 'self upgrade attempt',
      });

      expect(res.status).toBe(403);
    });

    it('rejects an OPERATOR with 403 — operators share only the verification endpoints', async () => {
      const res = await grant(clientUser._id, operatorToken, {
        planCode: 'client.pro',
        reason: 'operator attempt',
      });

      expect(res.status).toBe(403);
    });
  });

  describe('Granting a plan', () => {
    it('grants a paid plan to a CLIENT and activates it immediately', async () => {
      const res = await grant(clientUser._id, adminToken, {
        planCode: 'client.pro',
        reason: 'Compensation for the March outage',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.subscription.planCode).toBe('client.pro');
      expect(res.body.data.subscription.status).toBe('active');
      expect(res.body.data.subscription.source).toBe('admin_grant');
      expect(res.body.data.subscription.grantedBy).toBe(adminUser._id.toString());

      const sub = await Subscription.findOne({ userId: clientUser._id, status: 'active' });
      expect(sub.planCode).toBe('client.pro');
      expect(sub.grantReason).toBe('Compensation for the March outage');
      expect(sub.currentPeriodEnd).toBeInstanceOf(Date);
    });

    it('grants a paid plan to a STYLIST', async () => {
      const res = await grant(stylistUser._id, adminToken, {
        planCode: 'stylist.pro',
        reason: 'Onboarding incentive',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.subscription.planCode).toBe('stylist.pro');
      expect(res.body.data.subscription.role).toBe('stylist');
    });

    it('honours an explicit durationDays override', async () => {
      const before = Date.now();
      const res = await grant(clientUser._id, adminToken, {
        planCode: 'client.pro',
        durationDays: 90,
        reason: 'Ninety day comp',
      });

      expect(res.status).toBe(200);

      const end = new Date(res.body.data.subscription.currentPeriodEnd).getTime();
      const expected = before + 90 * 24 * 60 * 60 * 1000;
      // Generous window: the assertion is "90 days, not the plan's default 30".
      expect(Math.abs(end - expected)).toBeLessThan(60 * 1000);
    });

    it('defaults to the plan cycle length when no duration is given', async () => {
      const before = Date.now();
      const res = await grant(clientUser._id, adminToken, {
        planCode: 'client.pro',
        reason: 'Standard month',
      });

      const end = new Date(res.body.data.subscription.currentPeriodEnd).getTime();
      expect(Math.abs(end - (before + 30 * 24 * 60 * 60 * 1000))).toBeLessThan(60 * 1000);
    });

    it('uses the yearly period for billingCycle=yearly', async () => {
      const before = Date.now();
      const res = await grant(clientUser._id, adminToken, {
        planCode: 'client.pro',
        billingCycle: 'yearly',
        reason: 'Annual comp',
      });

      expect(res.status).toBe(200);
      const end = new Date(res.body.data.subscription.currentPeriodEnd).getTime();
      expect(Math.abs(end - (before + 365 * 24 * 60 * 60 * 1000))).toBeLessThan(60 * 1000);
    });
  });

  describe('No payment artefacts are created', () => {
    it('creates no Payment, SubscriptionOrder or LedgerEntry', async () => {
      const res = await grant(clientUser._id, adminToken, {
        planCode: 'client.pro',
        reason: 'Free comp — must not look like revenue',
      });

      expect(res.status).toBe(200);

      // The whole point of Flow 3.
      expect(await Payment.countDocuments()).toBe(0);
      expect(await SubscriptionOrder.countDocuments()).toBe(0);
      expect(await LedgerEntry.countDocuments()).toBe(0);
    });

    it('does not return a paymentUrl or clientSecret', async () => {
      const res = await grant(clientUser._id, adminToken, {
        planCode: 'client.pro',
        reason: 'No checkout here',
      });

      expect(res.body.data.paymentUrl).toBeUndefined();
      expect(res.body.data.clientSecret).toBeUndefined();
    });
  });

  describe('Entitlements match a paid plan exactly', () => {
    it('gives the granted user the plan catalogue entitlements', async () => {
      await grant(clientUser._id, adminToken, {
        planCode: 'client.pro',
        reason: 'Entitlement parity check',
      });

      const res = await request(app)
        .get('/api/v1/subscriptions/me/entitlements')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.planCode).toBe('client.pro');
      expect(res.body.data.tier).toBe('pro');
      // Read straight off the Plan document -- the same source the paid path resolves through.
      expect(res.body.data.entitlements).toEqual(CLIENT_PRO.entitlements);
    });

    it('reports the granted plan through GET /subscriptions/me', async () => {
      await grant(clientUser._id, adminToken, {
        planCode: 'client.pro',
        reason: 'Visible to the user',
      });

      const res = await request(app)
        .get('/api/v1/subscriptions/me')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.subscription.planCode).toBe('client.pro');
      expect(res.body.data.plan.tier).toBe('pro');
    });
  });

  describe('Validation and role coherence', () => {
    it('rejects a plan belonging to the other role with 400', async () => {
      const res = await grant(clientUser._id, adminToken, {
        planCode: 'stylist.pro',
        reason: 'Wrong role plan',
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/stylist plan/i);
    });

    it('rejects an unknown plan code with 404', async () => {
      const res = await grant(clientUser._id, adminToken, {
        planCode: 'client.doesnotexist',
        reason: 'Unknown plan',
      });

      expect(res.status).toBe(404);
    });

    it('rejects granting a plan to an ADMIN account with 400', async () => {
      const res = await grant(adminUser._id, adminToken, {
        planCode: 'client.pro',
        reason: 'Admins have no plan',
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/clients and stylists only/i);
    });

    it('rejects a missing reason with 400 — the audit entry needs a justification', async () => {
      const res = await grant(clientUser._id, adminToken, { planCode: 'client.pro' });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown target user with 404', async () => {
      const res = await grant('60f719b8f1a2c81234567999', adminToken, {
        planCode: 'client.pro',
        reason: 'Ghost user',
      });

      expect(res.status).toBe(404);
    });

    it('rejects durationDays above the two-year cap with 400', async () => {
      const res = await grant(clientUser._id, adminToken, {
        planCode: 'client.pro',
        durationDays: 5000,
        reason: 'Effectively forever',
      });

      expect(res.status).toBe(400);
    });
  });

  describe('Replacement semantics, downgrade and history', () => {
    it('REPLACES an existing period outright rather than stacking onto it', async () => {
      await grant(clientUser._id, adminToken, {
        planCode: 'client.pro',
        durationDays: 200,
        reason: 'First grant',
      });

      const before = Date.now();
      const res = await grant(clientUser._id, adminToken, {
        planCode: 'client.pro',
        durationDays: 10,
        reason: 'Second grant, shorter',
      });

      const end = new Date(res.body.data.subscription.currentPeriodEnd).getTime();
      // 10 days from now, NOT 210 -- the replaced 200-day period is gone from the live row
      // (and preserved in history, asserted below).
      expect(Math.abs(end - (before + 10 * 24 * 60 * 60 * 1000))).toBeLessThan(60 * 1000);
    });

    it('downgrades to free IMMEDIATELY rather than scheduling it for period end', async () => {
      await grant(clientUser._id, adminToken, {
        planCode: 'client.pro',
        reason: 'Grant first',
      });

      const res = await grant(clientUser._id, adminToken, {
        planCode: 'client.free',
        reason: 'Revoked — chargeback',
      });

      expect(res.status).toBe(200);

      const sub = await Subscription.findOne({ userId: clientUser._id, status: 'active' });
      expect(sub.planCode).toBe('client.free');
      // Immediate, not deferred: nothing queued for the renewal sweep to apply later.
      expect(sub.pendingPlanCode).toBeNull();
      // Free never expires -- the load-bearing null the expiry sweep filters on.
      expect(sub.currentPeriodEnd).toBeNull();

      const entitlements = await request(app)
        .get('/api/v1/subscriptions/me/entitlements')
        .set('Authorization', `Bearer ${clientToken}`);
      expect(entitlements.body.data.entitlements).toEqual(CLIENT_FREE.entitlements);
    });

    it('preserves the replaced plan in subscription history', async () => {
      await grant(clientUser._id, adminToken, { planCode: 'client.pro', reason: 'First' });
      await grant(clientUser._id, adminToken, { planCode: 'client.free', reason: 'Then revoked' });

      const res = await request(app)
        .get(`/api/v1/admin/users/${clientUser._id}/subscription/history`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);

      const codes = res.body.data.map((h) => `${h.previousPlanCode}->${h.newPlanCode}`);
      // The first grant landed on a user with no subscription row yet, so it has no previous
      // plan -- still recorded, with previousPlanCode null.
      expect(codes).toContain('null->client.pro');
      expect(codes).toContain('client.pro->client.free');

      for (const entry of res.body.data) {
        expect(entry.changeType).toBe('admin_grant');
        expect(entry.changedBy._id).toBe(adminUser._id.toString());
      }
    });

    it('leaves exactly one active subscription after repeated grants', async () => {
      await grant(clientUser._id, adminToken, { planCode: 'client.pro', reason: 'one' });
      await grant(clientUser._id, adminToken, { planCode: 'client.pro', reason: 'two' });
      await grant(clientUser._id, adminToken, { planCode: 'client.free', reason: 'three' });

      const activeCount = await Subscription.countDocuments({
        userId: clientUser._id,
        status: 'active',
      });
      expect(activeCount).toBe(1);
    });

    it('clears a queued customer downgrade — an admin decision supersedes it', async () => {
      await grant(clientUser._id, adminToken, { planCode: 'client.pro', reason: 'grant' });
      await Subscription.updateOne(
        { userId: clientUser._id, status: 'active' },
        { $set: { pendingPlanCode: 'client.free', pendingBillingCycle: 'monthly' } }
      );

      await grant(clientUser._id, adminToken, {
        planCode: 'client.pro',
        durationDays: 60,
        reason: 'Extended — ignore the queued downgrade',
      });

      const sub = await Subscription.findOne({ userId: clientUser._id, status: 'active' });
      expect(sub.pendingPlanCode).toBeNull();
      expect(sub.pendingBillingCycle).toBeNull();
    });
  });

  describe('Auditability', () => {
    it('writes an audit entry naming the admin, plan, duration and reason', async () => {
      await grant(clientUser._id, adminToken, {
        planCode: 'client.pro',
        durationDays: 45,
        reason: 'Goodwill credit — ticket 4821',
      });

      // The listener is fired off the event bus, so give it a tick to land.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const log = await AuditLog.findOne({ action: 'subscription.admin_granted' });
      expect(log).not.toBeNull();
      expect(log.actorId.toString()).toBe(adminUser._id.toString());
      expect(log.actorRole).toBe('admin');
      expect(log.targetType).toBe('Subscription');
      expect(log.targetId).toBe(clientUser._id.toString());
      expect(log.metadata.planCode).toBe('client.pro');
      expect(log.metadata.durationDays).toBe(45);
      expect(log.metadata.reason).toBe('Goodwill credit — ticket 4821');
    });

    it('does NOT record the grant as subscription.activated — a comp is not revenue', async () => {
      await grant(clientUser._id, adminToken, {
        planCode: 'client.pro',
        reason: 'Not a payment',
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(await AuditLog.countDocuments({ action: 'subscription.activated' })).toBe(0);
      expect(await AuditLog.countDocuments({ action: 'subscription.admin_granted' })).toBe(1);
    });
  });

  describe('GET /admin/users/:userId/subscription', () => {
    it('returns the target user subscription and entitlements for an admin', async () => {
      await grant(clientUser._id, adminToken, { planCode: 'client.pro', reason: 'read back' });

      const res = await request(app)
        .get(grantUrl(clientUser._id))
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.subscription.planCode).toBe('client.pro');
      expect(res.body.data.entitlements).toEqual(CLIENT_PRO.entitlements);
    });

    it('refuses a client reading another user subscription', async () => {
      const res = await request(app)
        .get(grantUrl(stylistUser._id))
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('Subscription history collection', () => {
    it('records no history row for a first-time free provisioning', async () => {
      // ensureUserSubscription provisions the free tier on first read. Nothing is REPLACED,
      // so there is no transition to log -- otherwise every registration would add a row.
      await request(app)
        .get('/api/v1/subscriptions/me')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(await SubscriptionHistory.countDocuments({ userId: clientUser._id })).toBe(0);
    });
  });
});
