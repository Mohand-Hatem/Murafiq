import StylePreference from './style-preference.model.js';

export const findByUserId = async (userId) => {
  return StylePreference.findOne({ userId });
};

export const upsertByUserId = async (userId, data) => {
  return StylePreference.findOneAndUpdate(
    { userId },
    { $set: data },
    {
      returnDocument: 'after',
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );
};

export const deleteByUserId = async (userId) => {
  return StylePreference.findOneAndDelete({ userId });
};

export default {
  findByUserId,
  upsertByUserId,
  deleteByUserId,
};
