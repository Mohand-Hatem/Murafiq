import '../../src/common/globals.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import Payment from '../../src/modules/payments/payment.model.js';
import * as bookingService from '../../src/modules/bookings/booking.service.js';
import * as noShowService from '../../src/modules/bookings/no-show.service.js';
import { CHECKIN_SPLIT_AT } from '../../src/modules/bookings/no-show.service.js';
import { PAYMENT_STATUS } from '../../src/common/constants/statuses.constant.js';

describe('Task S3.4: Per-party check-in timestamps and fraud gate (S-2 / BK8)', () => {
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
      name: 'Client Checkin',
      email: 'client-checkin@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'client',
      isEmailVerified: true,
    });
    stylist = await User.create({
      name: 'Stylist Checkin',
      email: 'stylist-checkin@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'stylist',
      isEmailVerified: true,
    });
  });

  it('refuses a no-show report from a party who never checked in themselves', async () => {
    // Scheduled 2 hours ago so report grace period (30 min) has passed
    const scheduledDate = new Date(Date.now() - 2 * 3600 * 1000);
    const booking = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: stylist._id,
      scheduledDate,
      scheduledStartMinute: 0,
      scheduledEndMinute: 60,
      price: 500,
      duration: 60,
      status: 'in-progress',
      checkInAt: new Date(Date.now() - 90 * 60 * 1000),
      stylistCheckInAt: new Date(Date.now() - 90 * 60 * 1000),
      clientCheckInAt: null,
      createdAt: new Date(), // created after CHECKIN_SPLIT_AT
    });

    // The CLIENT reports the stylist, but only the STYLIST checked in.
    await expect(
      noShowService.fileNoShow(client, booking._id, { evidence: [] })
    ).rejects.toThrow(/must check in/i);
  });

  it('refuses a stylist reporting client if stylist never checked in themselves', async () => {
    const scheduledDate = new Date(Date.now() - 2 * 3600 * 1000);
    const booking = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: stylist._id,
      scheduledDate,
      scheduledStartMinute: 0,
      scheduledEndMinute: 60,
      price: 500,
      duration: 60,
      status: 'in-progress',
      checkInAt: new Date(Date.now() - 90 * 60 * 1000),
      stylistCheckInAt: null,
      clientCheckInAt: new Date(Date.now() - 90 * 60 * 1000),
      createdAt: new Date(),
    });

    // The STYLIST reports the client, but only the CLIENT checked in.
    await expect(
      noShowService.fileNoShow(stylist, booking._id, { evidence: [] })
    ).rejects.toThrow(/must check in/i);
  });

  it('a check-in stamps only the checking-in party field', async () => {
    const scheduledDate = new Date(Date.now() - 3600 * 1000);
    const booking = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: stylist._id,
      scheduledDate,
      scheduledStartMinute: 0,
      scheduledEndMinute: 60,
      price: 500,
      duration: 60,
      status: 'confirmed',
    });

    await Payment.create({
      bookingId: booking._id,
      clientId: client._id,
      amount: 500,
      status: PAYMENT_STATUS.PAID,
      platformFeeAmount: 75,
      stylistPayoutAmount: 425,
    });

    // Stylist checks in
    await bookingService.checkIn(stylist, booking._id, {});

    const b = await Booking.findById(booking._id);
    expect(b.checkInAt).toBeTruthy(); // legacy retained
    expect(b.stylistCheckInAt).toBeTruthy();
    expect(b.clientCheckInAt).toBeFalsy(); // must NOT be co-written!

    // Now client checks in
    await bookingService.checkIn(client, booking._id, {});

    const bAfterClient = await Booking.findById(booking._id);
    expect(bAfterClient.stylistCheckInAt).toBeTruthy();
    expect(bAfterClient.clientCheckInAt).toBeTruthy();
  });

  it('the legacy check-in fallback does not apply to bookings created after the split', async () => {
    const scheduledDate = new Date(Date.now() - 2 * 3600 * 1000);
    const b = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: stylist._id,
      scheduledDate,
      scheduledStartMinute: 0,
      scheduledEndMinute: 60,
      price: 500,
      duration: 60,
      status: 'in-progress',
      checkInAt: new Date(Date.now() - 90 * 60 * 1000),
      clientCheckInAt: null,
      stylistCheckInAt: new Date(Date.now() - 90 * 60 * 1000),
      createdAt: new Date(Date.now() + 10000), // definitely after CHECKIN_SPLIT_AT
    });

    await expect(
      noShowService.fileNoShow(client, b._id, { evidence: [] })
    ).rejects.toThrow(/must check in/i);
  });

  it('the legacy check-in fallback does apply to bookings created before the split if checkInAt is present', async () => {
    const scheduledDate = new Date(Date.now() - 2 * 3600 * 1000);
    const splitDate = CHECKIN_SPLIT_AT || new Date('2026-09-11T00:00:00.000Z');
    const b = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: stylist._id,
      scheduledDate,
      scheduledStartMinute: 0,
      scheduledEndMinute: 60,
      price: 500,
      duration: 60,
      status: 'in-progress',
      checkInAt: new Date(Date.now() - 90 * 60 * 1000),
      clientCheckInAt: null,
      stylistCheckInAt: null,
      createdAt: new Date(splitDate.getTime() - 86400000), // 1 day before split
    });

    // Should succeed under legacy rule
    const result = await noShowService.fileNoShow(client, b._id, { evidence: [] });
    expect(result).toBeDefined();
    expect(result.booking.status).toBe('in-progress'); // still in-progress pending response/resolution
  });

  it('verifies §H.2 invariant: zero documents backfilled, additive fields initially null', async () => {
    // When a legacy booking exists with only checkInAt
    const legacy = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: stylist._id,
      scheduledDate: new Date(),
      scheduledStartMinute: 0,
      scheduledEndMinute: 60,
      price: 500,
      duration: 60,
      status: 'confirmed',
      checkInAt: new Date(),
    });

    const found = await Booking.findById(legacy._id).lean();
    expect(found.clientCheckInAt).toBeUndefined();
    expect(found.stylistCheckInAt).toBeUndefined();
  });
});
