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
  const { category, formality, season, itemIds, genderPresentation, subcategory, fit, isArchived } = filter;
  const { page = 1, limit = 20, sort = { createdAt: -1 } } = pagination;
  const skip = (page - 1) * limit;

  const query = { userId };

  // By default, exclude archived items from active list unless explicitly requested
  if (isArchived === undefined) {
    query.isArchived = { $ne: true };
  } else if (isArchived !== 'all') {
    query.isArchived = isArchived === 'true' || isArchived === true;
  }

  if (category) {
    query.category = category;
  }
  if (subcategory) {
    query.subcategory = subcategory;
  }
  if (formality) {
    query.formality = formality;
  }
  if (genderPresentation) {
    query.genderPresentation = genderPresentation;
  }
  if (fit) {
    query.fit = fit;
  }
  if (season) {
    query.season = { $in: Array.isArray(season) ? season : [season] };
  }
  if (itemIds !== undefined) {
    query._id = { $in: itemIds };
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

export const findCandidatesForSlot = async (
  userId,
  { slot, formality, season, genderPresentation, limit = 6 },
  session = null
) => {
  const query = {
    userId,
    category: slot,
    isArchived: { $ne: true },
    classificationStatus: 'done',
  };

  if (formality && formality.length > 0) {
    query.formality = Array.isArray(formality) ? { $in: formality } : formality;
  }

  if (season) {
    query.season = { $in: [season, 'all_season'] };
  }

  const GENDER_MAP = {
    men: 'masculine',
    masculine: 'masculine',
    women: 'feminine',
    feminine: 'feminine',
  };

  const targetGender = genderPresentation
    ? GENDER_MAP[String(genderPresentation).toLowerCase()]
    : null;

  if (targetGender) {
    query.genderPresentation = { $in: [targetGender, 'unisex'] };
  }

  const projection = {
    _id: 1,
    category: 1,
    subcategory: 1,
    primaryColor: 1,
    secondaryColors: 1,
    colorFamily: 1,
    pattern: 1,
    formality: 1,
    season: 1,
    material: 1,
    fit: 1,
    genderPresentation: 1,
    isNeutral: 1,
    printedText: 1,
    aiDescription: 1,
    styleTags: 1,
    wearCount: 1,
    lastWornAt: 1,
  };

  return WardrobeItem.find(query, projection)
    .sort({ wearCount: 1, createdAt: -1 })
    .limit(limit)
    .session(session)
    .lean();
};

export const findItemsByIds = async (userId, itemIds, session = null) => {
  if (!itemIds || itemIds.length === 0) {
    return [];
  }
  return WardrobeItem.find({
    _id: { $in: itemIds },
    userId,
    isArchived: { $ne: true },
  })
    .session(session)
    .lean();
};

export default {
  createWardrobeItem,
  findWardrobeItemById,
  findWardrobeItemByIdAndUser,
  findUserWardrobeItems,
  updateWardrobeItemById,
  deleteWardrobeItemByIdAndUser,
  findCandidatesForSlot,
  findItemsByIds,
};
