import adminService from './admin.service.js';

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

export default {
  getVerifications,
  approveVerification,
  rejectVerification,
};
