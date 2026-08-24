import userService from '../users/user.service.js';
import userRepository from '../users/user.repository.js';
import bookingRepository from '../bookings/booking.repository.js';
import paymentRepository from '../payments/payment.repository.js';
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

export default {
  getVerifications,
  getAllUsers,
  approveVerification,
  rejectVerification,
  suspendUser,
  reactivateUser,
  getDashboardStats,
};
