import StylistProfile from './stylist-profile.model.js';

export const create = async (data) => {
  const profile = await StylistProfile.create(data);
  return profile.populate('userId', 'name profileImage verification accountStatus');
};

export const findByUserId = async (userId) => {
  return StylistProfile.findOne({ userId }).populate(
    'userId',
    'name profileImage verification accountStatus'
  );
};

export const findById = async (id) => {
  return StylistProfile.findById(id).populate(
    'userId',
    'name profileImage verification accountStatus'
  );
};

export const updateByUserId = async (userId, data) => {
  return StylistProfile.findOneAndUpdate({ userId }, data, {
    returnDocument: 'after',
    runValidators: true,
  }).populate('userId', 'name profileImage verification accountStatus');
};

export const findVerifiedInArea = async ({
  governorate,
  city,
  fallbackCoordinates,
  fallbackRadiusKm = 10,
  limit = 50,
}) => {
  const matchQuery = {};
  if (governorate) {
    matchQuery.governorate = new RegExp(`^${governorate}$`, 'i');
  }
  if (city) {
    matchQuery.city = new RegExp(`^${city}$`, 'i');
  }

  let profiles = await StylistProfile.find(matchQuery)
    .populate({
      path: 'userId',
      match: {
        'verification.status': 'verified',
        accountStatus: 'active',
        isDeleted: { $ne: true },
      },
      select: '_id',
    })
    .sort({ rating: -1 })
    .limit(limit);

  profiles = profiles.filter((p) => p.userId);

  if (profiles.length < limit && fallbackCoordinates && fallbackCoordinates[0] !== 0) {
    const geoProfiles = await StylistProfile.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: fallbackCoordinates },
          distanceField: 'distance',
          maxDistance: fallbackRadiusKm * 1000,
          spherical: true,
          query: { locationSet: true },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      {
        $match: {
          'user.verification.status': 'verified',
          'user.accountStatus': 'active',
          'user.isDeleted': { $ne: true },
        },
      },
      { $sort: { rating: -1, distance: 1 } },
      { $limit: limit },
    ]);

    const existingIds = new Set(profiles.map((p) => p.userId._id.toString()));
    for (const gp of geoProfiles) {
      if (!existingIds.has(gp.userId.toString()) && profiles.length < limit) {
        profiles.push({ userId: gp.user });
        existingIds.add(gp.userId.toString());
      }
    }
  }

  return profiles.map((p) => ({ userId: p.userId._id.toString() }));
};

export default {
  create,
  findByUserId,
  findById,
  updateByUserId,
  findVerifiedInArea,
};

