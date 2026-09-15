import * as stylePreferenceRepository from './style-preference.repository.js';

/**
 * Retrieves the style preference document for a user.
 * Lazily creates and persists a default preference document on first read if none exists.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<Object>} The user's StylePreference document
 */
export const getPreferences = async (userId) => {
  let preferences = await stylePreferenceRepository.findByUserId(userId);

  if (!preferences) {
    preferences = await stylePreferenceRepository.upsertByUserId(userId, {
      userId,
      favoriteColors: [],
      avoidedColors: [],
      preferredFormality: null,
      sizes: { top: '', bottom: '', shoes: '', outerwear: '' },
      dislikedStyleTags: [],
      modestyPreference: 'standard',
      notes: '',
    });
  }

  return preferences;
};

/**
 * Updates or sets specific style preference fields for a user.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {Object} updateData
 * @returns {Promise<Object>} Updated StylePreference document
 */
export const updatePreferences = async (userId, updateData) => {
  return stylePreferenceRepository.upsertByUserId(userId, updateData);
};

export default {
  getPreferences,
  updatePreferences,
};
