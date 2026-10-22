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

// Oldest first, so competing stylists see offers in the order they arrived.
export const findPendingByRequestId = async (requestId) => {
  return Offer.find({ requestId, status: OFFER_STATUS.PENDING })
    .sort({ createdAt: 1 })
    .populate({ path: 'stylistId', select: 'name profileImage' });
};

// The stylist's own offers, newest first, with a summary of the request each one is on.
export const findMineByStylist = async (stylistId, queryString = {}) => {
  const query = { stylistId };
  if (queryString.status) query.status = queryString.status;

  const page = Math.max(1, parseInt(queryString.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(queryString.limit, 10) || 10));

  const [items, total] = await Promise.all([
    Offer.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'requestId', select: 'title date time status offerCount visibility' }),
    Offer.countDocuments(query),
  ]);

  return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
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

export const closeSiblingOffers = async (
  requestId,
  winningOfferId,
  session = null,
  closedByBookingId = undefined
) => {
  const options = session ? { session } : {};
  return Offer.updateMany(
    {
      requestId,
      _id: { $ne: winningOfferId },
      status: OFFER_STATUS.PENDING,
    },
    { $set: { status: OFFER_STATUS.CLOSED, ...(closedByBookingId ? { closedByBookingId } : {}) } },
    options
  );
};

export const rejectSiblingOffers = async (
  requestId,
  winningOfferId,
  session = null,
  closedByBookingId = undefined
) => {
  return closeSiblingOffers(requestId, winningOfferId, session, closedByBookingId);
};

// An unpaid booking was released: the accepted offer and the siblings it closed go back to
// `toStatus` (PENDING to be accepted again, or EXPIRED when the session start has passed).
export const releaseAfterUnpaidBooking = async (
  { requestId, offerId, bookingId, toStatus },
  session = null
) => {
  const options = session ? { session } : {};
  return Offer.updateMany(
    {
      requestId,
      $or: [
        { _id: offerId, status: OFFER_STATUS.ACCEPTED },
        { closedByBookingId: bookingId, status: OFFER_STATUS.CLOSED },
      ],
    },
    { $set: { status: toStatus }, $unset: { closedByBookingId: '' } },
    options
  );
};

export default {
  create,
  findById,
  findByRequestId,
  findAllByRequestId,
  findPendingByRequestId,
  findMineByStylist,
  findActiveForClient,
  countByStylistAndRequest,
  countDailyStylistOffers,
  updateById,
  expireOldOffers,
  findSiblingPendingOffers,
  closeSiblingOffers,
  rejectSiblingOffers,
  releaseAfterUnpaidBooking,
};
