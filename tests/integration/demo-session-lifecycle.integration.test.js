import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import Notification from '../../src/modules/notifications/notification.model.js';
import bookingService from '../../src/modules/bookings/booking.service.js';
import notificationListener from '../../src/modules/notifications/notification.listener.js';
import auditLogListener from '../../src/modules/audit-log/audit-log.listener.js';
import AuditLog from '../../src/modules/audit-log/audit-log.model.js';
import { getBusinessDayRange } from '../../src/common/utils/businessDay.util.js';
import { deriveCashOtp } from '../../src/common/utils/cashOtp.util.js';
import { DISPUTE_TYPES } from '../../src/common/constants/statuses.constant.js';
import { sweepStaleBookings } from '../../src/jobs/stale-booking.cron.js';

// Listeners run after emit() returns; wait for the notifications they persist.
const notificationsFor = async (userId, expected, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  let rows = [];
  while (Date.now() < deadline) {
    rows = await Notification.find({ userId }).sort({ createdAt: 1 }).lean();
    if (rows.length >= expected) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return rows;
};
const settle = () => new Promise((r) => setTimeout(r, 300));

// Demo session lifecycle against a real MongoDB (no repository mocks).
describe('Demo session lifecycle (real DB)', () => {
  let client;
  let stylist;

  beforeAll(async () => {
    await connectTestDB();
    notificationListener.register();
    auditLogListener.register();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    const user = (name, role) =>
      User.create({ name, email: `${role}@murafiq.test`, passwordHash: 'x'.repeat(20), role, isEmailVerified: true });
    client = await user('Demo Client', 'client');
    stylist = await user('Demo Stylist', 'stylist');
  });

  const asUser = (doc) => ({ _id: doc._id, id: doc._id.toString(), role: doc.role });

  // A demo booking whose check-in window is open right now: it started 10 minutes ago
  // (Cairo time) and lasts `duration` minutes.
  const createLiveDemoBooking = async (overrides = {}) => {
    const now = new Date();
    const { startOfDay } = getBusinessDayRange(now);
    const minuteOfDay = Math.floor((now.getTime() - startOfDay.getTime()) / 60000);
    const start = Math.max(0, minuteOfDay - 10);
    const duration = overrides.duration ?? 120;
    return Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: stylist._id,
      scheduledDate: now,
      scheduledStartMinute: start,
      scheduledEndMinute: start + duration,
      price: 500,
      duration,
      status: 'confirmed',
      bookingMode: 'demo',
      payoutStatus: 'not_owed',
      ...overrides,
    });
  };

  describe('Group 1: session timing in the booking response', () => {
    it('has no session start until BOTH parties check in', async () => {
      const booking = await createLiveDemoBooking();

      const afterStylist = await bookingService.checkIn(asUser(stylist), booking._id.toString());

      expect(afterStylist.status).toBe('in-progress');
      expect(afterStylist.stylistCheckInAt).toBeInstanceOf(Date);
      expect(afterStylist.clientCheckInAt).toBeNull();
      expect(afterStylist.sessionStartedAt).toBeNull();
      expect(afterStylist.sessionExpectedEndAt).toBeNull();
    });

    it('starts the session at the second check-in and ends it one duration later', async () => {
      const booking = await createLiveDemoBooking({ duration: 120 });

      await bookingService.checkIn(asUser(client), booking._id.toString());
      const afterBoth = await bookingService.checkIn(asUser(stylist), booking._id.toString());

      const saved = await Booking.findById(booking._id);
      const secondCheckIn = Math.max(saved.clientCheckInAt.getTime(), saved.stylistCheckInAt.getTime());
      expect(afterBoth.sessionStartedAt.getTime()).toBe(secondCheckIn);
      expect(afterBoth.sessionExpectedEndAt.getTime()).toBe(secondCheckIn + 120 * 60 * 1000);
    });

    it('returns the same session timing to the other party on a plain read', async () => {
      const booking = await createLiveDemoBooking({ duration: 45 });
      await bookingService.checkIn(asUser(stylist), booking._id.toString());
      await bookingService.checkIn(asUser(client), booking._id.toString());

      const read = await bookingService.getById(asUser(client), booking._id.toString());

      expect(read.sessionStartedAt).toBeInstanceOf(Date);
      expect(read.sessionExpectedEndAt.getTime() - read.sessionStartedAt.getTime()).toBe(45 * 60 * 1000);
    });
  });

  describe('Group 2: check-in and completion notifications', () => {
    it('tells the OTHER party who checked in, and that the session started on the second check-in', async () => {
      const booking = await createLiveDemoBooking();

      await bookingService.checkIn(asUser(client), booking._id.toString());
      const toStylist = await notificationsFor(stylist._id, 1);
      expect(toStylist).toHaveLength(1);
      expect(toStylist[0].title).toBe('Client Checked In');

      await bookingService.checkIn(asUser(stylist), booking._id.toString());
      const toClient = await notificationsFor(client._id, 1);
      expect(toClient).toHaveLength(1);
      expect(toClient[0].title).toBe('Session Started');

      await settle();
      // The party who checked in is never told about their own check-in.
      expect(await Notification.countDocuments({ userId: client._id, title: 'Client Checked In' })).toBe(0);
    });

    it('does not notify again when a party repeats their check-in', async () => {
      const booking = await createLiveDemoBooking();

      await bookingService.checkIn(asUser(stylist), booking._id.toString());
      await bookingService.checkIn(asUser(stylist), booking._id.toString());
      await settle();

      expect(await Notification.countDocuments({ userId: client._id })).toBe(1);
    });

    const payAndCheckInBoth = async () => {
      const booking = await createLiveDemoBooking();
      await bookingService.checkIn(asUser(client), booking._id.toString());
      await bookingService.checkIn(asUser(stylist), booking._id.toString());
      await bookingService.verifyCashOtp(asUser(client), booking._id.toString(), { otp: deriveCashOtp(booking._id) });
      await settle();
      await Notification.deleteMany({});
      return booking;
    };

    it('notifies the other party when only one side confirms, and keeps the booking in progress', async () => {
      const booking = await payAndCheckInBoth();

      const afterOne = await bookingService.confirmCompletion(asUser(stylist), booking._id.toString());

      expect(afterOne.status).toBe('in-progress');
      const toClient = await notificationsFor(client._id, 1);
      expect(toClient).toHaveLength(1);
      expect(toClient[0].title).toBe('Confirm Session Completion');
      expect(await Notification.countDocuments({ userId: stylist._id })).toBe(0);
    });

    it('does not repeat the reminder when the same side confirms twice', async () => {
      const booking = await payAndCheckInBoth();

      await bookingService.confirmCompletion(asUser(client), booking._id.toString());
      await bookingService.confirmCompletion(asUser(client), booking._id.toString());
      await settle();

      expect(await Notification.countDocuments({ userId: stylist._id, title: 'Confirm Session Completion' })).toBe(1);
    });

    it('completes early (before the countdown ends) once paid and both confirm, with no reminder', async () => {
      const booking = await payAndCheckInBoth();

      await bookingService.confirmCompletion(asUser(client), booking._id.toString());
      const done = await bookingService.confirmCompletion(asUser(stylist), booking._id.toString());

      expect(done.status).toBe('completed');
      await settle();
      expect(await Notification.countDocuments({ title: 'Confirm Session Completion', userId: client._id })).toBe(0);
    });

    it('still refuses completion before the cash payment is verified', async () => {
      const booking = await createLiveDemoBooking();
      await bookingService.checkIn(asUser(client), booking._id.toString());
      await bookingService.checkIn(asUser(stylist), booking._id.toString());

      await expect(bookingService.confirmCompletion(asUser(client), booking._id.toString())).rejects.toThrow(
        /Cash payment must be verified/
      );
    });
  });

  describe('Group 3: unresolved demo sessions go to admin review, never auto-complete', () => {
    // A session that ended 3 days ago (well past end + 24h) with both parties checked in on time.
    const createStaleBooking = async ({ bookingMode = 'demo', cash = false, clientConfirmed = false } = {}) => {
      const scheduledDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const start = bookingService.getAppointmentDateTime({ scheduledDate, scheduledStartMinute: 600 });
      const onTime = new Date(start.getTime() + 5 * 60 * 1000);
      return Booking.create({
        requestId: new mongoose.Types.ObjectId(),
        offerId: new mongoose.Types.ObjectId(),
        clientId: client._id,
        stylistId: stylist._id,
        scheduledDate,
        scheduledStartMinute: 600,
        scheduledEndMinute: 720,
        price: 500,
        duration: 120,
        status: 'in-progress',
        bookingMode,
        payoutStatus: bookingMode === 'demo' ? 'not_owed' : 'unpaid',
        checkInAt: onTime,
        clientCheckInAt: onTime,
        stylistCheckInAt: onTime,
        cashCollectedAt: cash ? new Date(onTime.getTime() + 60 * 60 * 1000) : null,
        clientConfirmedAt: clientConfirmed ? new Date(onTime.getTime() + 90 * 60 * 1000) : undefined,
      });
    };

    it('sends an UNPAID demo session attended by both to payment review', async () => {
      const booking = await createStaleBooking();

      const result = await sweepStaleBookings();

      const saved = await Booking.findById(booking._id);
      expect(result.actions).toEqual({ system_review_payment_unverified: 1 });
      expect(saved.status).toBe('disputed');
      expect(saved.disputeDetails.type).toBe(DISPUTE_TYPES.PAYMENT_UNVERIFIED);
      expect(saved.disputeDetails.raisedBy ?? null).toBeNull();
      expect(saved.completedAt ?? null).toBeNull();
      expect(saved.cashCollectedAt).toBeNull();
    });

    it('sends a PAID demo session that only one side confirmed to completion review', async () => {
      const booking = await createStaleBooking({ cash: true, clientConfirmed: true });

      const result = await sweepStaleBookings();

      const saved = await Booking.findById(booking._id);
      expect(result.actions).toEqual({ system_review_completion_unconfirmed: 1 });
      expect(saved.status).toBe('disputed');
      expect(saved.disputeDetails.type).toBe(DISPUTE_TYPES.COMPLETION_UNCONFIRMED);
    });

    it('tells BOTH parties the session is under admin review', async () => {
      await createStaleBooking();

      await sweepStaleBookings();

      const [toClient, toStylist] = await Promise.all([
        notificationsFor(client._id, 1),
        notificationsFor(stylist._id, 1),
      ]);
      expect(toClient.map((n) => n.title)).toEqual(['Session Under Review']);
      expect(toStylist.map((n) => n.title)).toEqual(['Session Under Review']);

      await settle();
      const audit = await AuditLog.findOne({ action: 'dispute.raised' }).lean();
      expect(audit.actorRole).toBe('system');
      expect(audit.actorId ?? null).toBeNull();
    });

    it('escalates exactly once across repeated and concurrent sweeps', async () => {
      const booking = await createStaleBooking();
      const doc = await Booking.findById(booking._id);

      await Promise.all([bookingService.processStaleBooking(doc), bookingService.processStaleBooking(doc)]);
      await sweepStaleBookings();
      await settle();

      expect(await Notification.countDocuments({ userId: client._id, title: 'Session Under Review' })).toBe(1);
      expect((await Booking.findById(booking._id)).status).toBe('disputed');
    });

    it('does not file a payment review if the cash was verified after the sweep read the booking', async () => {
      const booking = await createStaleBooking();
      const staleRead = await Booking.findById(booking._id);
      await Booking.updateOne({ _id: booking._id }, { $set: { cashCollectedAt: new Date() } });

      await bookingService.processStaleBooking(staleRead);

      const saved = await Booking.findById(booking._id);
      expect(saved.status).toBe('in-progress');
      // The next sweep sees the payment and files the correct review instead.
      await sweepStaleBookings();
      expect((await Booking.findById(booking._id)).disputeDetails.type).toBe(DISPUTE_TYPES.COMPLETION_UNCONFIRMED);
    });

    it('rejects a cash code entered after the review started with 409', async () => {
      const booking = await createStaleBooking();
      await sweepStaleBookings();

      await expect(
        bookingService.verifyCashOtp(asUser(client), booking._id.toString(), { otp: deriveCashOtp(booking._id) })
      ).rejects.toMatchObject({ statusCode: 409 });
      expect((await Booking.findById(booking._id)).cashCollectedAt).toBeNull();
    });

    it('never lets the stale-completion path complete a demo session directly', async () => {
      const booking = await createStaleBooking({ cash: true });

      await expect(bookingService.autoCompleteStaleBooking(booking._id)).rejects.toThrow(/admin review/);
      expect((await Booking.findById(booking._id)).status).toBe('in-progress');
    });

    it('does not let a participant file a system-only dispute type', async () => {
      const booking = await createLiveDemoBooking();
      await bookingService.checkIn(asUser(client), booking._id.toString());

      await expect(
        bookingService.fileDispute(asUser(client), booking._id.toString(), {
          reason: 'Trying to look like a system review',
          type: DISPUTE_TYPES.PAYMENT_UNVERIFIED,
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('lets the admin resolve the review as completed without marking the cash as verified', async () => {
      const booking = await createStaleBooking();
      await sweepStaleBookings();
      const admin = await User.create({
        name: 'Demo Admin', email: 'admin@murafiq.test', passwordHash: 'x'.repeat(20), role: 'admin', isEmailVerified: true,
      });

      await bookingService.resolveDispute(admin._id.toString(), booking._id.toString(), {
        outcome: 'completed',
        resolutionNotes: 'Stylist confirmed cash was received in person',
      });

      const saved = await Booking.findById(booking._id);
      expect(saved.status).toBe('completed');
      expect(saved.cashCollectedAt).toBeNull();
      expect(saved.disputeResolution.outcome).toBe('completed');
    });

    it('V1 is unchanged: a stale standard session attended by both still auto-completes', async () => {
      const booking = await createStaleBooking({ bookingMode: 'standard' });

      const result = await sweepStaleBookings();

      expect(result.actions).toEqual({ auto_completed: 1 });
      expect((await Booking.findById(booking._id)).status).toBe('completed');
    });
  });
});
