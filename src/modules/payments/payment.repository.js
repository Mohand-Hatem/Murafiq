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
    .filter()
    .sort()
    .select();

  await builder.paginate(Payment);
  const payments = await builder.mongooseQuery.populate({
    path: 'bookingId',
    select: 'serviceType scheduledDate scheduledStartTime status',
  });

  return {
    payments,
    meta: builder.meta,
  };
};

export default {
  create,
  findById,
  findByBookingId,
  findByTransactionId,
  findByIntentionId,
  updateById,
  findClientHistory,
};
