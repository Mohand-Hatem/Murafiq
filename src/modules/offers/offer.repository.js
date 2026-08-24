import Offer from './offer.model.js';

export const create = async (data, session = null) => {
  const options = session ? { session } : {};
  const [offerDoc] = await Offer.create([data], options);
  return offerDoc.populate([
    { path: 'stylistId', select: 'name profileImage' },
    { path: 'clientId', select: 'name profileImage' },
  ]);
};

export const findById = async (id, session = null) => {
  const query = Offer.findById(id);
  if (session) query.session(session);
  return query.populate([
    { path: 'stylistId', select: 'name profileImage' },
    { path: 'clientId', select: 'name profileImage' },
  ]);
};

export const findByRequestId = async (requestId, session = null) => {
  const query = Offer.findOne({ requestId });
  if (session) query.session(session);
  return query.populate([
    { path: 'stylistId', select: 'name profileImage' },
    { path: 'clientId', select: 'name profileImage' },
  ]);
};

export const findActiveForClient = async (stylistId, clientId, session = null) => {
  const query = Offer.findOne({ stylistId, clientId, status: 'pending' });
  if (session) query.session(session);
  return query;
};

export const countDailyStylistOffers = async (stylistId, startOfDay, endOfDay) => {
  return Offer.countDocuments({
    stylistId,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  });
};

export const updateById = async (id, data, session = null) => {
  const query = Offer.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (session) query.session(session);
  return query.populate([
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
