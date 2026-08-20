import Offer from './offer.model.js';

export const create = async (data) => {
  const offerDoc = await Offer.create(data);
  return offerDoc.populate([
    { path: 'stylistId', select: 'name profileImage' },
    { path: 'clientId', select: 'name profileImage' },
  ]);
};

export const findById = async (id) => {
  return Offer.findById(id).populate([
    { path: 'stylistId', select: 'name profileImage' },
    { path: 'clientId', select: 'name profileImage' },
  ]);
};

export const findByRequestId = async (requestId) => {
  return Offer.findOne({ requestId }).populate([
    { path: 'stylistId', select: 'name profileImage' },
    { path: 'clientId', select: 'name profileImage' },
  ]);
};

export const findActiveForClient = async (stylistId, clientId) => {
  return Offer.findOne({ stylistId, clientId, status: 'pending' });
};

export const countDailyStylistOffers = async (stylistId, startOfDay, endOfDay) => {
  return Offer.countDocuments({
    stylistId,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  });
};

export const updateById = async (id, data) => {
  return Offer.findByIdAndUpdate(id, data, { new: true, runValidators: true }).populate([
    { path: 'stylistId', select: 'name profileImage' },
    { path: 'clientId', select: 'name profileImage' },
  ]);
};

export const expireOldOffers = async () => {
  const now = new Date();
  return Offer.updateMany(
    { status: 'pending', expiresAt: { $lt: now } },
    { $set: { status: 'expired' } }
  );
};

export default {
  create,
  findById,
  findByRequestId,
  findActiveForClient,
  countDailyStylistOffers,
  updateById,
  expireOldOffers,
};
