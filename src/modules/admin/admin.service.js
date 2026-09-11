import userService from '../users/user.service.js';
import userRepository from '../users/user.repository.js';
import bookingRepository from '../bookings/booking.repository.js';
import paymentRepository from '../payments/payment.repository.js';
import subscriptionService from '../subscriptions/subscription.service.js';
import { getBusinessMonthRange } from '../../common/utils/businessDay.util.js';

export const getVerifications = async (queryString) => {
  return userService.getVerifications(queryString);
};

export const approveVerification = async (userId, reviewerId) => {
  return userService.approveVerification(userId, reviewerId);
};

export const rejectVerification = async (userId, reviewerId, rejectionReason) => {
  return userService.rejectVerification(userId, reviewerId, rejectionReason);
};

export const suspendUser = async (userId, adminId, reason) => {
  return userService.suspendUser(userId, adminId, reason);
};

export const reactivateUser = async (userId, adminId) => {
  return userService.reactivateUser(userId, adminId);
};

export const getAllUsers = async (queryString) => {
  return userService.getAllUsers(queryString);
};

export const getDashboardStats = async () => {
  const { startOfMonth, endOfMonth } = getBusinessMonthRange();
  const [users, bookings, revenueThisMonth] = await Promise.all([
    userRepository.getUserStats(),
    bookingRepository.getBookingStats(),
    paymentRepository.getRevenueStatsThisMonth(startOfMonth, endOfMonth),
  ]);

  return {
    users,
    bookings,
    revenueThisMonth,
  };
};

export const restrictUser = async (userId, adminId, data) => {
  return userService.restrictUser(userId, adminId, data);
};

export const unrestrictUser = async (userId, adminId) => {
  return userService.unrestrictUser(userId, adminId);
};

export const revokeUserSessions = async (userId, adminId) => {
  return userService.revokeUserSessions(userId, adminId);
};

export const blockUser = async (userId, adminId, reason) => {
  return userService.blockUser(userId, adminId, reason);
};

export const unblockUser = async (userId, adminId, notes) => {
  return userService.unblockUser(userId, adminId, notes);
};

// --- Manual subscription entitlement (administrative, NOT a customer payment) ---
// Thin delegations, matching how verification and moderation defer to userService:
// subscriptionService owns the Subscription aggregate, so the rules live there and this
// module stays the HTTP-facing admin surface. Note what is absent -- no payment provider,
// no Payment, no SubscriptionOrder, no ledger write.

export const grantSubscription = async (targetUserId, adminId, payload) => {
  return subscriptionService.adminGrantSubscription(targetUserId, adminId, payload);
};

export const getUserSubscription = async (targetUserId) => {
  return subscriptionService.getSubscriptionForAdmin(targetUserId);
};

export const getUserSubscriptionHistory = async (targetUserId, queryString) => {
  return subscriptionService.getSubscriptionHistory(targetUserId, queryString);
};

export default {
  getVerifications,
  getAllUsers,
  approveVerification,
  rejectVerification,
  suspendUser,
  reactivateUser,
  blockUser,
  unblockUser,
  restrictUser,
  unrestrictUser,
  revokeUserSessions,
  getDashboardStats,
  grantSubscription,
  getUserSubscription,
  getUserSubscriptionHistory,
};
