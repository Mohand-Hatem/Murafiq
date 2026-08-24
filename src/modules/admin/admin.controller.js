import adminService from './admin.service.js';
import bookingService from '../bookings/booking.service.js';

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
  const resolved = await bookingService.resolveDispute(req.user._id, req.params.id, req.body);
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

export default {
  getVerifications,
  approveVerification,
  rejectVerification,
  getDisputedBookings,
  resolveDispute,
  suspendUser,
  reactivateUser,
};
