import '../../src/common/globals.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import Payment from '../../src/modules/payments/payment.model.js';
import Payout from '../../src/modules/payouts/payout.model.js';
import bookingRepository from '../../src/modules/bookings/booking.repository.js';
import paymentService from '../../src/modules/payments/payment.service.js';
import { migrateS3PayoutStatus } from '../../scripts/migrate-s3-payout-status.js';
import { PAYMENT_STATUS, PAYOUT_STATUS } from '../../src/common/constants/statuses.constant.js';

describe('Task S3.3: payoutStatus not_owed & migration', () => {
  let client;
  let stylist;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    client = await User.create({
      name: 'Client A',
      email: 'client-a@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'client',
      isEmailVerified: true,
    });
    stylist = await User.create({
      name: 'Stylist A',
      email: 'stylist-a@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'stylist',
      isEmailVerified: true,
    });
  });

  it('PAYOUT_ELIGIBILITY excludes not_owed bookings', async () => {
    await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: stylist._id,
      scheduledDate: new Date(Date.now() - 3600 * 1000),
      scheduledStartMinute: 600,
      scheduledEndMinute: 660,
      price: 500,
      duration: 60,
      status: 'no-show-stylist',
      payoutStatus: PAYOUT_STATUS.NOT_OWED,
      completedAt: new Date(),
    });

    const eligible = await bookingRepository.findCompletedUnpaidBefore(new Date());
    expect(eligible).toHaveLength(0);
  });

  it('processRefund refuses a not_owed booking, same as paid', async () => {
    const booking = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: stylist._id,
      scheduledDate: new Date(Date.now() - 3600 * 1000),
      scheduledStartMinute: 600,
      scheduledEndMinute: 660,
      price: 500,
      duration: 60,
      status: 'no-show-stylist',
      payoutStatus: PAYOUT_STATUS.NOT_OWED,
    });

    await Payment.create({
      bookingId: booking._id,
      clientId: client._id,
      amount: 500,
      status: PAYMENT_STATUS.PAID,
      platformFeeAmount: 75,
      stylistPayoutAmount: 425,
    });

    await expect(
      paymentService.processRefund({ bookingId: booking._id.toString(), refundPercentage: 100 })
    ).rejects.toThrow(/payout is already 'not_owed'/);
  });

  describe('migrate-s3-payout-status migration script', () => {
    it('dry run finds candidates without modifying documents', async () => {
      await Booking.create({
        requestId: new mongoose.Types.ObjectId(),
        offerId: new mongoose.Types.ObjectId(),
        clientId: client._id,
        stylistId: stylist._id,
        scheduledDate: new Date(),
        scheduledStartMinute: 600,
        scheduledEndMinute: 660,
        price: 500,
        duration: 60,
        status: 'no-show-stylist',
        payoutStatus: 'paid',
      });

      const res = await migrateS3PayoutStatus({ isApply: false });
      expect(res.matchedCount).toBe(1);
      expect(res.modifiedCount).toBe(0);
      expect(res.applied).toBe(false);

      const untouched = await Booking.findOne({ status: 'no-show-stylist' });
      expect(untouched.payoutStatus).toBe('paid');
    });

    it('apply backfills paid -> not_owed and is idempotent on re-run', async () => {
      const b1 = await Booking.create({
        requestId: new mongoose.Types.ObjectId(),
        offerId: new mongoose.Types.ObjectId(),
        clientId: client._id,
        stylistId: stylist._id,
        scheduledDate: new Date(),
        scheduledStartMinute: 600,
        scheduledEndMinute: 660,
        price: 500,
        duration: 60,
        status: 'no-show-stylist',
        payoutStatus: 'paid',
      });

      const res = await migrateS3PayoutStatus({ isApply: true });
      expect(res.matchedCount).toBe(1);
      expect(res.modifiedCount).toBe(1);
      expect(res.applied).toBe(true);

      const updated = await Booking.findById(b1._id);
      expect(updated.payoutStatus).toBe(PAYOUT_STATUS.NOT_OWED);

      // Idempotency: second run matches 0
      const res2 = await migrateS3PayoutStatus({ isApply: true });
      expect(res2.matchedCount).toBe(0);
      expect(res2.modifiedCount).toBe(0);
    });

    it('aborts safely if candidate booking appears in a real Payout batch', async () => {
      const b = await Booking.create({
        requestId: new mongoose.Types.ObjectId(),
        offerId: new mongoose.Types.ObjectId(),
        clientId: client._id,
        stylistId: stylist._id,
        scheduledDate: new Date(),
        scheduledStartMinute: 600,
        scheduledEndMinute: 660,
        price: 500,
        duration: 60,
        status: 'no-show-stylist',
        payoutStatus: 'paid',
      });

      await Payout.create({
        stylistId: stylist._id,
        bookingIds: [b._id],
        amount: 500,
        status: 'paid',
        method: 'bank_transfer',
      });

      await expect(migrateS3PayoutStatus({ isApply: true })).rejects.toThrow(/SAFETY ABORT/);
    });
  });
});
