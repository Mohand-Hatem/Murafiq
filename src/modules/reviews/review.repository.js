import mongoose from 'mongoose';
import Review from './review.model.js';
import QueryBuilder from '../../common/query-builder/QueryBuilder.js';

export const create = async (data, session = null) => {
  const options = session ? { session } : {};
  const [review] = await Review.create([data], options);
  return review;
};

export const findById = async (id) => {
  return Review.findById(id)
    .populate('raterId', 'name profileImage')
    .populate('revieweeId', 'name profileImage');
};

export const findByBookingAndDirection = async (bookingId, direction) => {
  return Review.findOne({ bookingId, direction });
};

export const findByBookingId = async (bookingId) => {
  return Review.find({ bookingId })
    .populate('raterId', 'name profileImage')
    .populate('revieweeId', 'name profileImage');
};

export const findStylistReviews = async (stylistUserId, queryString = {}) => {
  const queryObj = {
    ...queryString,
    revieweeId: stylistUserId,
    direction: 'client_to_stylist',
    isHidden: false,
  };

  const baseQuery = Review.find();
  const builder = new QueryBuilder(baseQuery, queryObj)
    .filter(['rating', 'direction', 'revieweeId', 'raterId', 'isHidden'])
    .sort()
    .select();

  await builder.paginate(Review);
  const items = await builder.mongooseQuery.populate('raterId', 'name profileImage');

  return {
    items,
    meta: builder.meta,
  };
};

export const findUserReviews = async (userId, queryString = {}) => {
  const queryObj = { ...queryString, raterId: userId };
  const baseQuery = Review.find();

  const builder = new QueryBuilder(baseQuery, queryObj)
    .filter(['rating', 'direction', 'revieweeId', 'raterId', 'isHidden'])
    .sort()
    .select();

  await builder.paginate(Review);
  const items = await builder.mongooseQuery
    .populate('revieweeId', 'name profileImage')
    .populate('bookingId', 'scheduledDate price status');

  return {
    items,
    meta: builder.meta,
  };
};

export const updateById = async (id, data) => {
  return Review.findByIdAndUpdate(id, data, { new: true, runValidators: true });
};

export const aggregateRating = async (revieweeId, direction) => {
  const objectId = mongoose.Types.ObjectId.isValid(revieweeId)
    ? new mongoose.Types.ObjectId(revieweeId)
    : revieweeId;

  const stats = await Review.aggregate([
    {
      $match: {
        revieweeId: objectId,
        direction,
        isHidden: false,
      },
    },
    {
      $group: {
        _id: '$revieweeId',
        avgRating: { $avg: '$rating' },
        count: { $sum: 1 },
      },
    },
  ]);

  if (!stats || stats.length === 0) {
    return { avgRating: 0, totalReviews: 0 };
  }

  const rawAvg = stats[0].avgRating || 0;
  const roundedAvg = Math.round(rawAvg * 100) / 100;
  const totalCount = stats[0].count || 0;

  return {
    avgRating: roundedAvg,
    totalReviews: totalCount,
  };
};

export const findClientReviews = async (clientUserId, queryString = {}) => {
  const queryObj = {
    ...queryString,
    revieweeId: clientUserId,
    direction: 'stylist_to_client',
    isHidden: false,
  };

  const baseQuery = Review.find();
  const builder = new QueryBuilder(baseQuery, queryObj)
    .filter(['rating', 'direction', 'revieweeId', 'raterId', 'isHidden'])
    .sort()
    .select();

  await builder.paginate(Review);
  const items = await builder.mongooseQuery.populate('raterId', 'name profileImage');

  return {
    items,
    meta: builder.meta,
  };
};

export default {
  create,
  findById,
  findByBookingAndDirection,
  findByBookingId,
  findStylistReviews,
  findClientReviews,
  findUserReviews,
  updateById,
  aggregateRating,
};
