import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import Payment from '../../src/modules/payments/payment.model.js';
import { resolveDispute } from '../../src/modules/bookings/booking.service.js';
import { PAYMENT_STATUS } from '../../src/common/constants/statuses.constant.js';

// Real MongoDB, no repository mocks: the mocked dispute tests never ran Mongoose's update
// validators, which hid that 5 of the 7 admin outcomes failed the disputeResolution.outcome
// enum AFTER the refund had already been issued -- leaving the booking stuck in 'disputed'.
describe('resolveDispute persists every admin outcome (real DB)', () => {
  let client;
  let stylist;
  let admin;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    const user = (name, role) =>
      User.create({ name, email: `${role}@murafiq.test`, passwordHash: 'x'.repeat(20), role, isEmailVerified: true });
    client = await user('Test Client', 'client');
    stylist = await user('Test Stylist', 'stylist');
    admin = await user('Test Admin', 'admin');
  });

  const createDisputedPaidBooking = async () => {
    const booking = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: stylist._id,
      scheduledDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
      scheduledStartMinute: 600,
      scheduledEndMinute: 660,
      price: 1000,
      duration: 60,
      status: 'disputed',
      payoutStatus: 'unpaid',
      disputeDetails: { raisedBy: client._id, reason: 'Service not delivered', type: 'general', raisedAt: new Date() },
    });
    const payment = await Payment.create({
      bookingId: booking._id,
      clientId: client._id,
      amount: 1000,
      status: PAYMENT_STATUS.PAID,
      platformFeePercentage: 20,
      platformFeeAmount: 200,
      stylistPayoutAmount: 800,
    });
    return { booking, payment };
  };

  it.each([
    ['completed', 0, 'completed', PAYMENT_STATUS.PAID],
    ['payout_stylist', 0, 'completed', PAYMENT_STATUS.PAID],
    ['dismissed', 0, 'completed', PAYMENT_STATUS.PAID],
    ['split', 50, 'completed', PAYMENT_STATUS.PARTIALLY_REFUNDED],
    ['partial_refund', 50, 'completed', PAYMENT_STATUS.PARTIALLY_REFUNDED],
    ['cancelled', 0, 'cancelled', PAYMENT_STATUS.REFUNDED],
    ['refund_full', 0, 'cancelled', PAYMENT_STATUS.REFUNDED],
  ])(
    "outcome '%s' (refund %s%%) leaves booking '%s' and payment '%s'",
    async (outcome, refundPercentage, expectedBookingStatus, expectedPaymentStatus) => {
      const { booking, payment } = await createDisputedPaidBooking();

      await resolveDispute(admin._id.toString(), booking._id.toString(), {
        outcome,
        refundPercentage,
        resolutionNotes: `Admin resolution: ${outcome}`,
      });

      const savedBooking = await Booking.findById(booking._id);
      const savedPayment = await Payment.findById(payment._id);
      expect(savedBooking.status).toBe(expectedBookingStatus);
      expect(savedBooking.disputeResolution.outcome).toBe(outcome);
      expect(savedBooking.disputeResolution.resolvedAt).toBeInstanceOf(Date);
      expect(savedPayment.status).toBe(expectedPaymentStatus);
    }
  );
});
