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
  const { planCode, billingCycle, paymobSubscriptionId } = req.body;

  const subscription = await subscriptionService.subscribe(userId, role, {
    planCode,
    billingCycle,
    paymobSubscriptionId,
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

export default {
  getPlans,
  getMySubscription,
  getMyEntitlements,
  subscribe,
  cancel,
};
