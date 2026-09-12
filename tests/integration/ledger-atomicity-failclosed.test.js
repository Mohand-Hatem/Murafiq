import '../../src/common/globals.js';
import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import Payment from '../../src/modules/payments/payment.model.js';
import LedgerEntry from '../../src/modules/ledger/ledger-entry.model.js';
import Plan from '../../src/modules/subscriptions/plan.model.js';
import Subscription from '../../src/modules/subscriptions/subscription.model.js';
import * as bookingService from '../../src/modules/bookings/booking.service.js';
import paymentService from '../../src/modules/payments/payment.service.js';
import ledgerRepository from '../../src/modules/ledger/ledger.repository.js';
import { PAYMENT_STATUS } from '../../src/common/constants/statuses.constant.js';

describe('Task S4.1: Fail-closed atomic ledger double-entry pairs', () => {
  let client;
  let stylist;

  beforeAll(async () => {
    await connectTestDB();
    await Promise.all([Booking.init(), Payment.init(), LedgerEntry.init()]);
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    client = await User.create({
      name: 'Client Ledger',
      email: 'client-ledger@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'client',
      isEmailVerified: true,
    });
    stylist = await User.create({
      name: 'Stylist Ledger',
      email: 'stylist-ledger@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'stylist',
      isEmailVerified: true,
    });
  });

  it('cancellation penalty ledger failure aborts transaction and writes 0 ledger entries', async () => {
    const booking = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: stylist._id,
      scheduledDate: new Date(Date.now() + 6 * 3600 * 1000), // late cancel
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

    const realCreate = ledgerRepository.createEntry.bind(ledgerRepository);
    let call = 0;
    const spy = jest.spyOn(ledgerRepository, 'createEntry').mockImplementation(async (data, session) => {
      call += 1;
      if (call === 2) {
        throw new Error('Credit ledger entry network/disk failure');
      }
      return realCreate(data, session);
    });

    try {
      await expect(
        bookingService.cancelBooking(stylist, booking._id, { reason: 'emergency' })
      ).rejects.toThrow(/Credit ledger entry/i);

      // Verify fail-closed all-or-nothing:
      const entries = await LedgerEntry.find({ bookingId: booking._id });
      expect(entries).toHaveLength(0);

      // Verify booking status was rolled back (not cancelled):
      const b = await Booking.findById(booking._id);
      expect(b.status).toBe('confirmed');
    } finally {
      spy.mockRestore();
    }
  });

  it('processRefund ledger failure aborts transaction and does not finalize refund', async () => {
    const booking = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: stylist._id,
      scheduledDate: new Date(Date.now() + 48 * 3600 * 1000),
      scheduledStartMinute: 600,
      scheduledEndMinute: 660,
      price: 1000,
      duration: 60,
      status: 'confirmed',
    });

    const payment = await Payment.create({
      bookingId: booking._id,
      clientId: client._id,
      amount: 1000,
      status: PAYMENT_STATUS.PAID,
      platformFeeAmount: 150,
      stylistPayoutAmount: 850,
    });

    const realCreate = ledgerRepository.createEntry.bind(ledgerRepository);
    let call = 0;
    const spy = jest.spyOn(ledgerRepository, 'createEntry').mockImplementation(async (data, session) => {
      call += 1;
      if (call === 2) {
        throw new Error('Refund credit ledger entry failure');
      }
      return realCreate(data, session);
    });

    try {
      await expect(
        paymentService.processRefund({
          bookingId: booking._id,
          refundAmount: 970,
          platformFeeAmount: 30,
          reason: 'client_cancellation_early',
          status: PAYMENT_STATUS.REFUNDED,
        })
      ).rejects.toThrow(/Refund credit ledger entry failure/i);

      // Verify fail-closed all-or-nothing: 0 entries written
      const entries = await LedgerEntry.find({ paymentId: payment._id });
      expect(entries).toHaveLength(0);

      // Verify payment was rolled back (still REFUNDING, not finalized to REFUNDED)
      const p = await Payment.findById(payment._id);
      expect(p.status).toBe(PAYMENT_STATUS.REFUNDING);
    } finally {
      spy.mockRestore();
    }
  });

  it('paid subscription activation ledger failure aborts transaction and does not activate plan', async () => {
    const { subscribe } = await import('../../src/modules/subscriptions/subscription.service.js');
    await Plan.create({
      code: 'client.pro.failclosed',
      name: 'Client Pro Test',
      role: 'client',
      tier: 'pro',
      priceEgp: 200,
      isActive: true,
      features: [],
    });

    const realCreate = ledgerRepository.createEntry.bind(ledgerRepository);
    let call = 0;
    const spy = jest.spyOn(ledgerRepository, 'createEntry').mockImplementation(async (data, session) => {
      call += 1;
      if (call === 2) {
        throw new Error('Subscription credit ledger failure');
      }
      return realCreate(data, session);
    });

    try {
      await expect(
        subscribe(client._id, 'client', {
          planCode: 'client.pro.failclosed',
          billingCycle: 'monthly',
          paid: true,
          chargedAmountEgp: 200,
        })
      ).rejects.toThrow(/Subscription credit ledger failure/i);

      // Verify fail-closed: 0 subscription ledger entries
      const entries = await LedgerEntry.find({ accountId: client._id.toString() });
      expect(entries).toHaveLength(0);

      // Verify subscription document was rolled back
      const sub = await Subscription.findOne({ userId: client._id, planCode: 'client.pro.failclosed' });
      expect(sub).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
