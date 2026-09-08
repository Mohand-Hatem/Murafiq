import mongoose from 'mongoose';
import subscriptionRepository from './subscription.repository.js';
import planRepository from './plan.repository.js';
import subscriptionOrderRepository from './subscription-order.repository.js';
import UsageCounter from './usage-counter.model.js';
import * as entitlementService from './entitlement.service.js';
import ledgerService from '../ledger/ledger.service.js';
import userRepository from '../users/user.repository.js';
import { getProvider } from '../payments/providers/provider.factory.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import { getBusinessDayRange } from '../../common/utils/businessDay.util.js';
import ApiError from '../../common/utils/ApiError.js';
import env from '../../config/env.config.js';

// Billing period lengths. Yearly is a single up-front charge, not 12 instalments --
// Paymob recurring billing is not integrated.
const PERIOD_DAYS = { monthly: 30, yearly: 365 };

/**
 * Raises the 404 for an unknown plan code, naming the replacement when the caller is using
 * the previous catalogue shape.
 *
 * Yearly used to be a SEPARATE plan document (`client.pro.yearly`). Collapsing that into a
 * second price on the parent row retired those codes, so an old Postman collection, a cached
 * mobile build, or the previous docs now hit a bare "not found" for a call that worked last
 * week. Saying what to send instead costs one branch and saves the reader a bug hunt.
 *
 * @param {string} planCode
 * @throws {ApiError} always -- 404
 */
const throwPlanNotFound = (planCode) => {
  if (planCode.endsWith('.yearly')) {
    const parent = planCode.replace(/\.yearly$/, '');
    throw new ApiError(
      404,
      `Plan '${planCode}' no longer exists. Yearly is now a billing cycle, not a plan code — ` +
        `send { "planCode": "${parent}", "billingCycle": "yearly" } instead.`
    );
  }
  throw new ApiError(404, `Plan '${planCode}' not found`);
};

/**
 * Resolves the price and period length for a plan + billing cycle.
 *
 * THE single source of truth for both. subscribe() and checkoutSubscription() previously
 * each derived these independently, and disagreed: checkout quoted one amount while
 * subscribe granted a period computed from an unrelated field. Anything that charges or
 * grants must come through here so the two can never drift again.
 *
 * @param {Object} plan
 * @param {'monthly'|'yearly'} billingCycle
 * @returns {{ priceEgp: number, periodDays: number }}
 */
export const resolvePlanPricing = (plan, billingCycle = 'monthly') => {
  const cycle = billingCycle === 'yearly' ? 'yearly' : 'monthly';

  if (cycle === 'yearly') {
    // Never fall back to the monthly price here. That fallback is precisely what charged
    // a yearly buyer 250 EGP for 365 days of a 2,900 EGP plan.
    if (plan.priceYearlyEgp === null || plan.priceYearlyEgp === undefined) {
      throw new ApiError(400, `Plan '${plan.code}' has no yearly billing option`);
    }
    return { priceEgp: plan.priceYearlyEgp, periodDays: PERIOD_DAYS.yearly };
  }

  return { priceEgp: plan.priceEgp, periodDays: PERIOD_DAYS.monthly };
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
export const subscribe = async (
  userId,
  userRole,
  {
    planCode,
    billingCycle = 'monthly',
    paymobSubscriptionId = null,
    orderId = null,
    chargedAmountEgp = null,
    paid = false,
  }
) => {
  const plan = await planRepository.findByCode(planCode);
  if (!plan) {
    throwPlanNotFound(planCode);
  }

  if (plan.role !== userRole) {
    throw new ApiError(403, `Plan '${planCode}' is only available for ${plan.role}s`);
  }

  const now = new Date();
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

  // Everything below GRANTS a plan immediately, so from here on money must have changed
  // hands. The guard sits after the downgrade branch on purpose: scheduling a downgrade
  // hands the user nothing today -- it only records a choice that the renewal sweep applies
  // once the period they already paid for runs out -- so requiring a payment for it would
  // trap a paying subscriber on the more expensive plan.
  //
  // /subscribe reaches here with paid=false and is refused for anything priced. Only
  // handleSubscriptionWebhook sets paid=true, and only after the provider HMAC verified.
  if (plan.priceEgp > 0 && !paid) {
    throw new ApiError(
      402,
      `Plan '${plan.code}' requires payment. Start a checkout with POST /api/v1/subscriptions/checkout.`
    );
  }

  const { periodDays } = resolvePlanPricing(plan, billingCycle);

  let currentPeriodEnd = null;
  if (plan.tier !== 'free') {
    currentPeriodEnd = new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000);
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

  // Dual-write to the ledger ONLY for a payment that actually happened. This block used to
  // run for any paid plan regardless of whether money was collected, so the free-grant path
  // above minted matching DEBIT/CREDIT entries out of nothing -- and because they balanced,
  // the reconciliation job saw a healthy book and never alerted.
  if (paid && plan.priceEgp > 0) {
    try {
      // Record what the customer was ACTUALLY charged, captured on the order at checkout --
      // not a price re-derived now. A catalogue edit between checkout and webhook would
      // otherwise book revenue the customer never paid.
      const { priceEgp: listPrice } = resolvePlanPricing(plan, billingCycle);
      const priceEgp = chargedAmountEgp === null ? listPrice : chargedAmountEgp;
      const amountMinor = ledgerService.egpToPiastres(priceEgp);
      const subIdStr = updatedSubscription._id.toString();
      // Key on the order, not the calendar day: a same-day second purchase (upgrade, or a
      // retry after a failed charge) collided on the date-scoped key and was silently dropped.
      const entryScope = orderId ? orderId.toString() : subIdStr;

      await ledgerService.postEntry({
        idempotencyKey: `subscription:charge:${entryScope}`,
        entryType: 'SUBSCRIPTION_PAYMENT',
        accountType: 'CLIENT',
        direction: 'DEBIT',
        amountMinor,
        accountId: userId.toString(),
        correlationId: `sub_${subIdStr}`,
        notes: `Subscription payment for ${plan.name} (${billingCycle})`,
      });

      await ledgerService.postEntry({
        idempotencyKey: `subscription:platform:${entryScope}`,
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
    throwPlanNotFound(planCode);
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

  // Same resolver subscribe() uses, so the amount quoted here is by construction the amount
  // the granted period is worth.
  const { priceEgp } = resolvePlanPricing(plan, billingCycle);
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

  const provider = getProvider();
  const initResult = await provider.initialize({
    amount: priceEgp,
    reference: specialReference,
    items: [
      {
        name: `Upgrade Subscription to ${plan.name}`,
        amount: Math.round(priceEgp * 100),
        description: `Murafiq ${plan.role === 'stylist' ? 'Stylist' : 'Client'} Subscription (${billingCycle})`,
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
  const provider = getProvider();
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

  // `paid: true` is set here and nowhere else: the HMAC has been verified by the provider
  // and the order is now marked paid, so this is the one call site that can prove money
  // arrived. orderId scopes the ledger idempotency keys to this specific purchase.
  const updatedSubscription = await subscribe(order.userId, userRole, {
    planCode: order.planCode,
    billingCycle: order.billingCycle,
    paymobSubscriptionId: result.transactionId?.toString() || order.specialReference,
    orderId: order._id,
    chargedAmountEgp: order.amountEgp,
    paid: true,
  });

  return { order: updatedOrder, subscription: updatedSubscription, success: true };
};

/**
 * Reads back a single subscription order for its owner.
 *
 * This is the closing step of the checkout cycle. Paymob redirects the browser to a FRONTEND
 * URL, so the backend never sees the return leg -- without this the app has no way to ask
 * whether the payment landed. Returns a deliberately narrow projection: the raw callback
 * payload on the order carries the masked PAN and provider source data.
 *
 * @param {string|import('mongoose').Types.ObjectId} orderId
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<Object>}
 */
export const getOrderStatus = async (orderId, userId) => {
  const order = await subscriptionOrderRepository.findById(orderId);
  if (!order) {
    throw new ApiError(404, 'Subscription order not found');
  }

  if (order.userId.toString() !== userId.toString()) {
    throw new ApiError(403, 'You do not have access to this subscription order');
  }

  return {
    orderId: order._id.toString(),
    status: order.status,
    planCode: order.planCode,
    billingCycle: order.billingCycle,
    amountEgp: order.amountEgp,
    paidAt: order.paidAt || null,
  };
};

export default {
  ensureUserSubscription,
  getSubscriptionStatus,
  subscribe,
  checkoutSubscription,
  handleSubscriptionWebhook,
  cancelSubscription,
  getOrderStatus,
  resolvePlanPricing,
};
