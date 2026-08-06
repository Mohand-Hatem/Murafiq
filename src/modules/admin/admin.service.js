import userService from '../users/user.service.js';

export const getVerifications = async (queryString) => {
  return userService.getVerifications(queryString);
};

export const approveVerification = async (userId, reviewerId) => {
  return userService.approveVerification(userId, reviewerId);
};

export const rejectVerification = async (userId, reviewerId, rejectionReason) => {
  return userService.rejectVerification(userId, reviewerId, rejectionReason);
};

export default {
  getVerifications,
  approveVerification,
  rejectVerification,
};
