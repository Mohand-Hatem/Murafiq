import Request from './request.model.js';
import { REQUEST_STATUS } from '../../common/constants/statuses.constant.js';

export const create = async (data) => {
  const reqDoc = await Request.create(data);
  return reqDoc.populate([
    { path: 'clientId', select: 'name profileImage' },
    { path: 'stylistId', select: 'name profileImage' },
  ]);
};

export const findById = async (id) => {
  return Request.findById(id).populate([
    { path: 'clientId', select: 'name profileImage' },
    { path: 'stylistId', select: 'name profileImage' },
  ]);
};

export const findMine = async (clientId, queryString = {}) => {
  const query = { clientId };
  if (queryString.status) query.status = queryString.status;

  const page = Math.max(1, parseInt(queryString.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(queryString.limit, 10) || 10));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Request.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate([
        { path: 'clientId', select: 'name profileImage' },
        { path: 'stylistId', select: 'name profileImage' },
      ]),
    Request.countDocuments(query),
  ]);

  return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const findIncoming = async (stylistId, queryString = {}) => {
  const query = { stylistId };
  if (queryString.status) query.status = queryString.status;

  const page = Math.max(1, parseInt(queryString.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(queryString.limit, 10) || 10));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Request.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate([
        { path: 'clientId', select: 'name profileImage' },
        { path: 'stylistId', select: 'name profileImage' },
      ]),
    Request.countDocuments(query),
  ]);

  return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const countDailyClientRequests = async (clientId, startOfDay, endOfDay) => {
  return Request.countDocuments({
    clientId,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  });
};

export const updateById = async (id, data, session = null) => {
  const options = { returnDocument: 'after', runValidators: true };
  if (session) options.session = session;

  return Request.findByIdAndUpdate(id, data, options).populate([
    { path: 'clientId', select: 'name profileImage' },
    { path: 'stylistId', select: 'name profileImage' },
  ]);
};

// An unanswered request is PAUSED, not expired — the client can reactivate it. This is
// the §8 rule: 'expired' used to be terminal and stranded the request permanently.
export const expireOldRequests = async () => {
  const now = new Date();
  return Request.updateMany(
    { status: REQUEST_STATUS.OPEN, expiresAt: { $lt: now } },
    { $set: { status: REQUEST_STATUS.PAUSED, pausedAt: now } }
  );
};

export const lockAndAccept = async (requestId, session = null) => {
  const options = { returnDocument: 'after' };
  if (session) options.session = session;
  return Request.findOneAndUpdate(
    { _id: requestId, status: REQUEST_STATUS.OPEN },
    { $set: { status: REQUEST_STATUS.FULFILLED } },
    options
  );
};

export const findAutoPausableRequests = async (now = new Date()) => {
  return Request.find({
    status: REQUEST_STATUS.OPEN,
    offerCount: { $lte: 0 },
    autoPauseAt: { $lte: now, $ne: null },
  });
};

export const findPausedByClientId = async (clientId) => {
  return Request.find({
    clientId,
    status: REQUEST_STATUS.PAUSED,
  });
};

export default {
  create,
  findById,
  findMine,
  findIncoming,
  countDailyClientRequests,
  updateById,
  expireOldRequests,
  lockAndAccept,
  findAutoPausableRequests,
  findPausedByClientId,
};
