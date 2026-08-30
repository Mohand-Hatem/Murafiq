import WardrobeItem from './wardrobe-item.model.js';

export const createWardrobeItem = async (data, session = null) => {
  const options = session ? { session } : {};
  const [item] = await WardrobeItem.create([data], options);
  return item;
};

export const findWardrobeItemById = async (id, session = null) => {
  return WardrobeItem.findById(id).session(session);
};

export const findWardrobeItemByIdAndUser = async (id, userId, session = null) => {
  return WardrobeItem.findOne({ _id: id, userId }).session(session);
};

export const findUserWardrobeItems = async (userId, filter = {}, pagination = {}, session = null) => {
  const { category, formality, season, search } = filter;
  const { page = 1, limit = 20, sort = { createdAt: -1 } } = pagination;
  const skip = (page - 1) * limit;

  const query = { userId };

  if (category) {
    query.category = category;
  }
  if (formality) {
    query.formality = formality;
  }
  if (season) {
    query.season = { $in: Array.isArray(season) ? season : [season] };
  }
  if (search) {
    query.aiDescription = { $regex: search, $options: 'i' };
  }

  const [items, total] = await Promise.all([
    WardrobeItem.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .session(session)
      .lean(),
    WardrobeItem.countDocuments(query).session(session),
  ]);

  return {
    items,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
};

export const updateWardrobeItemById = async (id, updateData, session = null) => {
  return WardrobeItem.findByIdAndUpdate(
    id,
    { $set: updateData },
    { returnDocument: 'after', runValidators: true, session }
  );
};

export const deleteWardrobeItemByIdAndUser = async (id, userId, session = null) => {
  return WardrobeItem.findOneAndDelete({ _id: id, userId }).session(session);
};

export default {
  createWardrobeItem,
  findWardrobeItemById,
  findWardrobeItemByIdAndUser,
  findUserWardrobeItems,
  updateWardrobeItemById,
  deleteWardrobeItemByIdAndUser,
};
