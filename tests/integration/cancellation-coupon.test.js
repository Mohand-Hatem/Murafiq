import '../../src/common/globals.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import Payment from '../../src/modules/payments/payment.model.js';
import Coupon from '../../src/modules/coupons/coupon.model.js';
import * as bookingService from '../../src/modules/bookings/booking.service.js';
import * as couponService from '../../src/modules/coupons/coupon.service.js';
import { PAYMENT_STATUS } from '../../src/common/constants/statuses.constant.js';

describe('Task S3.5: Issue late stylist cancellation coupon (S-3 / BK5)', () => {
  let client;
  let stylist;

  beforeAll(async () => {
    await connectTestDB();
    await Promise.all([Booking.init(), Payment.init(), Coupon.init()]);
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    client = await User.create({
      name: 'Client Coupon',
      email: 'client-coupon@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'client',
      isEmailVerified: true,
    });
    stylist = await User.create({
      name: 'Stylist Coupon',
      email: 'stylist-coupon@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'stylist',
      isEmailVerified: true,
    });
  });

  it('issues a compensation coupon when a stylist cancels late', async () => {
    // 6 hours in the future (< 24h) -> late stylist cancellation -> couponEligible: true
    const lateDate = new Date(Date.now() + 6 * 3600 * 1000);
    const booking = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: stylist._id,
      scheduledDate: lateDate,
      scheduledStartMinute: 600,
      scheduledEndMinute: 660,
      price: 1000,
      duration: 60,
      status: 'confirmed',
    });

    await Payment.create({
      bookingId: booking._id,
      clientId: client._id,
      amount: 1000,
      status: PAYMENT_STATUS.PAID,
      platformFeeAmount: 150,
      stylistPayoutAmount: 850,
    });

    await bookingService.cancelBooking(stylist, booking._id, { reason: 'emergency' });

    const coupon = await Coupon.findOne({ sourceBookingId: booking._id });
    expect(coupon).not.toBeNull();
    expect(coupon.recipientId.toString()).toBe(client._id.toString());
    expect(coupon.issuedReason).toBe('LATE_STYLIST_CANCELLATION');
  });

  it('does not issue one when a stylist cancels early', async () => {
    // 48 hours in the future (>= 24h) -> early stylist cancellation -> couponEligible: false
    const earlyDate = new Date(Date.now() + 48 * 3600 * 1000);
    const booking = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: stylist._id,
      scheduledDate: earlyDate,
      scheduledStartMinute: 600,
      scheduledEndMinute: 660,
      price: 1000,
      duration: 60,
      status: 'confirmed',
    });

    await Payment.create({
      bookingId: booking._id,
      clientId: client._id,
      amount: 1000,
      status: PAYMENT_STATUS.PAID,
      platformFeeAmount: 150,
      stylistPayoutAmount: 850,
    });

    await bookingService.cancelBooking(stylist, booking._id, { reason: 'advance reschedule' });

    const coupon = await Coupon.findOne({ sourceBookingId: booking._id });
    expect(coupon).toBeNull();
  });

  it('is idempotent on a retry', async () => {
    const dummyBookingId = new mongoose.Types.ObjectId();
    await couponService.issueCoupon({
      recipientId: client._id,
      sourceBookingId: dummyBookingId,
      issuedReason: 'LATE_STYLIST_CANCELLATION',
    });
    await couponService.issueCoupon({
      recipientId: client._id,
      sourceBookingId: dummyBookingId,
      issuedReason: 'LATE_STYLIST_CANCELLATION',
    });

    expect(await Coupon.countDocuments({ sourceBookingId: dummyBookingId })).toBe(1);
  });
});
