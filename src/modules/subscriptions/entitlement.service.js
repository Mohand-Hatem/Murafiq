import UsageCounter from './usage-counter.model.js';
import Request from '../requests/request.model.js';
import Offer from '../offers/offer.model.js';
// Documented cross-module exception (see AGENTS.md — "Architecture rules"): entitlement.service
// may import another module's model directly, but only for read-only countDocuments capacity
// checks, never writes. WardrobeItem joins Request/Offer under that same exception.
import WardrobeItem from '../wardrobe/wardrobe-item.model.js';
import subscriptionRepository from './subscription.repository.js';
import planRepository from './plan.repository.js';
import { FALLBACK_FREE_ENTITLEMENTS } from './plan.constants.js';
import { getBusinessDayRange, getBusinessMonthRange } from '../../common/utils/businessDay.util.js';
import ApiError from '../../common/utils/ApiError.js';
import { REQUEST_STATUS, OFFER_STATUS } from '../../common/constants/statuses.constant.js';

/**
 * Resolves the active entitlements for a given user.
 * Returns the plan details and a plain key-value map of limits.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string} [role='client']
 * @returns {Promise<{ planCode: string, tier: string, entitlements: Object }>}
 */
export const getEntitlements = async (userId, role = 'client') => {
  const activeSub = await subscriptionRepository.findActiveByUserId(userId);

  // Lazy expiry check, same pattern coupon.service.js already uses at redemption time:
  // `currentPeriodEnd` is the load-bearing "never expires" signal for a free plan (it is
  // `null`), so a NON-null value in the past means the paid period has genuinely lapsed.
  // Without this, a lapsed plan kept granting full paid entitlements for up to 24h until
  // the 02:00 renewal sweep ran next -- or indefinitely if that cron ever stopped. This
  // is read-only: it never writes the downgrade itself, which stays the sweep's job (and
  // the sweep is what records the SubscriptionHistory transition). See
  // docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X16.
  const isLapsed =
    activeSub?.currentPeriodEnd && activeSub.currentPeriodEnd.getTime() <= Date.now();

  if (activeSub && activeSub.planCode && !isLapsed) {
    const plan = await planRepository.findByCode(activeSub.planCode);
    if (plan && plan.entitlements) {
      const entitlementsMap =
        plan.entitlements instanceof Map
          ? Object.fromEntries(plan.entitlements)
          : plan.entitlements;

      return {
        planCode: plan.code,
        tier: plan.tier || 'free',
        entitlements: entitlementsMap,
      };
    }
  }

  // Fallback to Free defaults if no active subscription record exists
  const fallbackKey = role === 'stylist' ? 'stylist' : 'client';
  const defaultCode = role === 'stylist' ? 'stylist.free' : 'client.free';

  return {
    planCode: defaultCode,
    tier: 'free',
    entitlements: { ...FALLBACK_FREE_ENTITLEMENTS[fallbackKey] },
  };
};

/**
 * Resolves periodKey and expiresAt for a given metric based on its suffix.
 * - .monthly: "YYYY-MM" (Cairo calendar month), 400 days TTL
 * - .lifetime: "lifetime", null (no TTL expiration)
 * - default (.daily): "YYYY-MM-DD" (Cairo calendar day), 40 days TTL
 *
 * @param {string} metric
 * @returns {{ periodKey: string, expiresAt: Date|null, granularity: 'monthly'|'lifetime'|'daily' }}
 */
export const resolvePeriodDetails = (metric) => {
  if (typeof metric === 'string' && metric.endsWith('.monthly')) {
    const { startOfMonth } = getBusinessMonthRange();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
    });
    const periodKey = formatter.format(startOfMonth); // "YYYY-MM" in Cairo time
    const expiresAt = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000); // 400 days TTL
    return { periodKey, expiresAt, granularity: 'monthly' };
  }

  if (typeof metric === 'string' && metric.endsWith('.lifetime')) {
    return { periodKey: 'lifetime', expiresAt: null, granularity: 'lifetime' };
  }

  const { startOfDay } = getBusinessDayRange();
  const periodKey = startOfDay.toISOString().split('T')[0]; // "YYYY-MM-DD"
  const expiresAt = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000); // 40 days TTL
  return { periodKey, expiresAt, granularity: 'daily' };
};

/**
 * Atomically consumes quota for a given metric (daily, monthly, or lifetime).
 * Throws ApiError 429 if quota is exceeded.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string} metric
 * @param {number} [count=1]
 * @param {string} [role='client']
 * @returns {Promise<{ success: boolean, used: number, limit: number }>}
 */
export const consume = async (userId, metric, count = 1, role = 'client') => {
  const { entitlements, planCode } = await getEntitlements(userId, role);
  const limit = entitlements[metric];

  if (limit === undefined || limit === null) {
    // If not defined or unlimited, allow through
    return { success: true, used: 0, limit: Infinity };
  }

  const { periodKey, expiresAt, granularity } = resolvePeriodDetails(metric);

  const quotaPrefix =
    granularity === 'monthly'
      ? 'Monthly quota'
      : granularity === 'lifetime'
        ? 'Lifetime trial'
        : 'Daily quota';

  const limitUnit =
    granularity === 'monthly'
      ? '/month'
      : granularity === 'lifetime'
        ? ' lifetime'
        : '/day';

  if (count > limit) {
    throw new ApiError(
      429,
      `${quotaPrefix} exceeded for ${metric}. Your limit is ${limit}${limitUnit} on the ${planCode} plan. Upgrade your plan for higher limits.`
    );
  }

  const setOnInsert = expiresAt ? { expiresAt } : {};

  try {
    const counter = await UsageCounter.findOneAndUpdate(
      {
        subjectId: userId,
        metric,
        periodKey,
        used: { $lte: limit - count },
      },
      {
        $inc: { used: count },
        ...(Object.keys(setOnInsert).length > 0 ? { $setOnInsert: setOnInsert } : {}),
      },
      {
        upsert: true,
        returnDocument: 'after',
      }
    );

    return { success: true, used: counter.used, limit };
  } catch (error) {
    // Unique index violation (E11000) occurs when doc exists and used >= limit (upsert attempts insert)
    if (error.code === 11000) {
      throw new ApiError(
        429,
        `${quotaPrefix} exceeded for ${metric}. Your limit is ${limit}${limitUnit} on the ${planCode} plan. Upgrade your plan for higher limits.`
      );
    }
    throw error;
  }
};

/**
 * Checks whether the user has available quota to consume for a given metric without mutating or throwing.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string} metric
 * @param {number} [count=1]
 * @param {string} [role='client']
 * @returns {Promise<{ allowed: boolean, limit: number, used: number, remaining: number, planCode: string }>}
 */
export const checkQuota = async (userId, metric, count = 1, role = 'client') => {
  const { entitlements, planCode } = await getEntitlements(userId, role);
  const limit = entitlements[metric];

  if (limit === undefined || limit === null) {
    return { allowed: true, limit: Infinity, used: 0, remaining: Infinity, planCode };
  }

  if (limit === 0 || count > limit) {
    return { allowed: false, limit, used: 0, remaining: 0, planCode };
  }

  const { periodKey } = resolvePeriodDetails(metric);

  const counter = await UsageCounter.findOne({
    subjectId: userId,
    metric,
    periodKey,
  });

  const used = counter?.used || 0;
  const remaining = Math.max(0, limit - used);
  const allowed = remaining >= count;

  return {
    allowed,
    limit,
    used,
    remaining,
    planCode,
  };
};

/**
 * Computes live persistent capacity for active items (requests, offers, wardrobe).
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {'requests.active'|'offers.active'|'wardrobe.photos.max'} metric
 * @param {string} [role='client']
 * @returns {Promise<{ limit: number, used: number, available: number, hasCapacity: boolean }>}
 */
export const capacity = async (userId, metric, role = 'client') => {
  const { entitlements } = await getEntitlements(userId, role);
  const limit = entitlements[metric] || 1;

  let used = 0;

  if (metric === 'requests.active') {
    used = await Request.countDocuments({
      clientId: userId,
      status: REQUEST_STATUS.OPEN,
    });
  } else if (metric === 'offers.active') {
    used = await Offer.countDocuments({
      stylistId: userId,
      status: OFFER_STATUS.PENDING,
    });
  } else if (metric === 'wardrobe.photos.max') {
    // WardrobeItem uses hard delete (AGENTS.md), so every remaining document is a live photo —
    // no isArchived/isDeleted filter needed.
    used = await WardrobeItem.countDocuments({ userId });
  }

  const available = Math.max(0, limit - used);
  const hasCapacity = used < limit;

  return {
    limit,
    used,
    available,
    hasCapacity,
  };
};

/**
 * Checks boolean feature entitlements (e.g. 'feed.priority').
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string} featureName
 * @param {string} [role='stylist']
 * @returns {Promise<boolean>}
 */
export const hasFeature = async (userId, featureName, role = 'stylist') => {
  const { entitlements } = await getEntitlements(userId, role);
  return Boolean(entitlements[featureName]);
};

/**
 * Refunds previously consumed daily quota (e.g. on client 15-minute zero-offer cancellation).
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {'requests.daily'|'offers.daily'|'ai.messages.daily'} metric
 * @param {number} [count=1]
 * @returns {Promise<void>}
 */
export const refundQuota = async (userId, metric, count = 1) => {
  const { periodKey } = resolvePeriodDetails(metric);

  await UsageCounter.updateOne(
    {
      subjectId: userId,
      metric,
      periodKey,
    },
    {
      $inc: { used: -count },
    }
  );
};

/**
 * Pre-bills try-on requests with sequential fallback:
 * 1. Checks and consumes ai.tryOn.monthly if available.
 * 2. If monthly quota is exhausted or 0 (free tier), checks and consumes ai.tryOn.trial.lifetime.
 * 3. If both are exhausted, throws ApiError 429.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string} [role='client']
 * @returns {Promise<{ success: boolean, quotaSource: 'monthly'|'lifetime' }>}
 */
export const consumeTryOnQuota = async (userId, role = 'client') => {
  // 1. Attempt monthly quota first
  const monthlyCheck = await checkQuota(userId, 'ai.tryOn.monthly', 1, role);
  if (monthlyCheck.allowed) {
    try {
      await consume(userId, 'ai.tryOn.monthly', 1, role);
      return { success: true, quotaSource: 'monthly' };
    } catch (err) {
      // If concurrent request consumed the last monthly slot, fall through to lifetime trial
      if (err.statusCode !== 429) {
        throw err;
      }
    }
  }

  // 2. Fall back to lifetime trial (e.g. for free tier or first-time try-on)
  const lifetimeCheck = await checkQuota(userId, 'ai.tryOn.trial.lifetime', 1, role);
  if (lifetimeCheck.allowed) {
    await consume(userId, 'ai.tryOn.trial.lifetime', 1, role);
    return { success: true, quotaSource: 'lifetime' };
  }

  throw new ApiError(
    429,
    `Virtual Try-On quota exceeded. Your try-on limit has been reached on the ${monthlyCheck.planCode} plan. Upgrade your plan for additional try-ons.`
  );
};

export default {
  getEntitlements,
  consume,
  checkQuota,
  capacity,
  hasFeature,
  refundQuota,
  resolvePeriodDetails,
  consumeTryOnQuota,
};
