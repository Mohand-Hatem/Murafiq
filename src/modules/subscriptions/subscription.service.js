import mongoose from 'mongoose';
import subscriptionRepository from './subscription.repository.js';
import planRepository from './plan.repository.js';
import subscriptionOrderRepository from './subscription-order.repository.js';
import UsageCounter from './usage-counter.model.js';
import * as entitlementService from './entitlement.service.js';
import ledgerService from '../ledger/ledger.service.js';
import userRepository from '../users/user.repository.js';
import MockProvider from '../payments/providers/mock.provider.js';
import PaymobProvider from '../payments/providers/paymob.provider.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import { getBusinessDayRange } from '../../common/utils/businessDay.util.js';
import ApiError from '../../common/utils/ApiError.js';
import env from '../../config/env.config.js';

export const getPaymentProvider = () => {
  if (env.NODE_ENV === 'test' || env.PAYMENT_PROVIDER === 'mock') {
    return new MockProvider();
  }
  return new PaymobProvider();
};

/**
 * Ensures a user has an active subscription row in the database.
 * If none exists, provisions a Free plan subscription (currentPeriodEnd = null).
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string} role 'client' | 'stylist'
 * @returns {Promise<Object>}
 */
export const ensureUserSubscription = async (userId, role = 'client') => {
  const existing = await subscriptionRepository.findActiveByUserId(userId);
  if (existing) {
    return existing;
  }

  const defaultPlanCode = role === 'stylist' ? 'stylist.free' : 'client.free';

  return await subscriptionRepository.createSubscription({
    userId,
    planCode: defaultPlanCode,
    role: role === 'stylist' ? 'stylist' : 'client',
    billingCycle: 'monthly',
    status: 'active',
    currentPeriodStart: new Date(),
    currentPeriodEnd: null, // Free plan never expires
    cancelAtPeriodEnd: false,
  });
};

/**
 * Retrieves the comprehensive subscription status, active entitlements, and usage for a user.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string} [role='client']
 * @returns {Promise<Object>}
 */
export const getSubscriptionStatus = async (userId, role = 'client') => {
  const sub = await ensureUserSubscription(userId, role);
  const plan = await planRepository.findByCode(sub.planCode);
  const entitlementsData = await entitlementService.getEntitlements(userId, role);

  const { startOfDay } = getBusinessDayRange();
  const periodKey = startOfDay.toISOString().split('T')[0];

  const usageDocs = await UsageCounter.find({ subjectId: userId, periodKey });
  const usageMap = {};
  for (const doc of usageDocs) {
    usageMap[doc.metric] = doc.used;
  }

  let capacityMetrics = {};
  if (role === 'client') {
    capacityMetrics = {
      'requests.active': await entitlementService.capacity(userId, 'requests.active', 'client'),
      'wardrobe.photos.max': await entitlementService.capacity(userId, 'wardrobe.photos.max', 'client'),
    };
  } else {
    capacityMetrics = {
      'offers.active': await entitlementService.capacity(userId, 'offers.active', 'stylist'),
      'feed.priority': await entitlementService.hasFeature(userId, 'feed.priority', 'stylist'),
    };
  }

  return {
    subscription: sub,
    plan: plan || { code: sub.planCode, name: sub.planCode, tier: sub.tier || 'free' },
    entitlements: entitlementsData.entitlements,
    dailyUsage: usageMap,
    capacity: capacityMetrics,
  };
};

/**
 * Subscribes a user to a plan or upgrades an existing subscription.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string} userRole 'client' | 'stylist'
 * @param {Object} subscribeData { planCode, billingCycle, paymobSubscriptionId }
 * @returns {Promise<Object>}
 */
export const subscribe = async (userId, userRole, { planCode, billingCycle = 'monthly', paymobSubscriptionId = null }) => {
  const plan = await planRepository.findByCode(planCode);
  if (!plan) {
    throw new ApiError(404, `Plan '${planCode}' not found`);
  }

  if (plan.role !== userRole) {
    throw new ApiError(403, `Plan '${planCode}' is only available for ${plan.role}s`);
  }

  const now = new Date();
  let currentPeriodEnd = null;

  if (plan.tier !== 'free') {
    const daysToAdd = billingCycle === 'yearly' ? 365 : 30;
    currentPeriodEnd = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  }

  const existing = await subscriptionRepository.findActiveByUserId(userId);

  // A move to a CHEAPER plan is scheduled for the end of the paid period rather than
  // applied now (§E.5). Applying it immediately would strip entitlements the user has
  // already paid for and reset currentPeriodEnd, silently voiding the remainder of their
  // term. Upgrades stay immediate — the user is paying more to get more, now.
  //
  // Price is the comparison, not tier name: it is the thing the user actually paid, and
  // it correctly treats a yearly→monthly move on the same tier as a downgrade too.
  if (existing && existing.currentPeriodEnd && existing.currentPeriodEnd > now) {
    const currentPlan = await planRepository.findByCode(existing.planCode);
    const isDowngrade = currentPlan && plan.priceEgp < currentPlan.priceEgp;

    if (isDowngrade) {
      const scheduled = await subscriptionRepository.updateById(existing._id, {
        pendingPlanCode: plan.code,
        pendingBillingCycle: billingCycle,
        cancelAtPeriodEnd: false,
      });
      return {
        subscription: scheduled,
        scheduled: true,
        effectiveAt: existing.currentPeriodEnd,
        message: `Downgrade to ${plan.name} scheduled. Your current plan stays active until ${existing.currentPeriodEnd.toISOString()}.`,
      };
    }
  }

  let updatedSubscription;
  if (existing) {
    updatedSubscription = await subscriptionRepository.updateById(existing._id, {
      planCode: plan.code,
      billingCycle,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      // An upgrade supersedes any downgrade the user had queued.
      pendingPlanCode: null,
      pendingBillingCycle: null,
      paymobSubscriptionId: paymobSubscriptionId || existing.paymobSubscriptionId,
    });
  } else {
    updatedSubscription = await subscriptionRepository.createSubscription({
      userId,
      planCode: plan.code,
      role: userRole,
      billingCycle,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
      paymobSubscriptionId,
    });
  }

  // Dual-write to ledger if paid plan
  if (plan.priceEgp > 0) {
    try {
      const priceEgp = billingCycle === 'yearly' && plan.priceYearlyEgp ? plan.priceYearlyEgp : plan.priceEgp;
      const amountMinor = ledgerService.egpToPiastres(priceEgp);
      const subIdStr = updatedSubscription._id.toString();

      await ledgerService.postEntry({
        idempotencyKey: `subscription:charge:${subIdStr}:${now.toISOString().split('T')[0]}`,
        entryType: 'SUBSCRIPTION_PAYMENT',
        accountType: 'CLIENT',
        direction: 'DEBIT',
        amountMinor,
        accountId: userId.toString(),
        correlationId: `sub_${subIdStr}`,
        notes: `Subscription payment for ${plan.name} (${billingCycle})`,
      });

      await ledgerService.postEntry({
        idempotencyKey: `subscription:platform:${subIdStr}:${now.toISOString().split('T')[0]}`,
        entryType: 'PLATFORM_FEE',
        accountType: 'PLATFORM',
        direction: 'CREDIT',
        amountMinor,
        correlationId: `sub_${subIdStr}`,
        notes: `Platform subscription revenue for ${plan.name}`,
      });
    } catch (ledgerErr) {
      console.error(`[Ledger Dual-Write Warning] ${ledgerErr.message}`);
    }
  }

  eventBus.emit(EVENTS.SUBSCRIPTION_ACTIVATED, {
    userId: userId.toString(),
    planCode: plan.code,
    billingCycle,
    expiresAt: currentPeriodEnd,
  });

  return updatedSubscription;
};

/**
 * Cancels a paid subscription at the end of its billing period.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<Object>}
 */
export const cancelSubscription = async (userId) => {
  const activeSub = await subscriptionRepository.findActiveByUserId(userId);
  if (!activeSub) {
    throw new ApiError(404, 'No active subscription found');
  }

  if (activeSub.planCode.endsWith('.free')) {
    throw new ApiError(400, 'Free plan cannot be cancelled');
  }

  if (activeSub.cancelAtPeriodEnd) {
    return activeSub; // Already scheduled for cancellation
  }

  const updated = await subscriptionRepository.updateById(activeSub._id, {
    cancelAtPeriodEnd: true,
  });

  eventBus.emit(EVENTS.SUBSCRIPTION_CANCELLED, {
    userId: userId.toString(),
    planCode: activeSub.planCode,
    currentPeriodEnd: activeSub.currentPeriodEnd,
  });

  return updated;
};

/**
 * Initiates a Paymob checkout session for upgrading to a paid subscription plan.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string} userRole 'client' | 'stylist'
 * @param {Object} checkoutData { planCode, billingCycle }
 * @returns {Promise<Object>}
 */
export const checkoutSubscription = async (
  userId,
  userRole,
  { planCode, billingCycle = 'monthly' }
) => {
  const plan = await planRepository.findByCode(planCode);
  if (!plan) {
    throw new ApiError(404, `Plan '${planCode}' not found`);
  }

  if (plan.role !== userRole) {
    throw new ApiError(403, `Plan '${planCode}' is only available for ${plan.role}s`);
  }

  if (plan.priceEgp === 0) {
    throw new ApiError(400, 'Free plan does not require payment checkout. Use /subscribe instead.');
  }

  const user = await userRepository.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const priceEgp =
    billingCycle === 'yearly' && plan.priceYearlyEgp ? plan.priceYearlyEgp : plan.priceEgp;
  const orderId = new mongoose.Types.ObjectId();
  const specialReference = `subord_${orderId.toString()}`;

  const order = await subscriptionOrderRepository.createOrder({
    _id: orderId,
    userId,
    planCode: plan.code,
    billingCycle,
    amountEgp: priceEgp,
    status: 'pending',
    provider: env.NODE_ENV === 'test' ? 'mock' : (env.PAYMENT_PROVIDER || 'paymob'),
    specialReference,
  });

  const provider = getPaymentProvider();
  const initResult = await provider.initialize({
    amount: priceEgp,
    reference: specialReference,
    items: [
      {
        name: `Subscription: ${plan.name}`,
        amount: Math.round(priceEgp * 100),
        description: `${plan.name} (${billingCycle})`,
        quantity: 1,
      },
    ],
    customer: {
      name: user.name || 'User',
      email: user.email || 'customer@example.com',
      phone: user.phone || '+201000000000',
    },
    currency: 'EGP',
    notificationUrl: `${env.API_URL}/api/v1/subscriptions/webhook`,
    redirectionUrl: `${env.CLIENT_URL}/subscriptions/status`,
  });

  await subscriptionOrderRepository.updateById(order._id, {
    providerIntentionId: initResult.providerIntentionId || undefined,
    providerTransactionId: initResult.providerTransactionId || undefined,
  });

  return {
    orderId: order._id.toString(),
    specialReference,
    paymentUrl: initResult.paymentUrl,
    clientSecret: initResult.clientSecret,
    amountEgp: priceEgp,
    plan: {
      code: plan.code,
      name: plan.name,
      tier: plan.tier,
      billingCycle,
    },
  };
};

/**
 * Handles Paymob webhook callback for subscription orders.
 *
 * @param {Object} payload
 * @param {Object} query
 * @returns {Promise<Object>}
 */
export const handleSubscriptionWebhook = async (payload = {}, query = {}) => {
  const provider = getPaymentProvider();
  const result = await provider.handleCallback(payload, query);

  const specialRef = result.bookingId;
  let order = null;
  if (specialRef) {
    order = await subscriptionOrderRepository.findBySpecialReference(specialRef);
  }
  if (!order && result.transactionId) {
    order = await subscriptionOrderRepository.findByTransactionId(result.transactionId);
  }

  if (!order) {
    throw new ApiError(404, 'Subscription order not found for webhook transaction');
  }

  if (order.status === 'paid') {
    return { order, alreadyProcessed: true };
  }

  const isSuccess = result.success || result.status === 'paid';
  if (!isSuccess) {
    const failedOrder = await subscriptionOrderRepository.updateById(order._id, {
      status: 'failed',
      rawCallbackData: result.raw || payload,
    });
    return { order: failedOrder, success: false };
  }

  const plan = await planRepository.findByCode(order.planCode);
  const userRole = plan ? plan.role : 'client';

  const updatedOrder = await subscriptionOrderRepository.updateById(order._id, {
    status: 'paid',
    paidAt: new Date(),
    providerTransactionId: result.transactionId || order.providerTransactionId,
    rawCallbackData: result.raw || payload,
  });

  const updatedSubscription = await subscribe(order.userId, userRole, {
    planCode: order.planCode,
    billingCycle: order.billingCycle,
    paymobSubscriptionId: result.transactionId?.toString() || order.specialReference,
  });

  return { order: updatedOrder, subscription: updatedSubscription, success: true };
};

export default {
  ensureUserSubscription,
  getSubscriptionStatus,
  subscribe,
  checkoutSubscription,
  handleSubscriptionWebhook,
  cancelSubscription,
};
