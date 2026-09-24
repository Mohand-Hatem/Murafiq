import * as subscriptionService from './subscription.service.js';
import * as planRepository from './plan.repository.js';
import * as entitlementService from './entitlement.service.js';
import { FALLBACK_FREE_ENTITLEMENTS } from './plan.constants.js';

export const getPlans = asyncHandler(async (req, res) => {
  const role = req.query.role || (req.user ? req.user.role : null);

  let plans;
  if (role) {
    plans = await planRepository.findActiveByRole(role);
  } else {
    plans = await planRepository.findAllActive();
  }

  const isDemo = req.bookingMode === 'demo' || req.baseUrl?.startsWith('/api/demo');
  if (isDemo) {
    plans = plans.filter((p) => p.tier === 'free' || p.priceEgp === 0);
  }

  return ApiResponse.success(res, {
    message: 'Subscription plans retrieved successfully',
    data: { plans },
  });
});

export const getMySubscription = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.sub || req.user.id;
  const role = req.user.role;

  const data = await subscriptionService.getSubscriptionStatus(userId, role);
  const isDemo = req.bookingMode === 'demo' || req.baseUrl?.startsWith('/api/demo');

  if (isDemo && data?.subscription && data.subscription.planCode !== `${role}.free`) {
    const defaultCode = role === 'stylist' ? 'stylist.free' : 'client.free';
    const freePlan = await planRepository.findByCode(defaultCode);
    const subObj = data.subscription.toObject ? data.subscription.toObject() : { ...data.subscription };
    subObj.planCode = defaultCode;
    subObj.currentPeriodEnd = null;
    data.subscription = subObj;
    if (freePlan) {
      data.plan = freePlan;
      data.entitlements =
        freePlan.entitlements instanceof Map
          ? Object.fromEntries(freePlan.entitlements)
          : freePlan.entitlements || FALLBACK_FREE_ENTITLEMENTS[role] || {};
    }
  }

  return ApiResponse.success(res, {
    message: 'Subscription status retrieved successfully',
    data,
  });
});

export const getMyEntitlements = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.sub || req.user.id;
  const role = req.user.role;

  const isDemo = req.bookingMode === 'demo' || req.baseUrl?.startsWith('/api/demo');
  let entitlementsData;

  if (isDemo) {
    const defaultCode = role === 'stylist' ? 'stylist.free' : 'client.free';
    const plan = await planRepository.findByCode(defaultCode);
    const entitlementsMap =
      plan?.entitlements instanceof Map
        ? Object.fromEntries(plan.entitlements)
        : plan?.entitlements || FALLBACK_FREE_ENTITLEMENTS[role] || {};

    entitlementsData = {
      planCode: defaultCode,
      tier: 'free',
      entitlements: entitlementsMap,
    };
  } else {
    entitlementsData = await entitlementService.getEntitlements(userId, role);
  }

  return ApiResponse.success(res, {
    message: 'Entitlements retrieved successfully',
    data: entitlementsData,
  });
});

export const subscribe = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.sub || req.user.id;
  const role = req.user.role;
  const { planCode, billingCycle } = req.body;

  // `paid` is deliberately not forwarded from the request. This route never collects money,
  // so the service refuses any plan with a price and points the caller at /checkout.
  const subscription = await subscriptionService.subscribe(userId, role, {
    planCode,
    billingCycle,
  });

  return ApiResponse.success(res, {
    message: 'Subscribed successfully',
    data: { subscription },
  });
});

export const cancel = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.sub || req.user.id;

  const subscription = await subscriptionService.cancelSubscription(userId);

  return ApiResponse.success(res, {
    message: 'Subscription scheduled for cancellation at period end',
    data: { subscription },
  });
});

export const checkout = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.sub || req.user.id;
  const role = req.user.role;
  const { planCode, billingCycle } = req.body;

  const result = await subscriptionService.checkoutSubscription(userId, role, {
    planCode,
    billingCycle,
  });

  return ApiResponse.success(res, {
    message: 'Subscription checkout initiated successfully',
    data: result,
  });
});

export const webhook = asyncHandler(async (req, res) => {
  const result = await subscriptionService.handleSubscriptionWebhook(req.body, req.query);

  // Acknowledge only. The previous response echoed the whole order, including
  // rawCallbackData -- the provider's payload, which carries the masked PAN and source_data.
  // Paymob ignores the body, so there is nothing to gain by returning it.
  return ApiResponse.success(res, {
    message: 'Subscription webhook processed successfully',
    data: {
      received: true,
      status: result.order?.status ?? 'unknown',
      alreadyProcessed: Boolean(result.alreadyProcessed),
    },
  });
});

export const getOrderStatus = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.sub || req.user.id;

  const order = await subscriptionService.getOrderStatus(req.params.orderId, userId);

  return ApiResponse.success(res, {
    message: 'Subscription order status retrieved successfully',
    data: { order },
  });
});

export default {
  getPlans,
  getMySubscription,
  getMyEntitlements,
  subscribe,
  checkout,
  webhook,
  cancel,
  getOrderStatus,
};
