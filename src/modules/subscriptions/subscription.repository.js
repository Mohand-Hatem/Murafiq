import Subscription from './subscription.model.js';

export const findActiveByUserId = async (userId) => {
  return await Subscription.findOne({
    userId,
    status: 'active',
  }).sort({ createdAt: -1 });
};

export const findByUserId = async (userId) => {
  return await Subscription.findOne({ userId }).sort({ createdAt: -1 });
};

export const createSubscription = async (data, session = null) => {
  const options = session ? { session } : {};
  const [sub] = await Subscription.create([data], options);
  return sub;
};

export const updateById = async (id, updateData, session = null) => {
  const options = session ? { session, returnDocument: 'after' } : { returnDocument: 'after' };
  return await Subscription.findByIdAndUpdate(id, updateData, options);
};

export const findExpiringSubscriptions = async (beforeDate = new Date()) => {
  return await Subscription.find({
    status: 'active',
    currentPeriodEnd: { $lte: beforeDate, $ne: null },
  });
};

export default {
  findActiveByUserId,
  findByUserId,
  createSubscription,
  updateById,
  findExpiringSubscriptions,
};
