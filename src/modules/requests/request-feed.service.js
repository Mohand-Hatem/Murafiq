import Request from './request.model.js';
import { toPublicRequestDto } from './request.dto.js';
import { escapeRegex } from '../../common/query-builder/QueryBuilder.js';

const ALLOWED_SORT_FIELDS = ['createdAt', 'distance', 'expiresAt'];

export const getBroadcastFeed = async (stylistUser, queryParams = {}) => {
  const page = Math.max(1, parseInt(queryParams.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(queryParams.limit, 10) || 10));
  const skip = (page - 1) * limit;

  const matchQuery = {
    visibility: 'broadcast',
    status: 'pending',
    expiresAt: { $gt: new Date() },
  };

  if (queryParams.governorate) {
    matchQuery['meetingLocation.governorate'] = new RegExp(
      `^${escapeRegex(queryParams.governorate)}$`,
      'i'
    );
  }
  if (queryParams.city) {
    matchQuery['meetingLocation.city'] = new RegExp(
      `^${escapeRegex(queryParams.city)}$`,
      'i'
    );
  }

  const pipeline = [];

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
        query: matchQuery,
      },
    });
  } else {
    pipeline.push({ $match: matchQuery });
  }

  // Populate client for DTO mapping
  pipeline.push(
    {
      $lookup: {
        from: 'users',
        localField: 'clientId',
        foreignField: '_id',
        as: 'clientId',
      },
    },
    { $unwind: '$clientId' }
  );

  // Exclude requests this stylist has already submitted an offer on
  const stylistId = stylistUser._id || stylistUser.id;
  pipeline.push(
    {
      $lookup: {
        from: 'offers',
        let: { reqId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$requestId', '$$reqId'] },
                  { $eq: ['$stylistId', stylistId] },
                ],
              },
            },
          },
        ],
        as: 'myOffer',
      },
    },
    { $match: { myOffer: { $size: 0 } } }
  );

  let sortStage = { createdAt: -1 };
  if (hasGeoParams && (!queryParams.sort || queryParams.sort === 'distance')) {
    sortStage = { distance: 1 };
  } else if (queryParams.sort) {
    const [field, order] = queryParams.sort.split(':');
    if (!ALLOWED_SORT_FIELDS.includes(field)) {
      throw new ApiError(
        400,
        `Invalid sort field '${field}'. Allowed: ${ALLOWED_SORT_FIELDS.join(', ')}`
      );
    }
    sortStage = { [field]: order === 'desc' ? -1 : 1 };
  }

  pipeline.push({
    $facet: {
      items: [{ $sort: sortStage }, { $skip: skip }, { $limit: limit }],
      totalCount: [{ $count: 'total' }],
    },
  });

  const [result] = await Request.aggregate(pipeline);
  const items = result?.items || [];
  const total = result?.totalCount?.[0]?.total || 0;

  return {
    items: items.map(toPublicRequestDto),
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
};

export default { getBroadcastFeed };
