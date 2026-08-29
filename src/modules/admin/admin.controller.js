import noShowService from '../bookings/no-show.service.js';
import adminService from './admin.service.js';
import bookingService from '../bookings/booking.service.js';
import ledgerRepository from '../ledger/ledger.repository.js';
import { reconcileLedger } from '../../jobs/ledger-reconciliation.cron.js';

export const getVerifications = asyncHandler(async (req, res) => {
  const { items, meta } = await adminService.getVerifications(req.query);
  return ApiResponse.success(res, {
    message: 'Identity verifications fetched successfully',
    data: items,
    meta,
  });
});

export const approveVerification = asyncHandler(async (req, res) => {
  const updatedUser = await adminService.approveVerification(req.params.userId, req.user.id);
  return ApiResponse.success(res, {
    message: 'Identity verification approved successfully',
    data: updatedUser,
  });
});

export const rejectVerification = asyncHandler(async (req, res) => {
  const updatedUser = await adminService.rejectVerification(
    req.params.userId,
    req.user.id,
    req.body.rejectionReason
  );
  return ApiResponse.success(res, {
    message: 'Identity verification rejected successfully',
    data: updatedUser,
  });
});

export const getDisputedBookings = asyncHandler(async (req, res) => {
  const { items, meta } = await bookingService.getDisputedBookings(req.query);
  return ApiResponse.success(res, {
    message: 'Disputed bookings retrieved successfully',
    data: items,
    meta,
  });
});

export const resolveDispute = asyncHandler(async (req, res) => {
  const adminId = (req.user?._id || req.user?.id || req.user?.sub)?.toString();
  const resolved = await bookingService.resolveDispute(adminId, req.params.id, req.body);
  return ApiResponse.success(res, {
    message: 'Dispute resolved successfully',
    data: resolved,
  });
});

export const suspendUser = asyncHandler(async (req, res) => {
  const updatedUser = await adminService.suspendUser(
    req.params.id,
    req.user.id,
    req.body.reason
  );
  return ApiResponse.success(res, {
    message: 'User account suspended successfully',
    data: updatedUser,
  });
});

export const reactivateUser = asyncHandler(async (req, res) => {
  const updatedUser = await adminService.reactivateUser(req.params.id, req.user.id);
  return ApiResponse.success(res, {
    message: 'User account reactivated successfully',
    data: updatedUser,
  });
});

export const blockUser = asyncHandler(async (req, res) => {
  const updatedUser = await adminService.blockUser(
    req.params.id,
    req.user.id,
    req.body.reason
  );
  return ApiResponse.success(res, {
    message: 'User account blocked successfully',
    data: updatedUser,
  });
});

export const unblockUser = asyncHandler(async (req, res) => {
  const updatedUser = await adminService.unblockUser(
    req.params.id,
    req.user.id,
    req.body?.notes
  );
  return ApiResponse.success(res, {
    message: 'User account unblocked successfully',
    data: updatedUser,
  });
});

export const getAllUsers = asyncHandler(async (req, res) => {
  const { items, meta } = await adminService.getAllUsers(req.query);
  return ApiResponse.success(res, {
    message: 'Users fetched successfully',
    data: items,
    meta,
  });
});

export const restrictUser = asyncHandler(async (req, res) => {
  const updatedUser = await adminService.restrictUser(req.params.id, req.user.id, req.body);
  return ApiResponse.success(res, {
    message: 'User account restricted successfully',
    data: updatedUser,
  });
});

export const unrestrictUser = asyncHandler(async (req, res) => {
  const updatedUser = await adminService.unrestrictUser(req.params.id, req.user.id);
  return ApiResponse.success(res, {
    message: 'User account unrestricted successfully',
    data: updatedUser,
  });
});

export const revokeUserSessions = asyncHandler(async (req, res) => {
  const updatedUser = await adminService.revokeUserSessions(req.params.id, req.user.id);
  return ApiResponse.success(res, {
    message: 'User sessions revoked successfully',
    data: updatedUser,
  });
});

export const getLedgerStatements = asyncHandler(async (req, res) => {
  const { page, limit, entryType, accountType, direction, correlationId, bookingId, subjectId } = req.query;
  const filter = {};
  if (entryType) filter.entryType = entryType;
  if (accountType) filter.accountType = accountType;
  if (direction) filter.direction = direction;
  if (correlationId) filter.correlationId = correlationId;
  if (bookingId) filter.bookingId = bookingId;
  if (subjectId) filter.subjectId = subjectId;

  const result = await ledgerRepository.findEntries(filter, { page, limit });
  return ApiResponse.success(res, {
    message: 'Ledger statements retrieved successfully',
    data: result.items,
    meta: result.meta,
  });
});

export const runLedgerReconciliation = asyncHandler(async (req, res) => {
  const summary = await reconcileLedger();
  return ApiResponse.success(res, {
    message: 'Ledger reconciliation check executed successfully',
    data: summary,
  });
});

export const getDashboardStats = asyncHandler(async (req, res) => {
  const stats = await adminService.getDashboardStats();
  return ApiResponse.success(res, {
    message: 'Dashboard statistics retrieved successfully',
    data: stats,
  });
});

export const resolveNoShow = asyncHandler(async (req, res) => {
  const booking = await noShowService.adminResolveNoShow(req.user, req.params.id, {
    upheld: req.body.upheld,
    notes: req.body.notes,
  });
  return ApiResponse.success(res, {
    message: req.body.upheld
      ? 'No-show upheld — refund, penalty and coupon applied per policy'
      : 'No-show report dismissed — booking restored',
    data: booking,
  });
});

export default {
  resolveNoShow,
  getVerifications,
  getAllUsers,
  approveVerification,
  rejectVerification,
  getDisputedBookings,
  resolveDispute,
  suspendUser,
  reactivateUser,
  blockUser,
  unblockUser,
  restrictUser,
  unrestrictUser,
  revokeUserSessions,
  getLedgerStatements,
  runLedgerReconciliation,
  getDashboardStats,
};

