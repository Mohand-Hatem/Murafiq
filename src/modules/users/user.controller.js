import userService from './user.service.js';

export const getMe = asyncHandler(async (req, res) => {
  const user = await userService.getProfile(req.user.id);
  return ApiResponse.success(res, { message: 'User profile fetched successfully', data: user });
});

export const updateMe = asyncHandler(async (req, res) => {
  const updatedUser = await userService.updateProfile(req.user.id, req.body);
  return ApiResponse.success(res, { message: 'User profile updated successfully', data: updatedUser });
});

export const uploadVerificationDocs = asyncHandler(async (req, res) => {
  const updatedUser = await userService.uploadVerificationDocs(
    req.user.id,
    req.user.role,
    req.body.documents
  );
  return ApiResponse.success(res, {
    message: 'Verification documents uploaded successfully',
    data: updatedUser,
  });
});

export const updateProfileImage = asyncHandler(async (req, res) => {
  const updatedUser = await userService.updateProfileImage(req.user.id, req.body.profileImage);
  return ApiResponse.success(res, { message: 'Profile image updated successfully', data: updatedUser });
});

export const deleteMe = asyncHandler(async (req, res) => {
  await userService.deleteAccount(req.user.id);
  return ApiResponse.success(res, { message: 'Account deleted successfully' });
});

export const getPublicProfile = asyncHandler(async (req, res) => {
  const publicProfile = await userService.getPublicProfile(req.params.id);
  return ApiResponse.success(res, {
    message: 'User public profile fetched successfully',
    data: publicProfile,
  });
});

export default {
  getMe,
  getPublicProfile,
  updateMe,
  uploadVerificationDocs,
  updateProfileImage,
  deleteMe,
};
