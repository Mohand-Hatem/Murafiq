import cron from 'node-cron';
import planRepository from '../modules/subscriptions/plan.repository.js';
import subscriptionRepository from '../modules/subscriptions/subscription.repository.js';
import eventBus from '../common/events/event-bus.js';
import { EVENTS } from '../common/constants/events.constant.js';
import { BUSINESS_TIMEZONE } from '../common/constants/defaults.constant.js';
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

        // CAS, not a bare updateById: re-checks status:'active' AND currentPeriodEnd is
        // still <= now at write time. A webhook granting a fresh paid period between our
        // read (findExpiringSubscriptions) above and this write would otherwise be
        // silently overwritten -- the user loses a plan they just paid for. A null
        // result means exactly that race happened; skip this row, do not count it as
        // swept, and do not emit an event that never actually took effect. See
        // docs/AUDIT_2026_09_FULL_SYSTEM.md finding X8.
        const settled = await subscriptionRepository.expireSubscriptionCAS(
          sub._id,
          {
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
          },
          now
        );
        if (!settled) {
          logger.warn(
            `Subscription ${sub._id} was renewed concurrently; skipping the scheduled downgrade to '${pendingPlan.code}'.`
          );
          continue;
        }

        // The most common subscription transition (a scheduled downgrade taking effect)
        // used to write no SubscriptionHistory row at all -- 'scheduled_downgrade' was a
        // declared enum value with zero writers. See
        // docs/AUDIT_2026_09_FULL_SYSTEM.md finding X15.
        try {
          await subscriptionRepository.createHistoryEntry({
            userId: sub.userId,
            subscriptionId: sub._id,
            changeType: 'scheduled_downgrade',
            previousPlanCode: sub.planCode,
            previousBillingCycle: sub.billingCycle,
            previousStatus: sub.status,
            previousSource: sub.source || null,
            previousPeriodStart: sub.currentPeriodStart,
            previousPeriodEnd: sub.currentPeriodEnd,
            newPlanCode: pendingPlan.code,
            newBillingCycle: sub.pendingBillingCycle || 'monthly',
            newSource: sub.source || null,
            newPeriodStart: now,
            newPeriodEnd: settled.currentPeriodEnd,
            changedBy: null,
            changeReason: 'Scheduled downgrade applied at period end (renewal sweep)',
          });
        } catch (historyErr) {
          logger.error(`Failed to record subscription history for ${sub._id}: ${historyErr.message}`);
        }

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

      // Same CAS reasoning as above.
      const settled = await subscriptionRepository.expireSubscriptionCAS(
        sub._id,
        {
          planCode: freePlanCode,
          currentPeriodStart: now,
          currentPeriodEnd: null, // Free plan never expires
          pendingPlanCode: null,
          pendingBillingCycle: null,
          cancelAtPeriodEnd: false,
          status: 'active',
        },
        now
      );
      if (!settled) {
        logger.warn(
          `Subscription ${sub._id} was renewed concurrently; skipping the expiry-to-Free downgrade.`
        );
        continue;
      }

      // Same gap as above: an ordinary expiry-to-Free is the SINGLE most common
      // subscription transition, and it wrote no history at all. See
      // docs/AUDIT_2026_09_FULL_SYSTEM.md finding X15.
      try {
        await subscriptionRepository.createHistoryEntry({
          userId: sub.userId,
          subscriptionId: sub._id,
          changeType: 'expiry_sweep',
          previousPlanCode: sub.planCode,
          previousBillingCycle: sub.billingCycle,
          previousStatus: sub.status,
          previousSource: sub.source || null,
          previousPeriodStart: sub.currentPeriodStart,
          previousPeriodEnd: sub.currentPeriodEnd,
          newPlanCode: freePlanCode,
          newBillingCycle: null,
          newSource: 'free_default',
          newPeriodStart: now,
          newPeriodEnd: null,
          changedBy: null,
          changeReason: 'Paid period expired with no scheduled downgrade (renewal sweep)',
        });
      } catch (historyErr) {
        logger.error(`Failed to record subscription history for ${sub._id}: ${historyErr.message}`);
      }

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

  cron.schedule(
    RENEWAL_SWEEP_SCHEDULE,
    async () => {
      try {
        const summary = await sweepExpiredSubscriptions();
        if (summary.sweptCount > 0) {
          logger.info(`Subscription renewal sweep: Downgraded ${summary.sweptCount} expired subscription(s) to Free.`);
        }
      } catch (err) {
        logger.error(`Subscription renewal sweep failed: ${err.message}`);
      }
    },
    { timezone: BUSINESS_TIMEZONE }
  );

  logger.info(`Subscription renewal cron scheduled (${RENEWAL_SWEEP_SCHEDULE}).`);
};

export default { sweepExpiredSubscriptions, startSubscriptionRenewalCron };
