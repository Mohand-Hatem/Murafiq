import Payment from './payment.model.js';
import QueryBuilder from '../../common/query-builder/QueryBuilder.js';

export const create = async (data, session = null) => {
  const options = session ? { session } : {};
  const [payment] = await Payment.create([data], options);
  return payment;
};

export const findById = async (id) => {
  return Payment.findById(id).populate([
    { path: 'bookingId' },
    { path: 'clientId', select: 'name email profileImage' },
  ]);
};

export const findByBookingId = async (bookingId) => {
  return Payment.findOne({ bookingId }).populate([
    { path: 'bookingId' },
    { path: 'clientId', select: 'name email profileImage' },
  ]);
};

export const findByTransactionId = async (providerTransactionId) => {
  return Payment.findOne({ providerTransactionId });
};

export const findByIntentionId = async (providerIntentionId) => {
  return Payment.findOne({ providerIntentionId });
};

export const updateById = async (id, data, session = null) => {
  return Payment.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
    ...(session ? { session } : {}),
  });
};

export const findClientHistory = async (clientId, queryString = {}) => {
  const queryObj = { ...queryString, clientId };
  const baseQuery = Payment.find();

  const builder = new QueryBuilder(baseQuery, queryObj)
    .filter(['status', 'currency', 'provider', 'clientId'])
    .sort()
    .select();

  await builder.paginate(Payment);
  const payments = await builder.mongooseQuery.populate({
    path: 'bookingId',
    select: 'scheduledDate scheduledStartMinute scheduledEndMinute price status duration meetingLocation',
  });

  return {
    payments,
    meta: builder.meta,
  };
};


// Used by payouts (cross-module): payments backing a set of bookings, restricted to statuses that
// still carry a payable stylistPayoutAmount (paid / partially_refunded). Keeps the payouts module
// off the raw Payment model.
export const findByBookingIds = async (bookingIds, statuses) => {
  return Payment.find({
    bookingId: { $in: bookingIds },
    status: { $in: statuses },
  });
};

export const getRevenueStatsThisMonth = async (startDate, endDate) => {
  const dateFilter = {};
  if (startDate) dateFilter.$gte = startDate;
  if (endDate) dateFilter.$lte = endDate;

  const match = {
    status: { $in: ['paid', 'partially_refunded'] },
    ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}),
  };

  const results = await Payment.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalGrossVolume: { $sum: { $subtract: ['$amount', { $ifNull: ['$refundAmount', 0] }] } },
        totalPlatformCommission: { $sum: '$platformFeeAmount' },
        totalStylistPayouts: { $sum: '$stylistPayoutAmount' },
        transactionCount: { $sum: 1 },
      },
    },
  ]);

  const stats = results[0] || {
    totalGrossVolume: 0,
    totalPlatformCommission: 0,
    totalStylistPayouts: 0,
    transactionCount: 0,
  };

  return {
    grossVolume: Math.round(stats.totalGrossVolume * 100) / 100,
    platformCommission: Math.round(stats.totalPlatformCommission * 100) / 100,
    stylistPayouts: Math.round(stats.totalStylistPayouts * 100) / 100,
    transactionCount: stats.transactionCount,
  };
};

export default {
  create,
  findById,
  findByBookingId,
  findByBookingIds,
  findByTransactionId,
  findByIntentionId,
  updateById,
  findClientHistory,
  getRevenueStatsThisMonth,
};

