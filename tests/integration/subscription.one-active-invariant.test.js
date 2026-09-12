import mongoose from 'mongoose';
import User from '../../src/modules/users/user.model.js';
import Plan from '../../src/modules/subscriptions/plan.model.js';
import Subscription from '../../src/modules/subscriptions/subscription.model.js';
import subscriptionRepository from '../../src/modules/subscriptions/subscription.repository.js';
import { ensureUserSubscription } from '../../src/modules/subscriptions/subscription.service.js';
import { ROLES } from '../../src/common/constants/roles.constant.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';

/**
 * The one-active-subscription invariant (Phase 2).
 *
 * Before the partial unique index, `{ userId, currentPeriodStart }` was the only uniqueness
 * constraint — which does nothing to stop two ACTIVE rows for one user with different start
 * timestamps. Every grant path read the active row and then wrote it in two separate
 * round-trips, so concurrent callers could each see "none" and each insert one, leaving
 * findActiveByUserId to pick arbitrarily between them via .sort({ createdAt: -1 }).
 *
 * These exercise the real index against a real mongod rather than a mocked repository.
 */

const CLIENT_FREE = {
  code: 'client.free',
  name: 'Client Free',
  role: 'client',
  tier: 'free',
  priceEgp: 0,
  entitlements: { 'requests.daily': 1 },
  isActive: true,
};

describe('Subscription — one active row per user', () => {
  let clientUser;

  beforeAll(async () => {
    await connectTestDB();
    // The partial unique index only exists once Mongoose has synced it.
    await Subscription.syncIndexes();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    await Subscription.syncIndexes();
    await Plan.create(CLIENT_FREE);

    clientUser = await User.create({
      name: 'Client User',
      email: 'client@murafiq.com',
      passwordHash: 'hashedpassword',
      role: ROLES.CLIENT,
      isEmailVerified: true,
    });
  });

  it('has the partial unique index on { userId } where status is active', async () => {
    const indexes = await Subscription.collection.indexes();
    const partial = indexes.find(
      (idx) => idx.unique && idx.partialFilterExpression?.status === 'active'
    );

    expect(partial).toBeDefined();
    expect(partial.key).toEqual({ userId: 1 });
  });

  it('rejects a second ACTIVE row for the same user at the database level', async () => {
    await Subscription.create({
      userId: clientUser._id,
      planCode: 'client.free',
      role: 'client',
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: null,
    });

    // A different currentPeriodStart — which the OLD composite index would have allowed
    // through, since it only constrained { userId, currentPeriodStart }.
    await expect(
      Subscription.create({
        userId: clientUser._id,
        planCode: 'client.pro',
        role: 'client',
        status: 'active',
        currentPeriodStart: new Date(Date.now() + 60_000),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('still allows historical non-active rows to accumulate', async () => {
    // The index is partial for exactly this reason: cancelled/expired rows are history.
    await Subscription.create({
      userId: clientUser._id,
      planCode: 'client.pro',
      role: 'client',
      status: 'expired',
      currentPeriodStart: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      currentPeriodEnd: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    });
    await Subscription.create({
      userId: clientUser._id,
      planCode: 'client.pro',
      role: 'client',
      status: 'cancelled',
      currentPeriodStart: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      currentPeriodEnd: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
    await Subscription.create({
      userId: clientUser._id,
      planCode: 'client.free',
      role: 'client',
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: null,
    });

    expect(await Subscription.countDocuments({ userId: clientUser._id })).toBe(3);
    expect(
      await Subscription.countDocuments({ userId: clientUser._id, status: 'active' })
    ).toBe(1);
  });

  it('ensureUserSubscription is safe under concurrency', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => ensureUserSubscription(clientUser._id, 'client'))
    );

    const activeCount = await Subscription.countDocuments({
      userId: clientUser._id,
      status: 'active',
    });
    expect(activeCount).toBe(1);

    // Every caller gets the same row back, whichever request won the insert race.
    const ids = new Set(results.map((sub) => sub._id.toString()));
    expect(ids.size).toBe(1);
  });

  it('replaceActivePlanCAS returns null instead of resurrecting a non-active row', async () => {
    const sub = await Subscription.create({
      userId: clientUser._id,
      planCode: 'client.free',
      role: 'client',
      status: 'cancelled',
      currentPeriodStart: new Date(),
      currentPeriodEnd: null,
    });

    const result = await subscriptionRepository.replaceActivePlanCAS(sub._id, {
      planCode: 'client.pro',
      status: 'active',
    });

    expect(result).toBeNull();
    // The row is untouched — a lost CAS must not write anything.
    const reread = await Subscription.findById(sub._id);
    expect(reread.status).toBe('cancelled');
    expect(reread.planCode).toBe('client.free');
  });

  it('findDuplicateActiveSubscriptions reports nothing on a clean database', async () => {
    await ensureUserSubscription(clientUser._id, 'client');

    const duplicates = await subscriptionRepository.findDuplicateActiveSubscriptions();
    expect(duplicates).toEqual([]);
  });

  it('findDuplicateActiveSubscriptions finds pre-existing duplicates', async () => {
    // Simulates a database that predates the index. The index is enforced by the server, not
    // by Mongoose, so going straight to the driver is not enough -- it has to be dropped to
    // reproduce the legacy state the pre-flight script exists to detect. The next beforeEach
    // calls syncIndexes() again, so the drop does not leak into other tests.
    await Subscription.collection.dropIndex('uniq_active_subscription_per_user');

    await Subscription.collection.insertMany([
      {
        userId: clientUser._id,
        planCode: 'client.free',
        role: 'client',
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: null,
        createdAt: new Date(),
      },
      {
        userId: clientUser._id,
        planCode: 'client.pro',
        role: 'client',
        status: 'active',
        currentPeriodStart: new Date(Date.now() + 1000),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
      },
    ]);

    const duplicates = await subscriptionRepository.findDuplicateActiveSubscriptions();

    expect(duplicates.length).toBe(1);
    expect(duplicates[0].userId).toBe(clientUser._id.toString());
    expect(duplicates[0].count).toBe(2);
    expect(duplicates[0].subscriptions.map((s) => s.planCode).sort()).toEqual([
      'client.free',
      'client.pro',
    ]);

    // The reason the pre-flight check exists: rebuilding the index over this data fails, and
    // Mongo's error names one offending key rather than every user who needs fixing.
    await expect(Subscription.syncIndexes()).rejects.toMatchObject({ code: 11000 });
  });

  it('SubscriptionHistory refuses mutation through the model', async () => {
    const SubscriptionHistory = mongoose.model('SubscriptionHistory');
    await SubscriptionHistory.create({
      userId: clientUser._id,
      changeType: 'admin_grant',
      newPlanCode: 'client.pro',
    });

    await expect(
      SubscriptionHistory.updateOne({ userId: clientUser._id }, { $set: { newPlanCode: 'x' } })
    ).rejects.toThrow(/immutable/i);

    await expect(SubscriptionHistory.deleteMany({ userId: clientUser._id })).rejects.toThrow(
      /immutable/i
    );
  });
});
