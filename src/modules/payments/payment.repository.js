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

export default {
  create,
  findById,
  findByBookingId,
  findByBookingIds,
  findByTransactionId,
  findByIntentionId,
  updateById,
  findClientHistory,
};
