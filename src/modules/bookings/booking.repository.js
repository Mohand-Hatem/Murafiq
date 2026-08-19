import Booking from './booking.model.js';

export const create = async (data, session = null) => {
  const options = session ? { session } : {};
  const [bookingDoc] = await Booking.create([data], options);
  return bookingDoc.populate([
    { path: 'clientId', select: 'nameEn nameAr profileImage' },
    { path: 'stylistId', select: 'nameEn nameAr profileImage' },
  ]);
};

export const findById = async (id, session = null) => {
  const query = Booking.findById(id).populate([
    { path: 'clientId', select: 'nameEn nameAr profileImage' },
    { path: 'stylistId', select: 'nameEn nameAr profileImage' },
  ]);
  if (session) query.session(session);
  return query;
};

export const findMine = async (clientId, queryString = {}) => {
  const query = { clientId };
  if (queryString.status) query.status = queryString.status;

  const page = Math.max(1, parseInt(queryString.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(queryString.limit, 10) || 10));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Booking.find(query)
      .sort({ scheduledDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate([
        { path: 'clientId', select: 'nameEn nameAr profileImage' },
        { path: 'stylistId', select: 'nameEn nameAr profileImage' },
      ]),
    Booking.countDocuments(query),
  ]);

  return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const findStylistBookings = async (stylistId, queryString = {}) => {
  const query = { stylistId };
  if (queryString.status) query.status = queryString.status;

  const page = Math.max(1, parseInt(queryString.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(queryString.limit, 10) || 10));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Booking.find(query)
      .sort({ scheduledDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate([
        { path: 'clientId', select: 'nameEn nameAr profileImage' },
        { path: 'stylistId', select: 'nameEn nameAr profileImage' },
      ]),
    Booking.countDocuments(query),
  ]);

  return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const updateById = async (id, data, session = null) => {
  const options = { new: true, runValidators: true };
  if (session) options.session = session;

  return Booking.findByIdAndUpdate(id, data, options).populate([
    { path: 'clientId', select: 'nameEn nameAr profileImage' },
    { path: 'stylistId', select: 'nameEn nameAr profileImage' },
  ]);
};

export default {
  create,
  findById,
  findMine,
  findStylistBookings,
  updateById,
};
