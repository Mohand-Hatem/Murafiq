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

export const findDisputedBookings = async (queryString = {}) => {
  const page = Math.max(1, parseInt(queryString.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(queryString.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const query = { status: 'disputed' };

  const [items, total] = await Promise.all([
    Booking.find(query)
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate([
        { path: 'clientId', select: 'name email phone profileImage' },
        { path: 'stylistId', select: 'name email phone profileImage' },
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


// Used by payouts (cross-module): bookings eligible for a specific stylist's payout batch —
// completed, unpaid, and past the dispute-window hold. Keeps the payouts module off the raw
// Booking model, matching every other cross-module caller's repository-to-repository pattern.
// `isFrozen` must be excluded here, not only relied on via `status`. A booking frozen by
// the moderation enforcement chain keeps status 'completed' by design (so an admin can
// still resolve it to any legitimate outcome), which means a status-only filter would
// happily pay out money that is supposed to be held pending review — see §I.4 step 7 and
// AGENTS.md: "a booking with an open dispute or open safety report must never appear as
// payable."
const PAYOUT_ELIGIBILITY = (cutoffDate) => ({
  status: 'completed',
  payoutStatus: 'unpaid',
  isFrozen: { $ne: true },
  completedAt: { $ne: null, $lte: cutoffDate },
});

export const findEligibleForPayout = async (stylistId, cutoffDate) => {
  return Booking.find({ stylistId, ...PAYOUT_ELIGIBILITY(cutoffDate) }).select(
    '_id price scheduledDate'
  );
};

// Same eligibility rule as above, across all stylists — backs the admin pending-balances
// summary. Shares PAYOUT_ELIGIBILITY deliberately: if these two ever diverge, the admin
// dashboard shows a balance that the batch job will not actually pay.
export const findCompletedUnpaidBefore = async (cutoffDate) => {
  return Booking.find(PAYOUT_ELIGIBILITY(cutoffDate)).select('_id stylistId');
};

export const updateManyPayoutStatus = async (bookingIds, data, session = null) => {
  const options = session ? { session } : {};
  return Booking.updateMany({ _id: { $in: bookingIds } }, data, options);
};

export const getBookingStats = async () => {
  const [total, confirmed, inProgress, completed, cancelled, disputed] = await Promise.all([
    Booking.countDocuments(),
    Booking.countDocuments({ status: 'confirmed' }),
    Booking.countDocuments({ status: 'in-progress' }),
    Booking.countDocuments({ status: 'completed' }),
    Booking.countDocuments({ status: 'cancelled' }),
    Booking.countDocuments({ status: 'disputed' }),
  ]);

  return {
    total,
    active: confirmed + inProgress,
    byStatus: {
      confirmed,
      inProgress,
      completed,
      cancelled,
      disputed,
    },
    openDisputes: disputed,
  };
};

export const findCompletedAndCancelledByStylistId = async (stylistId, session = null) => {
  const query = Booking.find({
    stylistId,
    status: { $in: ['completed', 'cancelled'] },
  }).select('status cancelledBy checkedInAt scheduledDate');
  if (session) query.session(session);
  return query;
};

/**
 * No-show reports whose response window has elapsed with no reply from the accused,
 * and which have not already been settled. Drives the auto-resolution sweep.
 */
export const findPendingNoShowReports = async (cutoff) => {
  return Booking.find({
    'noShowDetails.reportedAt': { $lte: cutoff, $ne: null },
    'noShowDetails.respondedAt': null,
    'noShowDetails.confirmedAt': null,
    status: { $in: ['confirmed', 'in-progress'] },
  });
};

export default {
  findPendingNoShowReports,
  create,
  findById,
  findEligibleForPayout,
  findCompletedUnpaidBefore,
  updateManyPayoutStatus,
  findMine,
  findStylistBookings,
  findDisputedBookings,
  findCompletedAndCancelledByStylistId,
  updateById,
  getBookingStats,
};

