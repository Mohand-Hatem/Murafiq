import '../../src/common/globals.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import Payment from '../../src/modules/payments/payment.model.js';
import * as bookingService from '../../src/modules/bookings/booking.service.js';
import bookingRepository from '../../src/modules/bookings/booking.repository.js';
import eventBus from '../../src/common/events/event-bus.js';
import { EVENTS } from '../../src/common/constants/events.constant.js';
import { PAYMENT_STATUS } from '../../src/common/constants/statuses.constant.js';
import getBusinessDayRange from '../../src/common/utils/businessDay.util.js';

// A session is 'in-progress' only once BOTH parties have checked in. A single check-in
// means "I'm here, waiting" and leaves the booking 'confirmed'.
describe('Check-in: session starts only when both parties are present', () => {
  let client;
  let stylist;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    await clearTestDB();
    client = await User.create({
      name: 'Client Both',
      email: 'client-both@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'client',
      isEmailVerified: true,
    });
    stylist = await User.create({
      name: 'Stylist Both',
      email: 'stylist-both@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'stylist',
      isEmailVerified: true,
    });
  });

  // A paid booking whose check-in window is open right now.
  const createOpenBooking = async (overrides = {}) => {
    const scheduledDate = new Date();
    const { startOfDay } = getBusinessDayRange(scheduledDate, 'Africa/Cairo');
    const nowMinutes = Math.floor((Date.now() - startOfDay.getTime()) / (60 * 1000));
    const booking = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: stylist._id,
      scheduledDate,
      scheduledStartMinute: Math.max(0, nowMinutes - 10),
      scheduledEndMinute: nowMinutes + 60,
      price: 500,
      duration: 60,
      status: 'confirmed',
      ...overrides,
    });
    await Payment.create({
      bookingId: booking._id,
      clientId: client._id,
      amount: 500,
      status: PAYMENT_STATUS.PAID,
      platformFeeAmount: 100,
      stylistPayoutAmount: 400,
    });
    return booking;
  };

  describe('status transition', () => {
    it('keeps the booking confirmed after the first check-in', async () => {
      const booking = await createOpenBooking();

      const dto = await bookingService.checkIn(stylist, booking._id, {});

      expect(dto.status).toBe('confirmed');
      const stored = await Booking.findById(booking._id);
      expect(stored.status).toBe('confirmed');
      expect(stored.stylistCheckInAt).toBeTruthy();
      expect(stored.clientCheckInAt).toBeFalsy();
    });

    it('moves to in-progress when the second party checks in', async () => {
      const booking = await createOpenBooking();

      await bookingService.checkIn(client, booking._id, {});
      const dto = await bookingService.checkIn(stylist, booking._id, {});

      expect(dto.status).toBe('in-progress');
      const stored = await Booking.findById(booking._id);
      expect(stored.status).toBe('in-progress');
    });

    it('a repeated check-in by the same party does not start the session', async () => {
      const booking = await createOpenBooking();

      await bookingService.checkIn(client, booking._id, {});
      const dto = await bookingService.checkIn(client, booking._id, {});

      expect(dto.status).toBe('confirmed');
    });

    it('simultaneous check-ins by both parties still start the session', async () => {
      const booking = await createOpenBooking();

      await Promise.all([
        bookingService.checkIn(client, booking._id, {}),
        bookingService.checkIn(stylist, booking._id, {}),
      ]);

      const stored = await Booking.findById(booking._id);
      expect(stored.status).toBe('in-progress');
      expect(stored.clientCheckInAt).toBeTruthy();
      expect(stored.stylistCheckInAt).toBeTruthy();
    });

    it('a legacy booking already in-progress after one check-in accepts the other party', async () => {
      const booking = await createOpenBooking({
        status: 'in-progress',
        checkInAt: new Date(),
        stylistCheckInAt: new Date(),
      });

      const dto = await bookingService.checkIn(client, booking._id, {});

      expect(dto.status).toBe('in-progress');
    });

    it('confirm-completion is refused while only one party has checked in', async () => {
      const booking = await createOpenBooking();
      await bookingService.checkIn(stylist, booking._id, {});

      await expect(bookingService.confirmCompletion(stylist, booking._id)).rejects.toThrow(
        /in-progress/i
      );
    });
  });

  describe('check-in location', () => {
    it("stores each party's location separately", async () => {
      const booking = await createOpenBooking();

      await bookingService.checkIn(client, booking._id, { lat: 30.01, lng: 31.01 });
      await bookingService.checkIn(stylist, booking._id, { lat: 30.02, lng: 31.02 });

      const stored = await Booking.findById(booking._id).lean();
      expect(stored.clientCheckInLocation).toEqual({ lat: 30.01, lng: 31.01 });
      expect(stored.stylistCheckInLocation).toEqual({ lat: 30.02, lng: 31.02 });
    });

    it('exposes per-party attendance on the booking response', async () => {
      const booking = await createOpenBooking();

      const dto = await bookingService.checkIn(stylist, booking._id, { lat: 30.02, lng: 31.02 });

      expect(dto.stylistCheckInAt).toBeTruthy();
      expect(dto.clientCheckInAt).toBeNull();
      expect(dto.stylistCheckInLocation).toEqual({ lat: 30.02, lng: 31.02 });
      expect(dto.clientCheckInLocation).toBeNull();
    });

    it("a repeated check-in keeps the party's first location", async () => {
      const booking = await createOpenBooking();

      await bookingService.checkIn(client, booking._id, { lat: 30.01, lng: 31.01 });
      await bookingService.checkIn(client, booking._id, { lat: 29.5, lng: 32.5 });

      const stored = await Booking.findById(booking._id).lean();
      expect(stored.clientCheckInLocation).toEqual({ lat: 30.01, lng: 31.01 });
    });
  });

  describe('CHECK_IN_COMPLETED event', () => {
    let events;
    const record = (payload) => events.push(payload);

    beforeEach(() => {
      events = [];
      eventBus.on(EVENTS.CHECK_IN_COMPLETED, record);
    });

    afterEach(() => {
      eventBus.off(EVENTS.CHECK_IN_COMPLETED, record);
    });

    it('reports who checked in and whether the session started', async () => {
      const booking = await createOpenBooking();

      await bookingService.checkIn(stylist, booking._id, {});
      await bookingService.checkIn(client, booking._id, {});

      expect(events).toEqual([
        expect.objectContaining({
          bookingId: booking._id.toString(),
          clientId: client._id.toString(),
          stylistId: stylist._id.toString(),
          checkedInBy: 'stylist',
          sessionStarted: false,
        }),
        expect.objectContaining({ checkedInBy: 'client', sessionStarted: true }),
      ]);
    });

    it('a repeated check-in by the same party emits nothing', async () => {
      const booking = await createOpenBooking();

      await bookingService.checkIn(client, booking._id, {});
      await bookingService.checkIn(client, booking._id, {});

      expect(events).toHaveLength(1);
    });

    it('simultaneous check-ins announce the session start exactly once', async () => {
      const booking = await createOpenBooking();

      await Promise.all([
        bookingService.checkIn(client, booking._id, {}),
        bookingService.checkIn(stylist, booking._id, {}),
      ]);

      expect(events.filter((e) => e.sessionStarted)).toHaveLength(1);
    });
  });

  // Once anyone has checked in, the money outcome belongs to the no-show / completion flows.
  // Otherwise a client could dodge a no-show (60% refund, 20% to the stylist) by cancelling
  // late (80% refund, stylist gets nothing) while the stylist is standing at the door.
  describe('cancellation after check-in', () => {
    it('refuses a client cancellation once the stylist has checked in', async () => {
      const booking = await createOpenBooking();
      await bookingService.checkIn(stylist, booking._id, {});

      await expect(bookingService.cancelBooking(client, booking._id, {})).rejects.toThrow(
        /no-show/i
      );
      expect((await Booking.findById(booking._id)).status).toBe('confirmed');
    });

    it('refuses a stylist cancellation once the client has checked in', async () => {
      const booking = await createOpenBooking();
      await bookingService.checkIn(client, booking._id, {});

      await expect(bookingService.cancelBooking(stylist, booking._id, {})).rejects.toThrow(
        /no-show/i
      );
    });

    it('refuses a cancellation by the party who checked in themselves', async () => {
      const booking = await createOpenBooking();
      await bookingService.checkIn(client, booking._id, {});

      await expect(bookingService.cancelBooking(client, booking._id, {})).rejects.toThrow(
        /no-show/i
      );
    });

    it('refuses an admin cancellation once anyone has checked in', async () => {
      const booking = await createOpenBooking();
      await bookingService.checkIn(stylist, booking._id, {});
      const admin = { _id: new mongoose.Types.ObjectId(), role: 'admin' };

      await expect(bookingService.cancelBooking(admin, booking._id, {})).rejects.toThrow(
        /no-show/i
      );
    });

    it('does not cancel when a check-in lands between the cancel read and its write', async () => {
      const booking = await createOpenBooking();
      // The cancel reads the booking before anyone checked in...
      const staleRead = await bookingRepository.findById(booking._id);
      // ...then the stylist checks in before the cancel writes.
      await bookingService.checkIn(stylist, booking._id, {});
      jest.spyOn(bookingRepository, 'findById').mockResolvedValueOnce(staleRead);

      await expect(bookingService.cancelBooking(client, booking._id, {})).rejects.toThrow(
        /no longer cancellable/i
      );
      expect((await Booking.findById(booking._id)).status).toBe('confirmed');
    });

    it('still allows cancellation when nobody has checked in', async () => {
      const booking = await createOpenBooking();

      const dto = await bookingService.cancelBooking(client, booking._id, {});

      expect(dto.status).toBe('cancelled');
    });
  });
});
