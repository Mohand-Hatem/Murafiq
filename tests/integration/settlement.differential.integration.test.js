import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import StylistProfile from '../../src/modules/stylists/stylist-profile.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import Payment from '../../src/modules/payments/payment.model.js';
import Penalty from '../../src/modules/penalties/penalty.model.js';
import Coupon from '../../src/modules/coupons/coupon.model.js';
import LedgerEntry from '../../src/modules/ledger/ledger-entry.model.js';
import noShowService from '../../src/modules/bookings/no-show.service.js';
import { resolveDispute } from '../../src/modules/bookings/booking.service.js';
import { computeSettlement } from '../../src/common/settlement.js';
import { egpToPiastres } from '../../src/modules/ledger/ledger.service.js';
import { PAYMENT_STATUS } from '../../src/common/constants/statuses.constant.js';

describe('Settlement Differential Integration — Live DB comparison for NO_SHOW and DISPUTE', () => {
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
    client = await User.create({
      name: 'Test Client',
      email: 'client@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'client',
      isEmailVerified: true,
    });
    stylist = await User.create({
      name: 'Test Stylist',
      email: 'stylist@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'stylist',
      isEmailVerified: true,
    });
    admin = await User.create({
      name: 'Test Admin',
      email: 'admin@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'admin',
      isEmailVerified: true,
    });
    await StylistProfile.create({
      userId: stylist._id,
      specialty: 'stylist',
      hourlyPrice: 100,
    });
  });

  const createBookingAndPayment = async ({
    status = 'in-progress',
    reportedAgainst = null,
    price = 1000,
    platformFeePercentage = 15,
  }) => {
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
      status,
      payoutStatus: 'unpaid',
      checkInAt: new Date(Date.now() - 90 * 60 * 1000),
      ...(reportedAgainst
        ? {
            noShowDetails: {
              reportedBy: reportedAgainst === 'stylist' ? client._id : stylist._id,
              reportedAt: new Date(),
              reportedAgainst,
              evidence: [],
            },
          }
        : {}),
    });

    const payment = await Payment.create({
      bookingId: booking._id,
      clientId: client._id,
      amount: price,
      status: PAYMENT_STATUS.PAID,
      platformFeePercentage,
      platformFeeAmount: price * (platformFeePercentage / 100),
      stylistPayoutAmount: price * (1 - platformFeePercentage / 100),
    });

    return { booking, payment };
  };

  // Case 1: Stylist No-Show
  it('1. Stylist No-Show: persisted records match computeSettlement exactly', async () => {
    const price = 1000;
    const { booking, payment } = await createBookingAndPayment({ reportedAgainst: 'stylist', price });

    await noShowService.resolveNoShow(booking._id.toString(), {
      confirmedBy: client._id.toString(),
      reason: 'Stylist never arrived',
    });

    const expected = computeSettlement({ price, event: 'NO_SHOW', actor: 'stylist' });

    const updatedPayment = await Payment.findById(payment._id);
    const updatedBooking = await Booking.findById(booking._id);
    const penalty = await Penalty.findOne({ bookingId: booking._id });
    const coupon = await Coupon.findOne({ sourceBookingId: booking._id });
    const ledgerEntries = await LedgerEntry.find({ bookingId: booking._id });

    // Payment amounts
    expect(updatedPayment.status).toBe(PAYMENT_STATUS.REFUNDED);
    expect(updatedPayment.refundAmount).toBe(expected.refundAmount);
    expect(updatedPayment.stylistPayoutAmount).toBe(expected.stylistCompensationAmount);
    expect(updatedPayment.platformFeeAmount).toBe(expected.platformFeeAmount);

    // Booking status & payoutStatus
    expect(updatedBooking.status).toBe('no-show-stylist');
    expect(updatedBooking.payoutStatus).toBe('not_owed'); // S3.3: nothing owed to stylist

    // Penalty & coupon
    expect(penalty).not.toBeNull();
    expect(penalty.assessedMinor).toBe(egpToPiastres(expected.penaltyAmount));
    expect(coupon !== null).toBe(expected.couponEligible);

    // Ledger entries
    const refundRelease = ledgerEntries.find(
      (e) => e.entryType === 'ESCROW_RELEASE' && e.direction === 'DEBIT'
    );
    const refundCredit = ledgerEntries.find((e) => e.entryType === 'REFUND' && e.direction === 'CREDIT');
    const penaltyStylist = ledgerEntries.find(
      (e) => e.entryType === 'PENALTY_ASSESSMENT' && e.accountType === 'STYLIST'
    );
    const penaltyPlatform = ledgerEntries.find(
      (e) => e.entryType === 'PENALTY_ASSESSMENT' && e.accountType === 'PLATFORM'
    );

    expect(refundRelease.amountMinor).toBe(egpToPiastres(expected.refundAmount));
    expect(refundCredit.amountMinor).toBe(egpToPiastres(expected.refundAmount));
    expect(penaltyStylist.amountMinor).toBe(egpToPiastres(expected.penaltyAmount));
    expect(penaltyPlatform.amountMinor).toBe(egpToPiastres(expected.penaltyAmount));
  });

  // Case 2: Client No-Show
  it('2. Client No-Show: persisted records match computeSettlement exactly', async () => {
    const price = 1000;
    const { booking, payment } = await createBookingAndPayment({ reportedAgainst: 'client', price });

    await noShowService.resolveNoShow(booking._id.toString(), {
      confirmedBy: stylist._id.toString(),
      reason: 'Client absent',
    });

    const expected = computeSettlement({ price, event: 'NO_SHOW', actor: 'client' });

    const updatedPayment = await Payment.findById(payment._id);
    const updatedBooking = await Booking.findById(booking._id);
    const penalty = await Penalty.findOne({ bookingId: booking._id });
    const coupon = await Coupon.findOne({ sourceBookingId: booking._id });
    const ledgerEntries = await LedgerEntry.find({ bookingId: booking._id });

    // Payment amounts
    expect(updatedPayment.status).toBe(PAYMENT_STATUS.PARTIALLY_REFUNDED);
    expect(updatedPayment.refundAmount).toBe(expected.refundAmount);
    expect(updatedPayment.stylistPayoutAmount).toBe(expected.stylistCompensationAmount);
    expect(updatedPayment.platformFeeAmount).toBe(expected.platformFeeAmount);

    // Booking status & payoutStatus
    expect(updatedBooking.status).toBe('no-show-client');
    expect(updatedBooking.payoutStatus).toBe('unpaid'); // stylist is owed compensation

    // Penalty & coupon (none for client no-show)
    expect(penalty).toBeNull();
    expect(expected.penaltyAmount).toBe(0);
    expect(coupon).toBeNull();
    expect(expected.couponEligible).toBe(false);

    // Ledger entries
    const refundRelease = ledgerEntries.find(
      (e) => e.entryType === 'ESCROW_RELEASE' && e.direction === 'DEBIT'
    );
    const refundCredit = ledgerEntries.find((e) => e.entryType === 'REFUND' && e.direction === 'CREDIT');
    const feeRelease = ledgerEntries.find(
      (e) => e.entryType === 'PLATFORM_FEE' && e.accountType === 'ESCROW' && e.direction === 'DEBIT'
    );
    const feeCredit = ledgerEntries.find(
      (e) => e.entryType === 'PLATFORM_FEE' && e.accountType === 'PLATFORM' && e.direction === 'CREDIT'
    );

    expect(refundRelease.amountMinor).toBe(egpToPiastres(expected.refundAmount));
    expect(refundCredit.amountMinor).toBe(egpToPiastres(expected.refundAmount));
    expect(feeRelease.amountMinor).toBe(egpToPiastres(expected.platformFeeAmount));
    expect(feeCredit.amountMinor).toBe(egpToPiastres(expected.platformFeeAmount));
  });

  // Case 3: Partial-Refund Dispute (Split)
  it('3. Dispute Partial-Refund (Split): persisted records match computeSettlement exactly', async () => {
    const price = 1000;
    const refundPercentage = 40;
    const platformFeePercentage = 15;
    const { booking, payment } = await createBookingAndPayment({
      status: 'disputed',
      price,
      platformFeePercentage,
    });

    await resolveDispute(admin._id.toString(), booking._id.toString(), {
      outcome: 'completed',
      refundPercentage,
      resolutionNotes: 'Partial service delivered',
    });

    const expected = computeSettlement({
      price,
      event: 'DISPUTE',
      actor: 'admin',
      refundPercentage,
      platformFeePercentage,
    });

    const updatedPayment = await Payment.findById(payment._id);
    const updatedBooking = await Booking.findById(booking._id);
    const ledgerEntries = await LedgerEntry.find({ bookingId: booking._id });

    // Payment amounts
    expect(updatedPayment.status).toBe(PAYMENT_STATUS.PARTIALLY_REFUNDED);
    expect(updatedPayment.refundAmount).toBe(expected.refundAmount);
    expect(updatedPayment.stylistPayoutAmount).toBe(expected.stylistCompensationAmount);
    expect(updatedPayment.platformFeeAmount).toBe(expected.platformFeeAmount);

    // Booking status & payoutStatus
    expect(updatedBooking.status).toBe('completed');
    expect(updatedBooking.payoutStatus).toBe('unpaid'); // stylist retains earned share

    // Ledger entries
    const refundRelease = ledgerEntries.find(
      (e) => e.entryType === 'ESCROW_RELEASE' && e.direction === 'DEBIT'
    );
    const refundCredit = ledgerEntries.find((e) => e.entryType === 'REFUND' && e.direction === 'CREDIT');
    const feeRelease = ledgerEntries.find(
      (e) => e.entryType === 'PLATFORM_FEE' && e.accountType === 'ESCROW' && e.direction === 'DEBIT'
    );
    const feeCredit = ledgerEntries.find(
      (e) => e.entryType === 'PLATFORM_FEE' && e.accountType === 'PLATFORM' && e.direction === 'CREDIT'
    );

    expect(refundRelease.amountMinor).toBe(egpToPiastres(expected.refundAmount));
    expect(refundCredit.amountMinor).toBe(egpToPiastres(expected.refundAmount));
    expect(feeRelease.amountMinor).toBe(egpToPiastres(expected.platformFeeAmount));
    expect(feeCredit.amountMinor).toBe(egpToPiastres(expected.platformFeeAmount));
  });

  // Case 4: 100%-Refund Dispute
  it('4. Dispute Full-Refund (100%): persisted records match computeSettlement exactly', async () => {
    const price = 1000;
    const refundPercentage = 100;
    const platformFeePercentage = 15;
    const { booking, payment } = await createBookingAndPayment({
      status: 'disputed',
      price,
      platformFeePercentage,
    });

    await resolveDispute(admin._id.toString(), booking._id.toString(), {
      outcome: 'cancelled',
      refundPercentage,
      resolutionNotes: 'Full client refund',
    });

    const expected = computeSettlement({
      price,
      event: 'DISPUTE',
      actor: 'admin',
      refundPercentage,
      platformFeePercentage,
    });

    const updatedPayment = await Payment.findById(payment._id);
    const updatedBooking = await Booking.findById(booking._id);
    const ledgerEntries = await LedgerEntry.find({ bookingId: booking._id });

    // Payment amounts
    expect(updatedPayment.status).toBe(PAYMENT_STATUS.REFUNDED);
    expect(updatedPayment.refundAmount).toBe(expected.refundAmount);
    expect(updatedPayment.stylistPayoutAmount).toBe(expected.stylistCompensationAmount);
    expect(updatedPayment.platformFeeAmount).toBe(expected.platformFeeAmount);

    // Booking status
    expect(updatedBooking.status).toBe('cancelled');

    // Ledger entries
    const refundRelease = ledgerEntries.find(
      (e) => e.entryType === 'ESCROW_RELEASE' && e.direction === 'DEBIT'
    );
    const refundCredit = ledgerEntries.find((e) => e.entryType === 'REFUND' && e.direction === 'CREDIT');

    expect(refundRelease.amountMinor).toBe(egpToPiastres(expected.refundAmount));
    expect(refundCredit.amountMinor).toBe(egpToPiastres(expected.refundAmount));
    expect(expected.stylistCompensationAmount).toBe(0);
    expect(expected.platformFeeAmount).toBe(0);
  });

  describe('Fractional price settlement differential integration', () => {
    const FRACTIONAL_PRICES = [333.33, 777.77, 100.01];

    it.each(FRACTIONAL_PRICES)(
      'Client No-Show with price=%s: persisted records match computeSettlement byte-for-byte',
      async (price) => {
        const { booking, payment } = await createBookingAndPayment({
          reportedAgainst: 'client',
          price,
        });

        await noShowService.resolveNoShow(booking._id.toString(), {
          confirmedBy: stylist._id.toString(),
          reason: 'Client absent',
        });

        const expected = computeSettlement({ price, event: 'NO_SHOW', actor: 'client' });
        const updatedPayment = await Payment.findById(payment._id);

        expect(updatedPayment.status).toBe(PAYMENT_STATUS.PARTIALLY_REFUNDED);
        expect(updatedPayment.refundAmount).toBe(expected.refundAmount);
        expect(updatedPayment.stylistPayoutAmount).toBe(expected.stylistCompensationAmount);
        expect(updatedPayment.platformFeeAmount).toBe(expected.platformFeeAmount);
      }
    );

    it.each(FRACTIONAL_PRICES)(
      'Stylist No-Show with price=%s: persisted records match computeSettlement byte-for-byte',
      async (price) => {
        const { booking, payment } = await createBookingAndPayment({
          reportedAgainst: 'stylist',
          price,
        });

        await noShowService.resolveNoShow(booking._id.toString(), {
          confirmedBy: client._id.toString(),
          reason: 'Stylist absent',
        });

        const expected = computeSettlement({ price, event: 'NO_SHOW', actor: 'stylist' });
        const updatedPayment = await Payment.findById(payment._id);
        const penalty = await Penalty.findOne({ bookingId: booking._id });

        expect(updatedPayment.status).toBe(PAYMENT_STATUS.REFUNDED);
        expect(updatedPayment.refundAmount).toBe(expected.refundAmount);
        expect(penalty.assessedMinor).toBe(egpToPiastres(expected.penaltyAmount));
      }
    );

    it.each(FRACTIONAL_PRICES)(
      'Dispute partial refund with price=%s: persisted records match computeSettlement byte-for-byte',
      async (price) => {
        const refundPercentage = 35;
        const platformFeePercentage = 15;
        const { booking, payment } = await createBookingAndPayment({
          status: 'disputed',
          price,
          platformFeePercentage,
        });

        await resolveDispute(admin._id.toString(), booking._id.toString(), {
          outcome: 'completed',
          refundPercentage,
          resolutionNotes: 'Dispute partial settlement',
        });

        const expected = computeSettlement({
          price,
          event: 'DISPUTE',
          actor: 'admin',
          refundPercentage,
          platformFeePercentage,
        });

        const updatedPayment = await Payment.findById(payment._id);
        expect(updatedPayment.status).toBe(PAYMENT_STATUS.PARTIALLY_REFUNDED);
        expect(updatedPayment.refundAmount).toBe(expected.refundAmount);
        expect(updatedPayment.stylistPayoutAmount).toBe(expected.stylistCompensationAmount);
        expect(updatedPayment.platformFeeAmount).toBe(expected.platformFeeAmount);
      }
    );
  });
});
