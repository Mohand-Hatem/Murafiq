import StylistProfile from './stylist-profile.model.js';
import { toPublicStylistDto } from './stylist.dto.js';

export const searchStylists = async (queryParams = {}) => {
  const page = Math.max(1, parseInt(queryParams.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(queryParams.limit, 10) || 10));
  const skip = (page - 1) * limit;

  const matchQuery = {};

  // 1. Exact & Range Filters
  if (queryParams.specialty) {
    matchQuery.specialty = queryParams.specialty;
  }
  if (queryParams.gender) {
    matchQuery.gender = queryParams.gender;
  }
  if (queryParams.country) {
    matchQuery.country = new RegExp(`^${queryParams.country}$`, 'i');
  }
  if (queryParams.governorate) {
    matchQuery.governorate = new RegExp(`^${queryParams.governorate}$`, 'i');
  }
  if (queryParams.city) {
    matchQuery.city = new RegExp(`^${queryParams.city}$`, 'i');
  }
  if (queryParams.area) {
    matchQuery.area = new RegExp(`^${queryParams.area}$`, 'i');
  }

  // Price range (enforcing min price 100 floor)
  if (queryParams.minPrice || queryParams.maxPrice) {
    matchQuery.hourlyPrice = {};
    if (queryParams.minPrice) {
      matchQuery.hourlyPrice.$gte = Math.max(100, parseFloat(queryParams.minPrice));
    }
    if (queryParams.maxPrice) {
      matchQuery.hourlyPrice.$lte = parseFloat(queryParams.maxPrice);
    }
  }

  if (queryParams.minRating) {
    matchQuery.rating = { $gte: parseFloat(queryParams.minRating) };
  }
  if (queryParams.minExperience) {
    matchQuery.experienceYears = { $gte: parseInt(queryParams.minExperience, 10) };
  }
  if (queryParams.services) {
    const serviceList = Array.isArray(queryParams.services)
      ? queryParams.services
      : queryParams.services.split(',').map((s) => s.trim());
    matchQuery.services = { $in: serviceList };
  }

  // 2. Weekly Availability Filter
  if (queryParams.availableOn) {
    const availElemMatch = { day: queryParams.availableOn.toLowerCase() };
    if (queryParams.availableFrom) {
      availElemMatch.startTime = { $lte: queryParams.availableFrom };
    }
    if (queryParams.availableTo) {
      availElemMatch.endTime = { $gte: queryParams.availableTo };
    }
    matchQuery.weeklyAvailability = { $elemMatch: availElemMatch };
  }

  // 3. Pipeline construction
  const pipeline = [];

  // GeoNear must ALWAYS be the first stage if coordinates are provided
  const hasGeoParams =
    queryParams.lat !== undefined &&
    queryParams.lng !== undefined &&
    !isNaN(parseFloat(queryParams.lat)) &&
    !isNaN(parseFloat(queryParams.lng));

  if (hasGeoParams) {
    const lat = parseFloat(queryParams.lat);
    const lng = parseFloat(queryParams.lng);
    const radiusKm = parseFloat(queryParams.radiusKm) || 10;

    pipeline.push({
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distance',
        maxDistance: radiusKm * 1000,
        spherical: true,
        query: { locationSet: true }, // Exclude stylists who haven't set a real location
      },
    });
  }

  pipeline.push({ $match: matchQuery });

  // 4. Lookup User to check verification & account status
  pipeline.push(
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
    }
  );

  // 5. Text Search Substring Filter across User name & StylistProfile text fields
  if (queryParams.search) {
    const searchRegex = new RegExp(queryParams.search, 'i');
    pipeline.push({
      $match: {
        $or: [
          { bio: searchRegex },
          { serviceDescription: searchRegex },
          { 'user.name': searchRegex },
        ],
      },
    });
  }

  // 6. Count Total Pipeline
  const countPipeline = [...pipeline, { $count: 'total' }];

  // 7. Sort Stage
  let sortStage = { createdAt: -1 };
  if (hasGeoParams && (!queryParams.sort || queryParams.sort === 'distance')) {
    sortStage = { distance: 1 };
  } else if (queryParams.sort) {
    const [field, order] = queryParams.sort.split(':');
    sortStage = { [field]: order === 'desc' ? -1 : 1 };
  }

  pipeline.push({ $sort: sortStage }, { $skip: skip }, { $limit: limit });

  // Execute Aggregations
  const [items, countResult] = await Promise.all([
    StylistProfile.aggregate(pipeline),
    StylistProfile.aggregate(countPipeline),
  ]);

  const total = countResult[0]?.total || 0;
  const totalPages = Math.ceil(total / limit);

  // Format through DTO mapper
  const formattedItems = items.map((doc) => {
    // Map aggregated user document back to userId property for DTO mapper compatibility
    const mappedDoc = { ...doc, userId: doc.user };
    const publicDto = toPublicStylistDto(mappedDoc);
    if (doc.distance !== undefined) {
      publicDto.distanceKm = Math.round((doc.distance / 1000) * 100) / 100;
    }
    return publicDto;
  });

  return {
    items: formattedItems,
    meta: {
      total,
      page,
      limit,
      totalPages,
    },
  };
};

export default {
  searchStylists,
};
