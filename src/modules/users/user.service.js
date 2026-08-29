import userRepository from './user.repository.js';
import { toUserProfileDto, toPublicClientDto } from './user.dto.js';
import stylistRepository from '../stylists/stylist.repository.js';
import { toPublicStylistDto } from '../stylists/stylist.dto.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import { ROLES } from '../../common/constants/roles.constant.js';
import { DEFAULT_PROFILE_IMAGE_URL } from '../../common/constants/defaults.constant.js';
import { ACCOUNT_STATUS } from '../../common/constants/statuses.constant.js';
import { invalidate as invalidateTokenVersion } from '../../common/utils/tokenVersionCache.js';
import logger from '../../config/logger.config.js';

export const getProfile = async (userId) => {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }
  return toUserProfileDto(user);
};

export const updateProfile = async (userId, data) => {
  const existingUser = await userRepository.findById(userId);
  if (!existingUser) {
    throw new ApiError(404, 'User not found');
  }

  const { lat, lng, ...restData } = data;
  const updateData = { ...restData };

  if (lat !== undefined && lng !== undefined) {
    updateData.location = {
      type: 'Point',
      coordinates: [lng, lat],
    };
  }

  const updatedUser = await userRepository.updateById(userId, updateData);

  const locationOrAddressUpdated =
    lat !== undefined ||
    lng !== undefined ||
    data.country !== undefined ||
    data.governorate !== undefined ||
    data.city !== undefined ||
    data.area !== undefined;

  if (locationOrAddressUpdated) {
    eventBus.emit(EVENTS.USER_LOCATION_UPDATED, {
      userId: updatedUser._id.toString(),
      location: updatedUser.location,
      country: updatedUser.country,
      governorate: updatedUser.governorate,
      city: updatedUser.city,
      area: updatedUser.area,
    });
  }

  return toUserProfileDto(updatedUser);
};

export const uploadVerificationDocs = async (userId, role, documents) => {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const requiredTypes =
    role === ROLES.STYLIST
      ? [
          'national_id_front',
          'national_id_back',
          'selfie_with_id',
          'police_clearance_certificate',
        ]
      : ['national_id_front', 'national_id_back', 'selfie_with_id'];

  const uploadedTypes = documents.map((doc) => doc.type);
  const missingTypes = requiredTypes.filter((type) => !uploadedTypes.includes(type));

  if (missingTypes.length > 0) {
    throw new ApiError(
      400,
      `Missing required verification documents for role ${role}: ${missingTypes.join(', ')}`
    );
  }

  const formattedDocs = documents.map((doc) => ({
    type: doc.type,
    url: doc.documentRef || doc.url,
    uploadedAt: new Date(),
  }));

  const updatedUser = await userRepository.updateById(userId, {
    'verification.documents': formattedDocs,
    'verification.status': 'pending',
    'verification.rejectionReason': null,
  });

  return toUserProfileDto(updatedUser);
};

export const updateProfileImage = async (userId, profileImage) => {
  const finalImage = profileImage && profileImage.trim() !== '' ? profileImage : DEFAULT_PROFILE_IMAGE_URL;

  const updatedUser = await userRepository.updateById(userId, {
    profileImage: finalImage,
  });

  if (!updatedUser) {
    throw new ApiError(404, 'User not found');
  }

  return toUserProfileDto(updatedUser);
};

export const deleteAccount = async (userId) => {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  await userRepository.softDelete(userId);
};

export const getVerifications = async (queryString) => {
  const { users, meta } = await userRepository.findVerifications(queryString);
  return {
    items: users.map(toUserProfileDto),
    meta,
  };
};

export const approveVerification = async (userId, reviewerId) => {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (user.verification?.status !== 'pending') {
    throw new ApiError(
      409,
      `Cannot approve verification: current status is '${user.verification?.status || 'unverified'}' (only 'pending' can be approved)`
    );
  }

  if (!user.verification?.documents || user.verification.documents.length === 0) {
    throw new ApiError(400, 'Cannot approve verification: user has no submitted documents');
  }

  const updatedUser = await userRepository.updateById(userId, {
    'verification.status': 'verified',
    'verification.reviewedBy': reviewerId,
    'verification.reviewedAt': new Date(),
    'verification.rejectionReason': null,
  });

  eventBus.emit(EVENTS.USER_VERIFIED, {
    userId: user._id.toString(),
    reviewedBy: reviewerId,
    reviewedAt: new Date(),
  });

  return toUserProfileDto(updatedUser);
};

export const rejectVerification = async (userId, reviewerId, rejectionReason) => {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (user.verification?.status !== 'pending') {
    throw new ApiError(
      409,
      `Cannot reject verification: current status is '${user.verification?.status || 'unverified'}' (only 'pending' can be rejected)`
    );
  }

  const updatedUser = await userRepository.updateById(userId, {
    'verification.status': 'rejected',
    'verification.rejectionReason': rejectionReason,
    'verification.reviewedBy': reviewerId,
    'verification.reviewedAt': new Date(),
  });

  eventBus.emit(EVENTS.USER_VERIFICATION_REJECTED, {
    userId: user._id.toString(),
    reviewedBy: reviewerId,
    rejectionReason,
    reviewedAt: new Date(),
  });

  return toUserProfileDto(updatedUser);
};


export const suspendUser = async (userId, adminId, reason) => {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (user.accountStatus === 'suspended') {
    throw new ApiError(409, 'User is already suspended');
  }
  if (user.accountStatus === 'deleted') {
    throw new ApiError(409, 'Cannot suspend a deleted account');
  }

  // Suspension must terminate live sessions, not just block future logins — otherwise
  // a suspended user keeps a working access token for the rest of its 15-minute life.
  const updatedUser = await userRepository.updateById(userId, {
    accountStatus: 'suspended',
    sessions: [], // revoke every device's refresh session
    $inc: { tokenVersion: 1 },
  });
  invalidateTokenVersion(userId);

  eventBus.emit(EVENTS.USER_SUSPENDED, {
    userId: user._id.toString(),
    adminId,
    reason,
  });

  return toUserProfileDto(updatedUser);
};

export const reactivateUser = async (userId, adminId) => {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (user.accountStatus !== 'suspended') {
    throw new ApiError(
      409,
      `Cannot reactivate: current status is '${user.accountStatus}' (only 'suspended' can be reactivated)`
    );
  }

  const updatedUser = await userRepository.updateById(userId, {
    accountStatus: 'active',
  });

  eventBus.emit(EVENTS.USER_REACTIVATED, {
    userId: user._id.toString(),
    adminId,
  });

  return toUserProfileDto(updatedUser);
};

export const blockUser = async (userId, adminId, reason) => {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (user.accountStatus === ACCOUNT_STATUS.BLOCKED) {
    throw new ApiError(409, 'User is already blocked');
  }
  if (user.accountStatus === ACCOUNT_STATUS.DELETED) {
    throw new ApiError(409, 'Cannot block a deleted account');
  }

  // Immediate block terminates live sessions and revokes tokens immediately
  const updatedUser = await userRepository.updateById(userId, {
    accountStatus: ACCOUNT_STATUS.BLOCKED,
    sessions: [], // revoke every device's refresh session
    $inc: { tokenVersion: 1 },
  });
  invalidateTokenVersion(userId);

  // Record PolicyViolation with enforcementAction='BAN'
  try {
    const policyViolationRepository = (await import('../moderation/policy-violation.repository.js')).default;
    await policyViolationRepository.create({
      userId,
      violationType: 'FRAUD',
      severity: 'CRITICAL',
      enforcementAction: 'BAN',
      status: 'ACTIVE',
    });
  } catch (err) {
    logger.error(`Failed to create PolicyViolation on block: ${err.message}`);
  }

  eventBus.emit(EVENTS.USER_SUSPENDED, {
    userId: user._id.toString(),
    adminId,
    reason: reason || 'Account blocked by administrator',
  });

  return toUserProfileDto(updatedUser);
};

export const unblockUser = async (userId, adminId, notes = '') => {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (user.accountStatus !== ACCOUNT_STATUS.BLOCKED) {
    throw new ApiError(
      409,
      `Cannot unblock: current status is '${user.accountStatus}' (only 'blocked' can be unblocked)`
    );
  }

  const updatedUser = await userRepository.updateById(userId, {
    accountStatus: ACCOUNT_STATUS.ACTIVE,
  });
  invalidateTokenVersion(userId);

  eventBus.emit(EVENTS.USER_REACTIVATED, {
    userId: user._id.toString(),
    adminId,
    notes,
  });

  return toUserProfileDto(updatedUser);
};

export const restrictUser = async (userId, _adminId, { durationDays = 7, reason: _reason = 'Policy restriction' } = {}) => {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const chatRestrictedUntil = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
  const updatedUser = await userRepository.updateById(userId, {
    accountStatus: 'restricted',
    chatRestrictedUntil,
    $inc: { tokenVersion: 1 },
  });
  invalidateTokenVersion(userId); // make revocation take effect on the very next request

  return toUserProfileDto(updatedUser);
};

export const unrestrictUser = async (userId, _adminId) => {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const updatedUser = await userRepository.updateById(userId, {
    accountStatus: 'active',
    chatRestrictedUntil: null,
    $inc: { tokenVersion: 1 },
  });
  invalidateTokenVersion(userId); // make revocation take effect on the very next request

  return toUserProfileDto(updatedUser);
};

export const revokeUserSessions = async (userId, _adminId) => {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const updatedUser = await userRepository.updateById(userId, {
    sessions: [], // revoke every device's refresh session
    $inc: { tokenVersion: 1 },
  });
  invalidateTokenVersion(userId); // make revocation take effect on the very next request

  return toUserProfileDto(updatedUser);
};

export const getPublicProfile = async (targetUserId) => {
  const user = await userRepository.findById(targetUserId);
  if (!user || user.isDeleted || user.accountStatus === 'suspended') {
    throw new ApiError(404, 'User not found');
  }

  if (user.role === ROLES.STYLIST) {
    const stylistProfile = await stylistRepository.findByUserId(targetUserId);
    if (!stylistProfile) {
      throw new ApiError(404, 'Stylist profile not found');
    }
    const doc = stylistProfile.toObject ? stylistProfile.toObject() : stylistProfile;
    return toPublicStylistDto({ ...doc, userId: user });
  }

  return toPublicClientDto(user);
};

export const getAllUsers = async (queryString) => {
  const { users, meta } = await userRepository.findAllUsers(queryString);
  return {
    items: users.map(toUserProfileDto),
    meta,
  };
};

export default {
  getProfile,
  getPublicProfile,
  updateProfile,
  uploadVerificationDocs,
  updateProfileImage,
  deleteAccount,
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
};
