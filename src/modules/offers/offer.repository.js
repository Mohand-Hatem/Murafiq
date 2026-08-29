import Offer from './offer.model.js';
import { OFFER_STATUS } from '../../common/constants/statuses.constant.js';

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

// Full offer comparison for the request's own client — sorted cheapest-first
export const findAllByRequestId = async (requestId) => {
  return Offer.find({ requestId })
    .sort({ price: 1 })
    .populate([
      { path: 'stylistId', select: 'name profileImage' },
      { path: 'clientId', select: 'name profileImage' },
    ]);
};

export const findActiveForClient = async (stylistId, clientId, session = null) => {
  const query = Offer.findOne({ stylistId, clientId, status: OFFER_STATUS.PENDING });
  if (session) query.session(session);
  return query;
};

export const countByStylistAndRequest = async (stylistId, requestId) => {
  return Offer.countDocuments({
    stylistId,
    requestId,
    status: { $in: [OFFER_STATUS.PENDING, OFFER_STATUS.ACCEPTED] },
  });
};

export const countDailyStylistOffers = async (stylistId, startOfDay, endOfDay) => {
  return Offer.countDocuments({
    stylistId,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  });
};

export const updateById = async (id, data, session = null) => {
  const options = { returnDocument: 'after', runValidators: true };
  if (session) options.session = session;
  return Offer.findByIdAndUpdate(id, data, options).populate([
    { path: 'stylistId', select: 'name profileImage' },
    { path: 'clientId', select: 'name profileImage' },
  ]);
};

export const expireOldOffers = async () => {
  const now = new Date();
  return Offer.updateMany(
    {
      status: OFFER_STATUS.PENDING,
      $or: [
        { expiresAt: { $lt: now } },
        { longStopExpiresAt: { $lt: now } },
      ],
    },
    { $set: { status: OFFER_STATUS.EXPIRED } }
  );
};

export const findSiblingPendingOffers = async (requestId, winningOfferId, session = null) => {
  const query = Offer.find({
    requestId,
    _id: { $ne: winningOfferId },
    status: OFFER_STATUS.PENDING,
  });
  if (session) query.session(session);
  return query;
};

export const closeSiblingOffers = async (requestId, winningOfferId, session = null) => {
  const options = session ? { session } : {};
  return Offer.updateMany(
    {
      requestId,
      _id: { $ne: winningOfferId },
      status: OFFER_STATUS.PENDING,
    },
    { $set: { status: OFFER_STATUS.CLOSED } },
    options
  );
};

export const rejectSiblingOffers = async (requestId, winningOfferId, session = null) => {
  return closeSiblingOffers(requestId, winningOfferId, session);
};

export default {
  create,
  findById,
  findByRequestId,
  findAllByRequestId,
  findActiveForClient,
  countByStylistAndRequest,
  countDailyStylistOffers,
  updateById,
  expireOldOffers,
  findSiblingPendingOffers,
  closeSiblingOffers,
  rejectSiblingOffers,
};
