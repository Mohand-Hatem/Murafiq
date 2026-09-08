import * as subscriptionService from './subscription.service.js';
import * as planRepository from './plan.repository.js';
import * as entitlementService from './entitlement.service.js';

export const getPlans = asyncHandler(async (req, res) => {
  const role = req.query.role || (req.user ? req.user.role : null);

  let plans;
  if (role) {
    plans = await planRepository.findActiveByRole(role);
  } else {
    plans = await planRepository.findAllActive();
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

  return ApiResponse.success(res, {
    message: 'Subscription status retrieved successfully',
    data,
  });
});

export const getMyEntitlements = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.sub || req.user.id;
  const role = req.user.role;

  const entitlementsData = await entitlementService.getEntitlements(userId, role);

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
