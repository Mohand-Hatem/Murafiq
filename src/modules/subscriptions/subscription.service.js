import mongoose from 'mongoose';
import subscriptionRepository from './subscription.repository.js';
import planRepository from './plan.repository.js';
import subscriptionOrderRepository from './subscription-order.repository.js';
import UsageCounter from './usage-counter.model.js';
import { withTransaction } from '../../common/transaction.util.js';
import * as entitlementService from './entitlement.service.js';
import ledgerService from '../ledger/ledger.service.js';
import userRepository from '../users/user.repository.js';
import { getProvider } from '../payments/providers/provider.factory.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import { getBusinessDayRange } from '../../common/utils/businessDay.util.js';
import ApiError from '../../common/utils/ApiError.js';
import env from '../../config/env.config.js';
import logger from '../../config/logger.config.js';

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
  const defaultPlanCode = role === 'stylist' ? 'stylist.free' : 'client.free';

  // findOrCreate rather than read-then-create: this runs on registration AND on every
  // GET /subscriptions/me, so two concurrent first-time reads could each see "none" and each
  // insert a row. The repository now leans on the partial unique index to settle that race.
  // No SubscriptionHistory row is written here -- nothing is being REPLACED, this is the
  // user's first subscription, and logging it would add a row per registration for no reader.
  return await subscriptionRepository.findOrCreateActiveSubscription({
    userId,
    planCode: defaultPlanCode,
    role: role === 'stylist' ? 'stylist' : 'client',
    billingCycle: 'monthly',
    status: 'active',
    currentPeriodStart: new Date(),
    currentPeriodEnd: null, // Free plan never expires
    cancelAtPeriodEnd: false,
    source: 'free_default',
  });
};

/**
 * THE single primitive that puts a plan live on a user's subscription.
 *
 * Every path that grants entitlements goes through here -- the Paymob webhook via subscribe(),
 * and the admin manual grant via adminService.grantSubscription(). That is the whole point:
 * an admin-granted Premium and a paid Premium must produce byte-identical entitlement state,
 * and the only way to guarantee that is for both to write it with the same code. What differs
 * between them is `source` (provenance) and what the CALLER does around this call -- the paid
 * path posts ledger entries, the admin path deliberately posts none.
 *
 * Snapshots the state being replaced into SubscriptionHistory before overwriting it, so the
 * previous plan survives the in-place update.
 *
 * @param {Object} params
 * @param {string|import('mongoose').Types.ObjectId} params.userId
 * @param {'client'|'stylist'} params.role
 * @param {Object} params.plan resolved Plan document
 * @param {'monthly'|'yearly'} [params.billingCycle]
 * @param {number} params.periodDays length of the granted period, ignored for a free-tier plan
 * @param {'free_default'|'paid'|'admin_grant'} params.source
 * @param {string} params.changeType SubscriptionHistory changeType
 * @param {string|import('mongoose').Types.ObjectId|null} [params.grantedBy]
 * @param {string|null} [params.changeReason]
 * @param {string|null} [params.paymobSubscriptionId]
 * @param {import('mongoose').ClientSession} [session]
 * @returns {Promise<Object>} the live Subscription document
 */
export const applyPlanGrant = async (
  {
    userId,
    role,
    plan,
    billingCycle = 'monthly',
    periodDays,
    source,
    changeType,
    grantedBy = null,
    changeReason = null,
    paymobSubscriptionId = null,
  },
  session = null
) => {
  const now = new Date();

  // A free tier never expires -- `null` is the load-bearing signal findExpiringSubscriptions
  // filters on. An explicit duration cannot override that: granting "90 days of Free" would
  // put a row in the expiry sweep that the sweep then has nothing to downgrade it to.
  const currentPeriodEnd =
    plan.tier === 'free' ? null : new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000);

  const existing = await subscriptionRepository.findActiveByUserId(userId, session);

  const nextState = {
    planCode: plan.code,
    billingCycle,
    status: 'active',
    currentPeriodStart: now,
    currentPeriodEnd,
    cancelAtPeriodEnd: false,
    // A grant supersedes any downgrade the user had queued -- they have just been moved
    // somewhere deliberately, and silently applying a stale pending plan at period end
    // would undo that.
    pendingPlanCode: null,
    pendingBillingCycle: null,
    source,
    grantedBy: source === 'admin_grant' ? grantedBy : null,
    grantReason: source === 'admin_grant' ? changeReason : null,
  };

  // Logged for BOTH branches. A grant to a user who has no subscription row yet is still a
  // real transition -- it is how an admin comps a brand-new account -- and the previous* fields
  // are nullable precisely so that case can be recorded rather than silently skipped. (The
  // implicit free-tier provisioning in ensureUserSubscription is the one thing that writes no
  // history, because it replaces nothing and would add a row per registration.)
  await subscriptionRepository.createHistoryEntry(
    {
      userId,
      subscriptionId: existing ? existing._id : null,
      changeType,
      previousPlanCode: existing ? existing.planCode : null,
      previousBillingCycle: existing ? existing.billingCycle : null,
      previousStatus: existing ? existing.status : null,
      previousSource: existing ? existing.source || null : null,
      previousPeriodStart: existing ? existing.currentPeriodStart : null,
      previousPeriodEnd: existing ? existing.currentPeriodEnd : null,
      newPlanCode: plan.code,
      newBillingCycle: billingCycle,
      newSource: source,
      newPeriodStart: now,
      newPeriodEnd: currentPeriodEnd,
      changedBy: grantedBy,
      changeReason,
    },
    session
  );

  let subscription;
  if (existing) {
    subscription = await subscriptionRepository.replaceActivePlanCAS(
      existing._id,
      {
        ...nextState,
        paymobSubscriptionId: paymobSubscriptionId || existing.paymobSubscriptionId,
      },
      session
    );

    // The CAS matched nothing: the row stopped being 'active' between the read above and the
    // write. Surfacing it beats writing a second active row and leaving findActiveByUserId to
    // pick between them.
    if (!subscription) {
      throw new ApiError(409, 'Subscription was modified concurrently. Please retry the operation.');
    }
  } else {
    subscription = await subscriptionRepository.createSubscription(
      {
        userId,
        role,
        paymobSubscriptionId,
        ...nextState,
      },
      session
    );
  }

  return subscription;
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

  // A priced plan that got past the guard above was genuinely paid for; anything else reaching
  // here is a free-tier switch the user made themselves via POST /subscribe.
  const isPaidTransition = paid && plan.priceEgp > 0;

  const grantArgs = {
    userId,
    role: userRole,
    plan,
    billingCycle,
    periodDays,
    source: isPaidTransition ? 'paid' : 'free_default',
    changeType: isPaidTransition ? 'paid' : 'self_service',
    changeReason: isPaidTransition
      ? `Paid subscription${orderId ? ` (order ${orderId.toString()})` : ''}`
      : 'Self-service plan change',
    paymobSubscriptionId,
  };

  // The SubscriptionHistory snapshot and the plan replacement must land together, exactly
  // like adminGrantSubscription() below already does -- a snapshot without the replacement
  // invents a transition that never happened, and a replacement without the snapshot
  // destroys the plan it overwrote. This path (the one a real customer payment goes
  // through) previously called applyPlanGrant with no session at all, so the two writes
  // were never atomic here even though the identical admin path was already wrapped. See
  // docs/AUDIT_2026_09_FULL_SYSTEM.md finding X14.
  let updatedSubscription;
  await withTransaction(async (session) => {
    updatedSubscription = await applyPlanGrant(grantArgs, session);

    // Dual-write to the ledger ONLY for a payment that actually happened. This block used to
    // run for any paid plan regardless of whether money was collected, so the free-grant path
    // above minted matching DEBIT/CREDIT entries out of nothing -- and because they balanced,
    // the reconciliation job saw a healthy book and never alerted.
    // Task S4.1 (B6): fail-closed atomic pair inside transaction
    if (paid && plan.priceEgp > 0) {
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

      await ledgerService.postDoubleEntry(
        {
          idempotencyKey: `subscription:charge:${entryScope}`,
          entryType: 'SUBSCRIPTION_PAYMENT',
          accountType: 'CLIENT',
          amountMinor,
          accountId: userId.toString(),
          correlationId: `sub_${subIdStr}`,
          notes: `Subscription payment for ${plan.name} (${billingCycle})`,
        },
        {
          idempotencyKey: `subscription:platform:${entryScope}`,
          entryType: 'PLATFORM_FEE',
          accountType: 'PLATFORM',
          amountMinor,
          correlationId: `sub_${subIdStr}`,
          notes: `Platform subscription revenue for ${plan.name}`,
        },
        session
      );
    }
  });

  eventBus.emit(EVENTS.SUBSCRIPTION_ACTIVATED, {
    userId: userId.toString(),
    planCode: plan.code,
    billingCycle,
    // Read off the persisted document rather than a local: applyPlanGrant owns the period
    // arithmetic (including forcing null for a free tier), so this is the only value that is
    // guaranteed to match what was actually written.
    expiresAt: updatedSubscription.currentPeriodEnd,
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

  // 'cancellation' was a declared SubscriptionHistory changeType with zero writers (see
  // docs/AUDIT_2026_09_FULL_SYSTEM.md finding X15). The plan itself does not change here
  // -- the user keeps what they paid for until currentPeriodEnd -- so previous* and new*
  // are identical; what this row records is the moment the cancellation intent itself was
  // set, which the eventual expiry_sweep entry alone cannot answer ("did they cancel, or
  // did it just lapse?").
  try {
    await subscriptionRepository.createHistoryEntry({
      userId,
      subscriptionId: activeSub._id,
      changeType: 'cancellation',
      previousPlanCode: activeSub.planCode,
      previousBillingCycle: activeSub.billingCycle,
      previousStatus: activeSub.status,
      previousSource: activeSub.source || null,
      previousPeriodStart: activeSub.currentPeriodStart,
      previousPeriodEnd: activeSub.currentPeriodEnd,
      newPlanCode: activeSub.planCode,
      newBillingCycle: activeSub.billingCycle,
      newSource: activeSub.source || null,
      newPeriodStart: activeSub.currentPeriodStart,
      newPeriodEnd: activeSub.currentPeriodEnd,
      changedBy: userId,
      changeReason: 'User cancelled — plan stays active until the current period ends',
    });
  } catch (historyErr) {
    logger.error(`Failed to record subscription history for ${activeSub._id}: ${historyErr.message}`);
  }

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

  // CAS-claim the order into 'processing' BEFORE granting anything and BEFORE marking it
  // 'paid'. Two problems this fixes together (docs/AUDIT_2026_09_FULL_SYSTEM.md finding
  // X5): (1) the order used to be marked 'paid' first, so if subscribe() then threw --
  // a lost CAS in applyPlanGrant, a missing plan, any validation error -- the customer
  // was charged, received no entitlement and no ledger entry, and Paymob's retry hit the
  // `status === 'paid'` early-return above and never tried the grant again. Reverting to
  // 'pending' on failure (below) means a retry can actually retry. (2) a bare updateById
  // let two concurrent deliveries of the same webhook both proceed past the earlier
  // `status === 'paid'` check and both call subscribe(); the 'pending' → 'processing'
  // guard here means only one delivery can ever claim the order.
  const claimed = await subscriptionOrderRepository.transitionStatus(order._id, 'pending', {
    status: 'processing',
    providerTransactionId: result.transactionId || order.providerTransactionId,
    rawCallbackData: result.raw || payload,
  });
  if (!claimed) {
    // Lost the race to another delivery of this same webhook, or the order moved on to
    // 'failed' in between our read and this write. Re-read and report the true state
    // rather than attempting a grant a concurrent call may already be applying.
    const current = await subscriptionOrderRepository.findById(order._id);
    if (current?.status === 'paid') {
      return { order: current, alreadyProcessed: true };
    }
    throw new ApiError(409, 'This subscription order is already being processed.');
  }

  let updatedSubscription;
  try {
    updatedSubscription = await subscribe(order.userId, userRole, {
      planCode: order.planCode,
      billingCycle: order.billingCycle,
      paymobSubscriptionId: result.transactionId?.toString() || order.specialReference,
      orderId: order._id,
      chargedAmountEgp: order.amountEgp,
      paid: true,
    });
  } catch (grantErr) {
    // Revert to 'pending', NOT 'failed' -- the payment itself succeeded (the HMAC
    // verified and Paymob confirmed success); only applying the entitlement failed. A
    // provider retry of this same webhook must be able to try the grant again, which
    // requires the order to still look unprocessed.
    await subscriptionOrderRepository.transitionStatus(order._id, 'processing', {
      status: 'pending',
    });
    logger.error(
      `Subscription grant failed for paid order ${order._id}; reverted to 'pending' for retry: ${grantErr.message}`
    );
    throw grantErr;
  }

  // `paid` is set here and nowhere else, only after the grant has actually succeeded.
  const updatedOrder = await subscriptionOrderRepository.transitionStatus(order._id, 'processing', {
    status: 'paid',
    paidAt: new Date(),
  });

  return { order: updatedOrder, subscription: updatedSubscription, success: true };
};

/**
 * Administrative plan grant. NOT a payment.
 *
 * This is a manual entitlement operation: an admin comps, corrects or revokes a plan directly.
 * It deliberately creates NO Payment, NO SubscriptionOrder and NO LedgerEntry, and never calls
 * the payment provider -- there is no money to record, and minting balanced ledger rows for a
 * grant would book revenue that was never collected while still reconciling cleanly, so nothing
 * would ever alert. (Same trap the `paid && plan.priceEgp > 0` guard in subscribe() exists to
 * avoid.) Provenance is carried on the Subscription itself via source:'admin_grant'.
 *
 * The grant REPLACES the current period outright rather than stacking onto it: an admin action
 * is corrective, and the replaced period is preserved in SubscriptionHistory. Downgrades and
 * revocations (a `*.free` target) run through this same path and apply IMMEDIATELY -- the
 * customer-facing scheduled-downgrade rule in subscribe() is a billing courtesy to someone who
 * paid, which is not what is happening here.
 *
 * @param {string|import('mongoose').Types.ObjectId} targetUserId
 * @param {string|import('mongoose').Types.ObjectId} adminId
 * @param {Object} payload
 * @param {string} payload.planCode
 * @param {'monthly'|'yearly'} [payload.billingCycle]
 * @param {number|null} [payload.durationDays] overrides the plan's own cycle length
 * @param {string} payload.reason
 * @returns {Promise<{ subscription: Object, plan: Object, previousPlanCode: string|null }>}
 */
export const adminGrantSubscription = async (
  targetUserId,
  adminId,
  { planCode, billingCycle = 'monthly', durationDays = null, reason }
) => {
  const targetUser = await userRepository.findById(targetUserId);
  if (!targetUser) {
    throw new ApiError(404, 'Target user not found');
  }

  // Admins and operators have no plan catalogue -- entitlements are a client/stylist concept.
  // Granting one a plan would write a Subscription whose `role` enum rejects the value anyway;
  // failing here says why instead of surfacing a ValidationError.
  if (targetUser.role !== 'client' && targetUser.role !== 'stylist') {
    throw new ApiError(
      400,
      `Subscriptions apply to clients and stylists only — '${targetUser.role}' accounts have no plan.`
    );
  }

  const plan = await planRepository.findByCode(planCode);
  if (!plan) {
    throwPlanNotFound(planCode);
  }

  // Same cross-role guard the customer paths enforce. Without it an admin could put a stylist
  // on a client plan, and entitlementService would then hand them a client entitlement map --
  // silently wrong limits rather than a visible error.
  if (plan.role !== targetUser.role) {
    throw new ApiError(
      400,
      `Plan '${plan.code}' is a ${plan.role} plan and cannot be granted to a ${targetUser.role}.`
    );
  }

  let periodDays;
  if (durationDays !== null && durationDays !== undefined) {
    periodDays = durationDays;
  } else {
    // Reuses the paid path's resolver, so "one month of Pro" granted by an admin is exactly as
    // long as a purchased month, and an incoherent cycle (yearly against a plan with no yearly
    // variant) is refused here rather than silently granting a monthly-length "year".
    ({ periodDays } = resolvePlanPricing(plan, billingCycle));
  }

  const existing = await subscriptionRepository.findActiveByUserId(targetUserId);
  const previousPlanCode = existing ? existing.planCode : null;

  const grantArgs = {
    userId: targetUserId,
    role: targetUser.role,
    plan,
    billingCycle,
    periodDays,
    source: 'admin_grant',
    changeType: 'admin_grant',
    grantedBy: adminId,
    changeReason: reason,
  };

  // The history snapshot and the plan replacement must land together: a snapshot without the
  // replacement invents a transition that never happened, and a replacement without the
  // snapshot destroys the plan it overwrote.
  let subscription;
  await withTransaction(async (session) => {
    subscription = await applyPlanGrant(grantArgs, session);
  });

  // Deliberately NOT SUBSCRIPTION_ACTIVATED: that event means a customer paid, and the audit
  // trail must keep a comp distinguishable from revenue.
  eventBus.emit(EVENTS.SUBSCRIPTION_ADMIN_GRANTED, {
    userId: targetUserId.toString(),
    adminId: adminId ? adminId.toString() : null,
    planCode: plan.code,
    previousPlanCode,
    billingCycle,
    durationDays: periodDays,
    expiresAt: subscription.currentPeriodEnd,
    reason,
  });

  return { subscription, plan, previousPlanCode };
};

/**
 * Full subscription state for an arbitrary user, for admin review. Resolves the user's role
 * itself so a caller cannot read a client's subscription through a stylist entitlement map.
 *
 * @param {string|import('mongoose').Types.ObjectId} targetUserId
 * @returns {Promise<Object>}
 */
export const getSubscriptionForAdmin = async (targetUserId) => {
  const targetUser = await userRepository.findById(targetUserId);
  if (!targetUser) {
    throw new ApiError(404, 'Target user not found');
  }

  return await getSubscriptionStatus(targetUser._id, targetUser.role);
};

/**
 * Paginated plan-transition history for a user.
 *
 * @param {string|import('mongoose').Types.ObjectId} targetUserId
 * @param {Object} [queryString]
 * @returns {Promise<{ items: Array, meta: Object }>}
 */
export const getSubscriptionHistory = async (targetUserId, queryString = {}) => {
  const targetUser = await userRepository.findById(targetUserId);
  if (!targetUser) {
    throw new ApiError(404, 'Target user not found');
  }

  return await subscriptionRepository.findHistoryByUserId(targetUser._id, queryString);
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
  applyPlanGrant,
  getSubscriptionStatus,
  subscribe,
  checkoutSubscription,
  handleSubscriptionWebhook,
  cancelSubscription,
  getOrderStatus,
  resolvePlanPricing,
  adminGrantSubscription,
  getSubscriptionForAdmin,
  getSubscriptionHistory,
};
