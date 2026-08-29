import UsageCounter from './usage-counter.model.js';
import Request from '../requests/request.model.js';
import Offer from '../offers/offer.model.js';
import subscriptionRepository from './subscription.repository.js';
import planRepository from './plan.repository.js';
import { FALLBACK_FREE_ENTITLEMENTS } from './plan.constants.js';
import { getBusinessDayRange } from '../../common/utils/businessDay.util.js';
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

  if (activeSub && activeSub.planCode) {
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
 * Atomically consumes daily quota for a given metric.
 * Throws ApiError 429 if the daily quota is exceeded.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {'requests.daily'|'offers.daily'|'ai.messages.daily'} metric
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

  const { startOfDay } = getBusinessDayRange();
  const periodKey = startOfDay.toISOString().split('T')[0]; // "YYYY-MM-DD"

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
        $setOnInsert: {
          expiresAt: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000), // 40 days TTL
        },
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
        `Daily quota exceeded for ${metric}. Your limit is ${limit}/day on the ${planCode} plan. Upgrade your plan for higher limits.`
      );
    }
    throw error;
  }
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
    // Wardrobe module placeholder (Phase 14)
    used = 0;
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
  const { startOfDay } = getBusinessDayRange();
  const periodKey = startOfDay.toISOString().split('T')[0];

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

export default {
  getEntitlements,
  consume,
  capacity,
  hasFeature,
  refundQuota,
};
