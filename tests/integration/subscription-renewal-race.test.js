import '../../src/common/globals.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectTestDB, closeTestDB } from '../setup/db-handler.js';
import mongoose from 'mongoose';
import User from '../../src/modules/users/user.model.js';
import Subscription from '../../src/modules/subscriptions/subscription.model.js';
import Plan from '../../src/modules/subscriptions/plan.model.js';
import { sweepExpiredSubscriptions } from '../../src/jobs/subscription-renewal.cron.js';

/**
 * Regression test for docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X8: the renewal sweep
 * read all expired subscriptions, then wrote a plain updateById with no re-check that the
 * row was STILL expired. A paid webhook granting a fresh period between the sweep's read
 * and its write was silently overwritten -- the user paid for a new period and lost it to
 * the very next tick of the sweep.
 */
describe('sweepExpiredSubscriptions — CAS against concurrent renewal (X8)', () => {
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
    user = await User.create({
      name: 'Renewal Race Client',
      email: 'renewal-race@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'client',
      isEmailVerified: true,
    });
  });

  it('downgrades a subscription that is genuinely still expired', async () => {
    const expiredAt = new Date(Date.now() - 60 * 1000);
    const sub = await Subscription.create({
      userId: user._id,
      planCode: 'client.pro',
      role: 'client',
      status: 'active',
      currentPeriodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      currentPeriodEnd: expiredAt,
      source: 'paid',
    });

    const { sweptCount } = await sweepExpiredSubscriptions();

    expect(sweptCount).toBe(1);
    const updated = await Subscription.findById(sub._id);
    expect(updated.planCode).toBe('client.free');
    expect(updated.currentPeriodEnd).toBeNull();
  });

  it('does NOT downgrade a subscription renewed concurrently between read and write', async () => {
    const expiredAt = new Date(Date.now() - 60 * 1000);
    const sub = await Subscription.create({
      userId: user._id,
      planCode: 'client.pro',
      role: 'client',
      status: 'active',
      currentPeriodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      currentPeriodEnd: expiredAt,
      source: 'paid',
    });

    // Simulate a webhook granting a fresh paid period landing AFTER the sweep's own read
    // (findExpiringSubscriptions) but BEFORE its write -- by mutating the row directly
    // between the two, which is exactly what a concurrent request would do.
    const freshPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const originalFind = mongoose.model('Subscription').find;
    let intercepted = false;
    mongoose.model('Subscription').find = function (...args) {
      const query = originalFind.apply(this, args);
      if (!intercepted) {
        intercepted = true;
        const originalExec = query.exec.bind(query);
        query.exec = async (...execArgs) => {
          const result = await originalExec(...execArgs);
          // The race: a payment webhook grants a new period right after the sweep read.
          await Subscription.updateOne({ _id: sub._id }, { $set: { currentPeriodEnd: freshPeriodEnd } });
          return result;
        };
      }
      return query;
    };

    try {
      const { sweptCount } = await sweepExpiredSubscriptions();
      expect(sweptCount).toBe(0);
    } finally {
      mongoose.model('Subscription').find = originalFind;
    }

    const updated = await Subscription.findById(sub._id);
    // The user's paid renewal survived the sweep instead of being overwritten.
    expect(updated.planCode).toBe('client.pro');
    expect(updated.currentPeriodEnd.getTime()).toBe(freshPeriodEnd.getTime());
  });

  // Regression test for docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X15: the sweep is the
  // single most common subscription transition and used to write no SubscriptionHistory
  // entry at all -- 'expiry_sweep' was a declared changeType with zero writers.
  it('records an expiry_sweep SubscriptionHistory entry when downgrading to Free', async () => {
    const expiredAt = new Date(Date.now() - 60 * 1000);
    const sub = await Subscription.create({
      userId: user._id,
      planCode: 'client.pro',
      role: 'client',
      status: 'active',
      currentPeriodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      currentPeriodEnd: expiredAt,
      source: 'paid',
    });

    await sweepExpiredSubscriptions();

    const SubscriptionHistory = mongoose.model('SubscriptionHistory');
    const entry = await SubscriptionHistory.findOne({ subscriptionId: sub._id });
    expect(entry).toBeTruthy();
    expect(entry.changeType).toBe('expiry_sweep');
    expect(entry.previousPlanCode).toBe('client.pro');
    expect(entry.newPlanCode).toBe('client.free');
  });
});
