import '../../src/common/globals.js';
import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import StylistProfile from '../../src/modules/stylists/stylist-profile.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import Payment from '../../src/modules/payments/payment.model.js';
import Penalty from '../../src/modules/penalties/penalty.model.js';
import Coupon from '../../src/modules/coupons/coupon.model.js';
import bookingRepository from '../../src/modules/bookings/booking.repository.js';
import ledgerService from '../../src/modules/ledger/ledger.service.js';
import noShowService from '../../src/modules/bookings/no-show.service.js';
import { PAYMENT_STATUS } from '../../src/common/constants/statuses.constant.js';

/**
 * End-to-end regression test for docs/AUDIT_2026_09_FULL_SYSTEM.md finding X1.
 *
 * A stylist no-show has NO_SHOW_POLICY.STYLIST.STYLIST_PERCENTAGE === 0, which
 * resolveNoShow used to interpret as "nothing owed to the stylist" by writing
 * booking.payoutStatus:'paid' BEFORE calling the refund. processRefund's own guard
 * ("this booking's payout is already 'X', reconcile the batch first") reads that same
 * 'paid' value as "already disbursed by a real Payout batch" and refuses — so the
 * client's refund silently and permanently failed on every stylist no-show, while the
 * function still reported success.
 *
 * This runs against real Mongo documents (no mocked repositories) specifically because
 * both halves of that collision — the payoutStatus write and the processRefund guard —
 * were each individually unit-tested and passing; only their interaction, which requires
 * real persisted state, was broken. See tests/unit/no-show.service.test.js and
 * tests/unit/hardening-followup.test.js for the (still valid, still passing) unit tests
 * of each half in isolation.
 */
describe('resolveNoShow — real refund persistence (X1 regression)', () => {
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
      name: 'No-Show Client',
      email: 'noshow-client@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'client',
      isEmailVerified: true,
    });
    stylist = await User.create({
      name: 'No-Show Stylist',
      email: 'noshow-stylist@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'stylist',
      isEmailVerified: true,
    });
    await StylistProfile.create({
      userId: stylist._id,
      specialty: 'stylist',
      hourlyPrice: 100,
    });
  });

  const createBookingAndPayment = async ({ reportedAgainst, price = 500 }) => {
    const booking = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: stylist._id,
      scheduledDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
      scheduledStartMinute: 600,
      scheduledEndMinute: 660,
      price,
      duration: 60,
      status: 'in-progress',
      checkInAt: new Date(Date.now() - 90 * 60 * 1000),
      noShowDetails: {
        reportedBy: reportedAgainst === 'stylist' ? client._id : stylist._id,
        reportedAt: new Date(),
        reportedAgainst,
        evidence: [],
      },
    });

    const payment = await Payment.create({
      bookingId: booking._id,
      clientId: client._id,
      amount: price,
      status: PAYMENT_STATUS.PAID,
      platformFeeAmount: price * 0.15,
      stylistPayoutAmount: price * 0.85,
    });

    return { booking, payment };
  };

  it('refunds the client in full when the STYLIST is the no-show', async () => {
    const { booking, payment } = await createBookingAndPayment({ reportedAgainst: 'stylist' });

    await noShowService.resolveNoShow(booking._id.toString(), {
      confirmedBy: client._id.toString(),
      reason: 'Accepted by reported party',
    });

    const updatedPayment = await Payment.findById(payment._id);
    const updatedBooking = await Booking.findById(booking._id);

    // The actual bug: this used to stay 'paid' with refundAmount undefined forever.
    expect(updatedPayment.status).toBe(PAYMENT_STATUS.REFUNDED);
    expect(updatedPayment.refundAmount).toBe(500);
    expect(updatedPayment.refundError).toBeUndefined();

    expect(updatedBooking.status).toBe('no-show-stylist');
    // Task S3.3: 'not_owed' replaces the 'paid' overload for stylist no-shows where nothing is owed
    expect(updatedBooking.payoutStatus).toBe('not_owed');
  });

  it('still partially refunds the client when the CLIENT is the no-show (no regression)', async () => {
    const { booking, payment } = await createBookingAndPayment({ reportedAgainst: 'client' });

    await noShowService.resolveNoShow(booking._id.toString(), {
      confirmedBy: stylist._id.toString(),
      reason: 'Accepted by reported party',
    });

    const updatedPayment = await Payment.findById(payment._id);
    const updatedBooking = await Booking.findById(booking._id);

    expect(updatedPayment.status).toBe(PAYMENT_STATUS.PARTIALLY_REFUNDED);
    expect(updatedPayment.refundAmount).toBe(300); // 60% of 500
    expect(updatedPayment.stylistPayoutAmount).toBe(100); // 20% of 500

    expect(updatedBooking.status).toBe('no-show-client');
    // The stylist is owed their 20% share, so this booking must still reach a payout batch.
    expect(updatedBooking.payoutStatus).toBe('unpaid');
  });

  // Regression test for finding X9: a booking that has ALREADY moved on (e.g. mutual
  // completion confirmed between the report being filed and the settlement sweep running)
  // must never be overwritten with a no-show status, and no money may move for it.
  it('refuses to settle a no-show once the booking has already completed (X9 regression)', async () => {
    const { booking, payment } = await createBookingAndPayment({ reportedAgainst: 'stylist' });

    // Simulate the race: mutual completion lands after the report was filed but before
    // the sweep/response settles it.
    await Booking.updateOne(
      { _id: booking._id },
      { $set: { status: 'completed', completedAt: new Date() } }
    );

    const result = await noShowService.resolveNoShow(booking._id.toString(), {
      confirmedBy: client._id.toString(),
      reason: 'Accepted by reported party',
    });

    expect(result.status).toBe('completed');

    const untouchedPayment = await Payment.findById(payment._id);
    const untouchedBooking = await Booking.findById(booking._id);

    // No money moved, and the completed booking was not resurrected as a no-show.
    expect(untouchedPayment.status).toBe(PAYMENT_STATUS.PAID);
    expect(untouchedPayment.refundedAt).toBeFalsy();
    expect(untouchedBooking.status).toBe('completed');
  });

  // Regression test for finding NS3: Steps C runs inside withTransaction so a ledger failure
  // rolls back payoutStatus and Penalty atomically
  it('NS3: rolls back payoutStatus and penalty if ledger write fails in transaction', async () => {
    const { booking } = await createBookingAndPayment({ reportedAgainst: 'stylist', price: 1000 });

    const spy = jest.spyOn(ledgerService, 'postDoubleEntry').mockRejectedValueOnce(new Error('ledger error'));

    await expect(
      noShowService.resolveNoShow(booking._id.toString(), { reason: 'test rollback' })
    ).rejects.toThrow('ledger error');

    spy.mockRestore();

    const rollbackedBooking = await Booking.findById(booking._id);
    expect(rollbackedBooking.payoutStatus).toBe('unpaid');
    expect(await Penalty.countDocuments({ bookingId: booking._id })).toBe(0);
  });

  // Integration test for Task S3.2a (NS5): resumes a settlement that crashed after refund
  it('NS5: resumes a settlement that crashed after the refund', async () => {
    const { booking, payment } = await createBookingAndPayment({ reportedAgainst: 'stylist', price: 1000 });

    // Crash between the provider refund (Step B) and the settlement transaction (Step C)
    const spy = jest.spyOn(ledgerService, 'postDoubleEntry').mockRejectedValueOnce(new Error('crash'));
    await expect(
      noShowService.resolveNoShow(booking._id.toString(), { reason: 'test crash' })
    ).rejects.toThrow('crash');

    const mid = await Booking.findById(booking._id);
    expect(mid.status).toBe('no-show-stylist'); // Step A committed
    expect(mid.noShowDetails.settlementCompletedAt).toBeFalsy(); // Step C/D/E did not
    expect(await Penalty.countDocuments({ bookingId: booking._id })).toBe(0);

    // The sweep finds it (findPendingNoShowReports cannot)
    expect(await bookingRepository.findPendingNoShowReports(new Date())).toHaveLength(0);
    const stuck = await bookingRepository.findUnfinishedNoShowSettlements(5, 50);
    expect(stuck.map((b) => b._id.toString())).toContain(booking._id.toString());

    spy.mockRestore();

    // Resuming completes the settlement without double-refunding
    await noShowService.resolveNoShow(booking._id.toString(), { reason: 'resume' });

    const done = await Booking.findById(booking._id);
    expect(done.noShowDetails.settlementCompletedAt).toBeTruthy();
    expect(await Penalty.countDocuments({ bookingId: booking._id })).toBe(1); // not 2
    expect(await Coupon.countDocuments({ sourceBookingId: booking._id })).toBe(1);
    const p = await Payment.findById(payment._id);
    expect(p.refundAmount).toBe(1000); // not double-refunded
  });

  it('halts instead of guessing when the payment is stuck in REFUNDING', async () => {
    const { booking, payment } = await createBookingAndPayment({ reportedAgainst: 'stylist', price: 1000 });
    await Payment.updateOne({ _id: payment._id }, { $set: { status: PAYMENT_STATUS.REFUNDING } });

    await expect(
      noShowService.resolveNoShow(booking._id.toString(), { reason: 'test ambiguous' })
    ).rejects.toThrow(/Refund state is ambiguous/i);

    const updatedBooking = await Booking.findById(booking._id);
    expect(updatedBooking.noShowDetails.postSettlementErrors).toHaveLength(1);
    expect(updatedBooking.noShowDetails.postSettlementErrors[0].step).toBe('refund');
  });
});
