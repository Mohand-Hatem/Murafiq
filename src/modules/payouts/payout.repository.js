import Payout from './payout.model.js';
import bookingRepository from '../bookings/booking.repository.js';
import paymentRepository from '../payments/payment.repository.js';
import QueryBuilder from '../../common/query-builder/QueryBuilder.js';

// Only these payment statuses still carry a payable stylistPayoutAmount — a full refund flips a
// payment to 'refunded' with stylistPayoutAmount 0, so it's naturally excluded here, not filtered
// out specially.
export const PAYABLE_PAYMENT_STATUSES = ['paid', 'partially_refunded'];

export const create = async (data, session = null) => {
  const options = session ? { session } : {};
  const [payout] = await Payout.create([data], options);
  return payout;
};

export const findById = async (id, session = null) => {
  const query = Payout.findById(id).populate('stylistId', 'name email phone');
  if (session) query.session(session);
  return query.exec();
};

export const findStylistPayouts = async (stylistId, queryString = {}) => {
  // Ownership must be enforced on the base query itself, never routed through
  // QueryBuilder's filter allowlist — an allowlist that omits a key silently
  // drops it, which previously turned this into an unscoped Payout.find({})
  // and leaked every stylist's payouts (including bank account details).
  if (!stylistId) {
    throw new Error('findStylistPayouts requires a stylistId');
  }
  const baseQuery = Payout.find({ stylistId });

  const builder = new QueryBuilder(baseQuery, queryString)
    .filter(['status', 'method'])
    .sort()
    .select();

  // paginate() computes its own count via buildFilter(queryString) for the
  // pagination meta, which does not see the stylistId scope applied above to
  // the base query — pass it explicitly so `meta.total` matches what's
  // actually returned, not every stylist's payout count.
  await builder.paginate(Payout, { stylistId });
  const payouts = await builder.mongooseQuery.exec();

  return {
    payouts,
    meta: builder.meta,
  };
};

export const findAllPayouts = async (queryString = {}) => {
  const baseQuery = Payout.find();

  const builder = new QueryBuilder(baseQuery, queryString)
    .filter(['status', 'method', 'stylistId'])
    .sort()
    .select();

  await builder.paginate(Payout);
  const payouts = await builder.mongooseQuery.populate('stylistId', 'name email phone').exec();

  return {
    payouts,
    meta: builder.meta,
  };
};

export const updateById = async (id, data, session = null) => {
  const options = { returnDocument: 'after', runValidators: true };
  if (session) options.session = session;
  return Payout.findByIdAndUpdate(id, data, options);
};

export const getEligibleBookingsForStylist = async (stylistId, cutoffDate) => {
  // Completed, unpaid-payout, and past the dispute-window hold — anchored on completedAt, not
  // updatedAt (see booking.model.js comment: updatedAt drifts on unrelated writes).
  const eligibleBookings = await bookingRepository.findEligibleForPayout(stylistId, cutoffDate);

  if (!eligibleBookings || eligibleBookings.length === 0) {
    return { bookings: [], totalPayoutAmount: 0 };
  }

  const bookingIds = eligibleBookings.map((b) => b._id);

  // Derive payout amounts strictly from Payment records
  const payments = await paymentRepository.findByBookingIds(bookingIds, PAYABLE_PAYMENT_STATUSES);

  let totalPayoutAmount = 0;
  const payableBookingIds = [];

  for (const payment of payments) {
    if (payment.stylistPayoutAmount > 0) {
      totalPayoutAmount += payment.stylistPayoutAmount;
      payableBookingIds.push(payment.bookingId);
    }
  }

  totalPayoutAmount = Math.round(totalPayoutAmount * 100) / 100;

  return {
    bookings: eligibleBookings.filter((b) => payableBookingIds.some((id) => id.equals(b._id))),
    totalPayoutAmount,
  };
};

export const getPendingBalancesSummary = async (cutoffDate) => {
  const completedBookings = await bookingRepository.findCompletedUnpaidBefore(cutoffDate);

  if (completedBookings.length === 0) {
    return [];
  }

  const bookingIds = completedBookings.map((b) => b._id);
  const payments = await paymentRepository.findByBookingIds(bookingIds, PAYABLE_PAYMENT_STATUSES);

  const stylistTotals = new Map();
  for (const payment of payments) {
    if (payment.stylistPayoutAmount > 0) {
      const booking = completedBookings.find((b) => b._id.equals(payment.bookingId));
      if (booking) {
        const sId = booking.stylistId.toString();
        const current = stylistTotals.get(sId) || {
          stylistId: booking.stylistId,
          count: 0,
          totalAmount: 0,
          bookingIds: [],
        };
        current.count += 1;
        current.totalAmount = Math.round((current.totalAmount + payment.stylistPayoutAmount) * 100) / 100;
        current.bookingIds.push(booking._id);
        stylistTotals.set(sId, current);
      }
    }
  }

  return Array.from(stylistTotals.values());
};

export default {
  create,
  findById,
  findStylistPayouts,
  findAllPayouts,
  updateById,
  getEligibleBookingsForStylist,
  getPendingBalancesSummary,
};
