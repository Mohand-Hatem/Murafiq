import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';
import Subscription from '../../src/modules/subscriptions/subscription.model.js';
import Plan from '../../src/modules/subscriptions/plan.model.js';
import { CANONICAL_PLANS } from '../../src/modules/subscriptions/plan.constants.js';
import { ensureUserSubscription } from '../../src/modules/subscriptions/subscription.service.js';

/**
 * Subscription persistence against the REAL schema.
 *
 * Every other subscription suite mocks `subscription.repository.js`, so none of them ever
 * hands a document to Mongoose. That gap hid a total outage: `currentPeriodEnd` was declared
 * `required: true` while `ensureUserSubscription` writes `null` for the Free tier, so every
 * free-plan `Subscription.create()` threw a ValidationError. Registration wrapped the call in
 * a try/catch and only logged, so no user ever got a subscription row — and
 * `getSubscriptionStatus`, which does NOT catch, turned GET /subscriptions/me into a
 * guaranteed 500.
 *
 * These tests deliberately use no repository mocks. That is the whole point of them.
 */
describe('Subscription persistence (real schema, no mocks)', () => {
  beforeAll(async () => {
    await connectTestDB();
    await Plan.insertMany(CANONICAL_PLANS);
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await Subscription.deleteMany({});
  });

  const userId = new mongoose.Types.ObjectId();

  it('persists a Free subscription with a null currentPeriodEnd', async () => {
    const sub = await ensureUserSubscription(userId, 'client');

    expect(sub._id).toBeDefined();
    expect(sub.planCode).toBe('client.free');
    expect(sub.currentPeriodEnd).toBeNull();

    // Actually on disk, not just returned.
    const stored = await Subscription.findById(sub._id).lean();
    expect(stored).not.toBeNull();
    expect(stored.currentPeriodEnd).toBeNull();
  });

  it('provisions a stylist on the stylist free plan', async () => {
    const stylistId = new mongoose.Types.ObjectId();
    const sub = await ensureUserSubscription(stylistId, 'stylist');

    expect(sub.planCode).toBe('stylist.free');
    expect(sub.role).toBe('stylist');
  });

  it('is idempotent — a second call returns the existing row, not a duplicate', async () => {
    const first = await ensureUserSubscription(userId, 'client');
    const second = await ensureUserSubscription(userId, 'client');

    expect(second._id.toString()).toBe(first._id.toString());
    expect(await Subscription.countDocuments({ userId })).toBe(1);
  });

  it('still persists a paid subscription with a real period end', async () => {
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const sub = await Subscription.create({
      userId: new mongoose.Types.ObjectId(),
      planCode: 'client.pro',
      role: 'client',
      billingCycle: 'monthly',
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: periodEnd,
    });

    expect(sub.currentPeriodEnd.getTime()).toBe(periodEnd.getTime());
  });
});

describe('Plan catalogue persistence (real schema)', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  it('round-trips both prices, and leaves free plans without a yearly price', async () => {
    await clearTestDB();
    await Plan.insertMany(CANONICAL_PLANS);

    const pro = await Plan.findOne({ code: 'client.pro' }).lean();
    expect(pro.priceEgp).toBe(250);
    expect(pro.priceYearlyEgp).toBe(2842);

    const free = await Plan.findOne({ code: 'client.free' }).lean();
    expect(free.priceYearlyEgp).toBeNull();

    // billingCycle was removed from the schema; Mongoose must not resurrect it on write.
    expect(pro.billingCycle).toBeUndefined();
  });
});
