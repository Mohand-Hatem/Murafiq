import '../../src/common/globals.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { connectTestDB, closeTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import Subscription from '../../src/modules/subscriptions/subscription.model.js';
import SubscriptionHistory from '../../src/modules/subscriptions/subscription-history.model.js';
import Plan from '../../src/modules/subscriptions/plan.model.js';
import subscriptionRepository from '../../src/modules/subscriptions/subscription.repository.js';
import subscriptionService from '../../src/modules/subscriptions/subscription.service.js';

/**
 * Regression test for docs/AUDIT_2026_09_FULL_SYSTEM.md finding X14: the paid grant path
 * (subscribe() -> applyPlanGrant) used to call applyPlanGrant with NO session, so the
 * SubscriptionHistory snapshot and the plan replacement were two independent writes on
 * the path a real customer payment goes through -- unlike the identical admin-grant path,
 * which was already wrapped in a transaction. A failure between the two writes could
 * leave a permanent, immutable history row describing a transition that never actually
 * happened (SubscriptionHistory blocks all mutation/deletion by design).
 */
describe('subscribe() paid grant path is transactional (X14)', () => {
  let user;

  beforeAll(async () => {
    await connectTestDB();
    await Plan.create({
      code: 'client.pro',
      name: 'Client Pro',
      role: 'client',
      tier: 'pro',
      priceEgp: 250,
      entitlements: {},
    });
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await Subscription.deleteMany({});
    // SubscriptionHistory blocks deleteMany() (it is append-only by design) — clear via
    // the raw collection driver instead, bypassing the Mongoose middleware that exists to
    // stop application code from doing exactly this.
    await SubscriptionHistory.collection.deleteMany({});
    jest.restoreAllMocks();
    user = await User.create({
      name: 'Grant Transaction Client',
      email: 'grant-tx@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'client',
      isEmailVerified: true,
    });
  });

  it('rolls back the plan replacement if the history write fails mid-transaction', async () => {
    const initial = await Subscription.create({
      userId: user._id,
      planCode: 'client.free',
      role: 'client',
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: null,
      source: 'free_default',
    });

    // The history snapshot succeeds; the SECOND write (the actual plan replacement) fails.
    // This is the case that actually exercises atomicity: without a shared transaction, the
    // history row from the first write would be permanently orphaned -- and, being
    // append-only/immutable by design, uncorrectable -- describing a transition to
    // 'client.pro' that never took effect, while the live subscription stayed on
    // 'client.free'.
    jest
      .spyOn(subscriptionRepository, 'replaceActivePlanCAS')
      .mockRejectedValueOnce(new Error('Simulated plan-replacement failure'));

    await expect(
      subscriptionService.subscribe(user._id, 'client', {
        planCode: 'client.pro',
        billingCycle: 'monthly',
        paid: true,
        chargedAmountEgp: 250,
      })
    ).rejects.toThrow(/Simulated plan-replacement failure/);

    const unchanged = await Subscription.findById(initial._id);
    expect(unchanged.planCode).toBe('client.free');

    const historyCount = await SubscriptionHistory.countDocuments({ userId: user._id });
    expect(historyCount).toBe(0);
  });

  it('still grants the plan and records history together on the success path', async () => {
    await Subscription.create({
      userId: user._id,
      planCode: 'client.free',
      role: 'client',
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: null,
      source: 'free_default',
    });

    const result = await subscriptionService.subscribe(user._id, 'client', {
      planCode: 'client.pro',
      billingCycle: 'monthly',
      paid: true,
      chargedAmountEgp: 250,
    });

    expect(result.planCode).toBe('client.pro');

    const historyEntry = await SubscriptionHistory.findOne({ userId: user._id });
    expect(historyEntry).toBeTruthy();
    expect(historyEntry.changeType).toBe('paid');
    expect(historyEntry.newPlanCode).toBe('client.pro');
  });
});
