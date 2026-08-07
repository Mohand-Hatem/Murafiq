import StylistProfile from './stylist-profile.model.js';

export const create = async (data) => {
  const profile = await StylistProfile.create(data);
  return profile.populate('userId', 'nameEn nameAr profileImage verification accountStatus');
};

export const findByUserId = async (userId) => {
  return StylistProfile.findOne({ userId }).populate(
    'userId',
    'nameEn nameAr profileImage verification accountStatus'
  );
};

export const findById = async (id) => {
  return StylistProfile.findById(id).populate(
    'userId',
    'nameEn nameAr profileImage verification accountStatus'
  );
};

export const updateByUserId = async (userId, data) => {
  return StylistProfile.findOneAndUpdate({ userId }, data, {
    new: true,
    runValidators: true,
  }).populate('userId', 'nameEn nameAr profileImage verification accountStatus');
};

export default {
  create,
  findByUserId,
  findById,
  updateByUserId,
};
