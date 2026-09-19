import * as outfitRepository from './outfit.repository.js';

export const recordOutfit = async (data) => {
  return outfitRepository.createOutfit(data);
};

export const getOutfitById = async (id, userId) => {
  const outfit = await outfitRepository.findById(id);
  if (!outfit) {
    return null;
  }
  if (userId && outfit.userId.toString() !== userId.toString()) {
    return null;
  }
  return outfit;
};

export const getUserOutfits = async (userId, options = {}) => {
  const [items, total] = await Promise.all([
    outfitRepository.findByUserId(userId, options),
    outfitRepository.countByUserId(userId),
  ]);
  return { items, total };
};

export const setUserFeedback = async (id, userId, feedback) => {
  const allowed = ['liked', 'disliked', null];
  if (!allowed.includes(feedback)) {
    throw new Error(`Invalid feedback value: ${feedback}. Must be 'liked', 'disliked', or null.`);
  }
  return outfitRepository.updateFeedback(id, userId, feedback);
};

export default {
  recordOutfit,
  getOutfitById,
  getUserOutfits,
  setUserFeedback,
};
