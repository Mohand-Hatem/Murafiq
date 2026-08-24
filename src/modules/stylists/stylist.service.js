import stylistRepository from './stylist.repository.js';
import userRepository from '../users/user.repository.js';
import { toPublicStylistDto } from './stylist.dto.js';
import { ROLES } from '../../common/constants/roles.constant.js';

/**
 * Helper to copy location fields from User document to StylistProfile
 */
const copyUserLocationToProfile = (userDoc, profileData) => {
  const country = userDoc.country || null;
  const governorate = userDoc.governorate || null;
  const city = userDoc.city || null;
  const area = userDoc.area || null;
  const location = userDoc.location || { type: 'Point', coordinates: [0, 0] };

  const isRealLocation =
    location.coordinates &&
    Array.isArray(location.coordinates) &&
    (location.coordinates[0] !== 0 || location.coordinates[1] !== 0);

  return {
    ...profileData,
    country,
    governorate,
    city,
    area,
    location,
    locationSet: isRealLocation,
  };
};

export const createProfile = async (userId, role, profileData) => {
  if (role !== ROLES.STYLIST) {
    throw new ApiError(403, 'Only stylists can create a stylist profile');
  }

  const existingProfile = await stylistRepository.findByUserId(userId);
  if (existingProfile) {
    throw new ApiError(409, 'Stylist profile already exists');
  }

  const user = await userRepository.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const dataWithLocation = copyUserLocationToProfile(user, profileData);
  const newProfile = await stylistRepository.create({
    userId,
    ...dataWithLocation,
  });

  return toPublicStylistDto(newProfile);
};

export const updateProfile = async (userId, role, profileData) => {
  if (role !== ROLES.STYLIST) {
    throw new ApiError(403, 'Only stylists can update a stylist profile');
  }

  const user = await userRepository.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const existingProfile = await stylistRepository.findByUserId(userId);
  if (!existingProfile) {
    throw new ApiError(404, 'Stylist profile not found. Create one first.');
  }

  const dataWithLocation = copyUserLocationToProfile(user, profileData);
  const updatedProfile = await stylistRepository.updateByUserId(userId, dataWithLocation);

  return toPublicStylistDto(updatedProfile);
};

export const getPublicProfileById = async (id) => {
  const profile = await stylistRepository.findById(id);
  if (!profile) {
    throw new ApiError(404, 'Stylist profile not found');
  }
  return toPublicStylistDto(profile);
};

export const getOwnProfile = async (userId) => {
  const profile = await stylistRepository.findByUserId(userId);
  if (!profile) {
    throw new ApiError(404, 'Stylist profile not found');
  }
  return toPublicStylistDto(profile);
};

export default {
  createProfile,
  updateProfile,
  getPublicProfileById,
  getOwnProfile,
};
