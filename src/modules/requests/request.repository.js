import Request from './request.model.js';

export const create = async (data) => {
  const reqDoc = await Request.create(data);
  return reqDoc.populate([
    { path: 'clientId', select: 'nameEn nameAr profileImage' },
    { path: 'stylistId', select: 'nameEn nameAr profileImage' },
  ]);
};

export const findById = async (id) => {
  return Request.findById(id).populate([
    { path: 'clientId', select: 'nameEn nameAr profileImage' },
    { path: 'stylistId', select: 'nameEn nameAr profileImage' },
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
        { path: 'clientId', select: 'nameEn nameAr profileImage' },
        { path: 'stylistId', select: 'nameEn nameAr profileImage' },
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
        { path: 'clientId', select: 'nameEn nameAr profileImage' },
        { path: 'stylistId', select: 'nameEn nameAr profileImage' },
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

export const updateById = async (id, data) => {
  return Request.findByIdAndUpdate(id, data, { new: true, runValidators: true }).populate([
    { path: 'clientId', select: 'nameEn nameAr profileImage' },
    { path: 'stylistId', select: 'nameEn nameAr profileImage' },
  ]);
};

export const expireOldRequests = async () => {
  const now = new Date();
  return Request.updateMany(
    { status: 'pending', expiresAt: { $lt: now } },
    { $set: { status: 'expired' } }
  );
};

export default {
  create,
  findById,
  findMine,
  findIncoming,
  countDailyClientRequests,
  updateById,
  expireOldRequests,
};
