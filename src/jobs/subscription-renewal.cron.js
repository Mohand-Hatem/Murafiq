import cron from 'node-cron';
import planRepository from '../modules/subscriptions/plan.repository.js';
import subscriptionRepository from '../modules/subscriptions/subscription.repository.js';
import eventBus from '../common/events/event-bus.js';
import { EVENTS } from '../common/constants/events.constant.js';
import env from '../config/env.config.js';
import { logger } from '../config/logger.config.js';

const RENEWAL_SWEEP_SCHEDULE = '0 2 * * *'; // Daily at 2:00 AM Cairo time

let registered = false;

/**
 * Sweeps expired paid subscriptions and downgrades them back to Free tier.
 * @returns {Promise<{ sweptCount: number }>}
 */
export const sweepExpiredSubscriptions = async () => {
  const now = new Date();
  const expiredSubs = await subscriptionRepository.findExpiringSubscriptions(now);

  let sweptCount = 0;

  for (const sub of expiredSubs) {
    // A scheduled downgrade takes precedence over expiry-to-Free. The user chose this
    // plan and their paid period has now ended, so it becomes live here rather than
    // dropping them all the way to Free — which would be the wrong outcome and would
    // silently discard a paid selection.
    if (sub.pendingPlanCode) {
      const pendingPlan = await planRepository.findByCode(sub.pendingPlanCode);
      if (pendingPlan) {
        const isFreeTarget = pendingPlan.tier === 'free';
        const days = sub.pendingBillingCycle === 'yearly' ? 365 : 30;

        await subscriptionRepository.updateById(sub._id, {
          planCode: pendingPlan.code,
          billingCycle: sub.pendingBillingCycle || 'monthly',
          currentPeriodStart: now,
          currentPeriodEnd: isFreeTarget
            ? null
            : new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
          pendingPlanCode: null,
          pendingBillingCycle: null,
          cancelAtPeriodEnd: false,
          status: 'active',
        });

        sweptCount++;
        eventBus.emit(EVENTS.SUBSCRIPTION_EXPIRED, {
          userId: sub.userId.toString(),
          previousPlanCode: sub.planCode,
          downgradedTo: pendingPlan.code,
          scheduled: true,
        });
        continue;
      }
      // Plan vanished from the catalogue between scheduling and now — fall through to
      // Free rather than stranding the user on an expired paid plan.
      logger.warn(
        `Pending plan '${sub.pendingPlanCode}' no longer exists for subscription ${sub._id}; falling back to Free.`
      );
    }

    // Only downgrade if not already Free
    if (!sub.planCode.endsWith('.free')) {
      const freePlanCode = sub.role === 'stylist' ? 'stylist.free' : 'client.free';

      await subscriptionRepository.updateById(sub._id, {
        planCode: freePlanCode,
        currentPeriodStart: now,
        currentPeriodEnd: null, // Free plan never expires
        pendingPlanCode: null,
        pendingBillingCycle: null,
        cancelAtPeriodEnd: false,
        status: 'active',
      });

      sweptCount++;

      eventBus.emit(EVENTS.SUBSCRIPTION_EXPIRED, {
        userId: sub.userId.toString(),
        previousPlanCode: sub.planCode,
        downgradedTo: freePlanCode,
      });
    }
  }

  return { sweptCount };
};

export const startSubscriptionRenewalCron = () => {
  if (registered) return;
  if (env.NODE_ENV === 'test') return;

  registered = true;

  cron.schedule(RENEWAL_SWEEP_SCHEDULE, async () => {
    try {
      const summary = await sweepExpiredSubscriptions();
      if (summary.sweptCount > 0) {
        logger.info(`Subscription renewal sweep: Downgraded ${summary.sweptCount} expired subscription(s) to Free.`);
      }
    } catch (err) {
      logger.error(`Subscription renewal sweep failed: ${err.message}`);
    }
  });

  logger.info(`Subscription renewal cron scheduled (${RENEWAL_SWEEP_SCHEDULE}).`);
};

export default { sweepExpiredSubscriptions, startSubscriptionRenewalCron };
