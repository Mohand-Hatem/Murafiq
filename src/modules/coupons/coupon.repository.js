import Coupon from './coupon.model.js';

export const create = async (data, session = null) => {
  const options = session ? { session } : {};
  const [doc] = await Coupon.create([data], options);
  return doc;
};

export const findByCodeForUser = async (code, recipientId) => {
  return Coupon.findOne({ code: String(code).toUpperCase().trim(), recipientId });
};

export const findBySourceBooking = async (sourceBookingId, issuedReason) => {
  return Coupon.findOne({ sourceBookingId, issuedReason });
};

export const findMine = async (recipientId, { status } = {}) => {
  const query = { recipientId };
  if (status) query.status = status;
  return Coupon.find(query).sort({ createdAt: -1 });
};

/**
 * Atomically claim a coupon. The `status: 'ISSUED'` term in the filter is the whole
 * point: two concurrent redemptions race on this single update and exactly one wins,
 * so a coupon can never be applied to two bookings. Returns null for the loser.
 */
export const redeemAtomically = async (couponId, bookingId, session = null) => {
  const options = { returnDocument: 'after' };
  if (session) options.session = session;
  return Coupon.findOneAndUpdate(
    { _id: couponId, status: 'ISSUED' },
    { $set: { status: 'REDEEMED', redeemedOnBookingId: bookingId, redeemedAt: new Date() } },
    options
  );
};

export const expireOverdue = async (now = new Date()) => {
  return Coupon.updateMany(
    { status: 'ISSUED', expiresAt: { $lt: now } },
    { $set: { status: 'EXPIRED' } }
  );
};

export default {
  create,
  findByCodeForUser,
  findBySourceBooking,
  findMine,
  redeemAtomically,
  expireOverdue,
};
