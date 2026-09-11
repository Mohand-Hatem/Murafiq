import SubscriptionOrder from './subscription-order.model.js';

export const createOrder = async (orderData) => {
  return await SubscriptionOrder.create(orderData);
};

export const findById = async (id) => {
  return await SubscriptionOrder.findById(id);
};

export const findBySpecialReference = async (specialReference) => {
  return await SubscriptionOrder.findOne({ specialReference });
};

export const findByTransactionId = async (providerTransactionId) => {
  return await SubscriptionOrder.findOne({ providerTransactionId });
};

export const updateById = async (id, updateData) => {
  return await SubscriptionOrder.findByIdAndUpdate(
    id,
    { $set: updateData },
    { returnDocument: 'after' }
  );
};

/**
 * Compare-and-swap transition guarded on the order's CURRENT status, so two concurrent
 * webhook deliveries for the same order cannot both proceed to apply the plan grant.
 * Returns null if `fromStatus` no longer matches -- the caller must treat that as
 * "someone else is handling (or already handled) this order", never retry the write.
 */
export const transitionStatus = async (id, fromStatus, updateData) => {
  return await SubscriptionOrder.findOneAndUpdate(
    { _id: id, status: fromStatus },
    { $set: updateData },
    { returnDocument: 'after' }
  );
};

export default {
  createOrder,
  findById,
  findBySpecialReference,
  findByTransactionId,
  updateById,
  transitionStatus,
};
