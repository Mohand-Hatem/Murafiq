import Booking from './booking.model.js';
import { isLegalTransition } from './booking.transitions.js';

export const create = async (data, session = null) => {
  const options = session ? { session } : {};
  const [bookingDoc] = await Booking.create([data], options);
  return bookingDoc.populate([
    { path: 'clientId', select: 'name profileImage' },
    { path: 'stylistId', select: 'name profileImage' },
  ]);
};

export const findById = async (id, session = null) => {
  const query = Booking.findById(id).populate([
    { path: 'clientId', select: 'name profileImage' },
    { path: 'stylistId', select: 'name profileImage' },
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
        { path: 'clientId', select: 'name profileImage' },
        { path: 'stylistId', select: 'name profileImage' },
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
        { path: 'clientId', select: 'name profileImage' },
        { path: 'stylistId', select: 'name profileImage' },
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
    { path: 'clientId', select: 'name profileImage' },
    { path: 'stylistId', select: 'name profileImage' },
  ]);
};

// Atomically records the caller's own completion-confirmation timestamp, scoped to
// status 'in-progress' (a booking that has moved on -- cancelled, disputed, already
// completed -- is left untouched, and this returns null rather than resurrecting it).
// MongoDB serializes writes to a single document, so the { new: true } document
// returned here always reflects the OTHER party's latest confirmation state too --
// never a stale pre-fetched read -- which is what makes the caller's "are both parties
// now confirmed?" check race-free. Two concurrent confirmations (client + stylist)
// previously could each read the other's field as still null and neither would ever
// promote the booking to 'completed', stranding it in 'in-progress' forever with the
// stylist never paid.
export const setCompletionConfirmation = async (bookingId, field, session = null) => {
  const options = { returnDocument: 'after', runValidators: true };
  if (session) options.session = session;

  return Booking.findOneAndUpdate(
    { _id: bookingId, status: 'in-progress' },
    { $set: { [field]: new Date() } },
    options
  ).populate([
    { path: 'clientId', select: 'name profileImage' },
    { path: 'stylistId', select: 'name profileImage' },
  ]);
};

// Promotes to 'completed' only if still 'in-progress' -- a second CAS guard so a
// concurrent promotion, or any other status change landing in between, can never be
// double-applied or overwrite a status the booking has since moved on from.
export const promoteToCompleted = async (bookingId, session = null) => {
  const options = { returnDocument: 'after', runValidators: true };
  if (session) options.session = session;

  return Booking.findOneAndUpdate(
    { _id: bookingId, status: 'in-progress' },
    { $set: { status: 'completed', completedAt: new Date() } },
    options
  ).populate([
    { path: 'clientId', select: 'name profileImage' },
    { path: 'stylistId', select: 'name profileImage' },
  ]);
};

// Settles a no-show only if the booking is still in one of the two REPORTABLE_STATUSES
// (no-show.service.js). Without this CAS, the 15-minute no-show sweep and mutual
// completion confirmation could race: both a no-show report and a genuine completion
// can be pending on the same booking, and a plain updateById would let whichever call
// lands second silently overwrite whichever landed first -- most dangerously, a
// completed session (money already earned, reliability already recomputed) getting
// stamped no-show-* afterwards. See docs/AUDIT_2026_09_FULL_SYSTEM.md finding X9.
export const settleNoShow = async (bookingId, patch, session = null) => {
  const options = { returnDocument: 'after', runValidators: true };
  if (session) options.session = session;

  return Booking.findOneAndUpdate(
    { _id: bookingId, status: { $in: ['confirmed', 'in-progress'] } },
    { $set: patch },
    options
  ).populate([
    { path: 'clientId', select: 'name profileImage' },
    { path: 'stylistId', select: 'name profileImage' },
  ]);
};

/**
 * The one compare-and-set primitive for booking lifecycle writes.
 *
 * Generalises the three hand-written CAS functions above (setCompletionConfirmation,
 * promoteToCompleted, settleNoShow) so the five writers that previously used the
 * precondition-free updateById get the same protection. Returns the updated document, or
 * `null` when the CAS lost -- the booking moved on between the caller's read and this
 * write. Callers MUST treat null as "the booking is no longer in a state this operation
 * applies to" and surface a 400/409, never retry blindly and never fall back to updateById.
 *
 * The legality assertion is a DEVELOPER guard, not a runtime authorization check: it fails
 * loudly if a caller asks for a transition BOOKING_TRANSITIONS does not contain, which is
 * a programming error. Authorization stays in the service layer.
 *
 * @param {string|import('mongoose').Types.ObjectId} bookingId
 * @param {string[]} fromStates  statuses this write is allowed to apply from
 * @param {Object}   patch       $set payload; `patch.status` is the target status
 * @param {import('mongoose').ClientSession|null} [session]
 * @returns {Promise<Object|null>}
 */
export const transitionStatus = async (bookingId, fromStates, patch, session = null) => {
  const targetStatus = patch?.status ?? patch?.$set?.status;
  if (targetStatus) {
    for (const from of fromStates) {
      if (!isLegalTransition(from, targetStatus)) {
        throw new Error(
          `Illegal booking transition declared: '${from}' -> '${targetStatus}'. ` +
            'Update BOOKING_TRANSITIONS deliberately if this is a real new edge.'
        );
      }
    }
  }

  const options = { returnDocument: 'after', runValidators: true };
  if (session) options.session = session;

  const hasOperator = Object.keys(patch || {}).some((key) => key.startsWith('$'));
  const updateDoc = hasOperator ? patch : { $set: patch };

  return Booking.findOneAndUpdate(
    { _id: bookingId, status: { $in: fromStates } },
    updateDoc,
    options
  ).populate([
    { path: 'clientId', select: 'name profileImage' },
    { path: 'stylistId', select: 'name profileImage' },
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
// A booking becomes payout-eligible via two paths: a normal completed session
// (anchored on completedAt), or a resolved client no-show, where NO_SHOW_POLICY.CLIENT
// entitles the stylist to a partial share even though the session never happened and
// completedAt is never set (see no-show.service.js resolveNoShow — it sets
// payoutStatus: 'unpaid' specifically in anticipation of this). Without this second
// path a client no-show's stylist compensation is computed correctly on the Payment
// record but can never actually be batched into a payout.
const PAYOUT_ELIGIBILITY = (cutoffDate) => ({
  payoutStatus: 'unpaid',
  isFrozen: { $ne: true },
  $or: [
    { status: 'completed', completedAt: { $ne: null, $lte: cutoffDate } },
    { status: 'no-show-client', 'noShowDetails.confirmedAt': { $ne: null, $lte: cutoffDate } },
  ],
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
  }).select('status cancelledBy checkInAt scheduledDate scheduledStartMinute');
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
  setCompletionConfirmation,
  promoteToCompleted,
  settleNoShow,
  transitionStatus,
  getBookingStats,
};

