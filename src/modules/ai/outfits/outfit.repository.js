import Outfit from './outfit.model.js';

export const createOutfit = async (data) => {
  return Outfit.create(data);
};

export const findById = async (id) => {
  return Outfit.findById(id);
};

export const findByUserId = async (userId, { limit = 20, skip = 0 } = {}) => {
  return Outfit.find({ userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

export const countByUserId = async (userId) => {
  return Outfit.countDocuments({ userId });
};

export const updateFeedback = async (id, userId, feedback) => {
  return Outfit.findOneAndUpdate(
    { _id: id, userId },
    { $set: { userFeedback: feedback } },
    { returnDocument: 'after', runValidators: true }
  );
};

export const deleteById = async (id, userId) => {
  return Outfit.findOneAndDelete({ _id: id, userId });
};

export default {
  createOutfit,
  findById,
  findByUserId,
  countByUserId,
  updateFeedback,
  deleteById,
};
