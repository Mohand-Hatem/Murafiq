import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import '../../src/common/globals.js';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import StylistProfile from '../../src/modules/stylists/stylist-profile.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import Notification from '../../src/modules/notifications/notification.model.js';
import AuditLog from '../../src/modules/audit-log/audit-log.model.js';
import eventBus from '../../src/common/events/event-bus.js';
import { EVENTS } from '../../src/common/constants/events.constant.js';
import { COMPLETION_FINALIZE } from '../../src/common/constants/statuses.constant.js';
import bookingService, { finalizeCompletion } from '../../src/modules/bookings/booking.service.js';
import bookingRepository from '../../src/modules/bookings/booking.repository.js';
import chatListener from '../../src/modules/chat/chat.listener.js';
import notificationListener from '../../src/modules/notifications/notification.listener.js';
import reviewListener from '../../src/modules/reviews/review.listener.js';
import stylistListener from '../../src/modules/stylists/stylist.listener.js';
import auditLogListener from '../../src/modules/audit-log/audit-log.listener.js';
import { sweepStaleBookings, sweepStaleRefundRecovery } from '../../src/jobs/stale-booking.cron.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (check, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(25);
  }
  throw new Error('waitFor timed out');
};

// Completion side effects (SESSION_COMPLETED listeners) must be applied exactly once per
// booking, whichever path completes it and however many finalizers race. Real MongoDB
// replica set, all four real listeners registered; FCM and Firestore are absent in tests.
describe('Completion finalization: side effects exactly once (real DB)', () => {
  let client;
  let stylist;
  let admin;
  let extraListeners = [];

  const addListener = (fn) => {
    eventBus.on(EVENTS.SESSION_COMPLETED, fn);
    extraListeners.push(fn);
  };

  beforeAll(async () => {
    await connectTestDB();
    await Notification.init();
    chatListener.register();
    notificationListener.register();
    reviewListener.register();
    stylistListener.register();
    auditLogListener.register();
  }, 300000);

  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  beforeEach(async () => {
    await clearTestDB();
    const user = (name, role) =>
      User.create({ name, email: `${role}@final.test`, passwordHash: 'x'.repeat(20), role, isEmailVerified: true });
    client = await user('Final Client', 'client');
    stylist = await user('Final Stylist', 'stylist');
    admin = await user('Final Admin', 'admin');
    await StylistProfile.create({ userId: stylist._id, specialty: 'stylist', hourlyPrice: 100 });
  });

  afterEach(async () => {
    extraListeners.forEach((fn) => eventBus.off(EVENTS.SESSION_COMPLETED, fn));
    extraListeners = [];
    jest.restoreAllMocks();
    // Let any un-awaited finalizer from the test finish before the next clearTestDB.
    await sleep(150);
  });

  const asUser = (doc) => ({ _id: doc._id, id: doc._id.toString(), role: doc.role });

  const makeBooking = (overrides = {}) =>
    Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: stylist._id,
      scheduledDate: new Date(),
      scheduledStartMinute: 600,
      scheduledEndMinute: 660,
      price: 500,
      duration: 60,
      status: 'in-progress',
      bookingMode: 'demo',
      payoutStatus: 'not_owed',
      ...overrides,
    });

  // Completed a while ago (past the recovery grace) and never finalized.
  const unfinalizedCompleted = (overrides = {}) =>
    makeBooking({ status: 'completed', completedAt: new Date(Date.now() - 60 * 60 * 1000), ...overrides });

  // By title: dispute resolutions send their own notifications on the same booking.
  const completionNotifications = async (bookingId) => ({
    client: await Notification.countDocuments({
      userId: client._id,
      relatedEntityId: bookingId,
      title: 'Styling Session Completed',
    }),
    stylist: await Notification.countDocuments({
      userId: stylist._id,
      relatedEntityId: bookingId,
      title: 'Session Completed',
    }),
  });
  const clientCount = async () => (await User.findById(client._id)).completedBookings;
  const stylistCount = async () => (await StylistProfile.findOne({ userId: stylist._id })).completedSessions;
  const isFinalized = async (id) => Boolean((await Booking.findById(id)).completionFinalizedAt);

  const expectAppliedOnce = async (bookingId, { clientTotal = 1, stylistTotal = 1 } = {}) => {
    expect(await isFinalized(bookingId)).toBe(true);
    expect(await completionNotifications(bookingId)).toEqual({ client: 1, stylist: 1 });
    expect(await clientCount()).toBe(clientTotal);
    expect(await stylistCount()).toBe(stylistTotal);
  };

  describe('every completion path, then recovery', () => {
    it('mutual confirmation finalizes once and a later recovery sweep adds nothing', async () => {
      const booking = await makeBooking({ bookingMode: 'standard', payoutStatus: 'unpaid' });

      await Promise.all([
        bookingService.confirmCompletion(asUser(client), booking._id.toString()),
        bookingService.confirmCompletion(asUser(stylist), booking._id.toString()),
      ]);
      await waitFor(() => isFinalized(booking._id));
      await Booking.updateOne({ _id: booking._id }, { completedAt: new Date(Date.now() - 60 * 60 * 1000) });
      await sweepStaleRefundRecovery();
      await sleep(200);

      await expectAppliedOnce(booking._id);
    });

    it('a V1 admin "completed" resolution finalizes once', async () => {
      const booking = await makeBooking({ status: 'disputed', bookingMode: 'standard', payoutStatus: 'unpaid' });

      await bookingService.resolveDispute(admin._id.toString(), booking._id.toString(), {
        outcome: 'dismissed',
        resolutionNotes: 'Session happened as booked',
      });
      await waitFor(() => isFinalized(booking._id));
      await Booking.updateOne({ _id: booking._id }, { completedAt: new Date(Date.now() - 60 * 60 * 1000) });
      await sweepStaleRefundRecovery();
      await sleep(200);

      await expectAppliedOnce(booking._id);
    });

    it('a demo system review resolved "completed" finalizes once', async () => {
      const booking = await makeBooking({
        status: 'disputed',
        disputeDetails: { raisedBy: null, type: 'payment_unverified', reason: 'r', raisedAt: new Date() },
      });

      await bookingService.resolveDispute(admin._id.toString(), booking._id.toString(), {
        outcome: 'completed',
        resolutionNotes: 'Cash confirmed in person',
      });
      await waitFor(() => isFinalized(booking._id));
      await sweepStaleRefundRecovery();
      await sleep(200);

      await expectAppliedOnce(booking._id);
    });

    it('an admin resolution racing a recovery sweep applies the effects once', async () => {
      // Completed long ago, never finalized, then disputed: resolveDispute keeps the old
      // completedAt, so the recovery sweep is eligible to pick it up at the same moment.
      const booking = await makeBooking({ status: 'disputed', completedAt: new Date(Date.now() - 60 * 60 * 1000) });

      await Promise.all([
        bookingService.resolveDispute(admin._id.toString(), booking._id.toString(), {
          outcome: 'completed',
          resolutionNotes: 'ok',
        }),
        sweepStaleRefundRecovery(),
        sweepStaleRefundRecovery(),
      ]);
      await waitFor(() => isFinalized(booking._id));
      await sweepStaleRefundRecovery();
      await sleep(200);

      await expectAppliedOnce(booking._id);
    });

    it('a V1 stale auto-completion finalizes once, including on a repeat sweep', async () => {
      const scheduledDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const start = bookingService.getAppointmentDateTime({ scheduledDate, scheduledStartMinute: 600 });
      const onTime = new Date(start.getTime() + 5 * 60 * 1000);
      const booking = await makeBooking({
        bookingMode: 'standard',
        payoutStatus: 'unpaid',
        scheduledDate,
        scheduledEndMinute: 720,
        duration: 120,
        checkInAt: onTime,
        clientCheckInAt: onTime,
        stylistCheckInAt: onTime,
      });

      const result = await sweepStaleBookings();
      await sweepStaleRefundRecovery();

      expect(result.actions).toEqual({ auto_completed: 1 });
      await expectAppliedOnce(booking._id);
    });
  });

  describe('concurrent finalizers', () => {
    it('five finalizers on one booking run the listeners exactly once', async () => {
      const booking = await unfinalizedCompleted();
      let runs = 0;
      addListener(() => {
        runs += 1;
      });

      const results = await Promise.all(Array.from({ length: 5 }, () => finalizeCompletion(booking._id)));

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(runs).toBe(1);
      await expectAppliedOnce(booking._id);
      expect((await Booking.findById(booking._id)).completionFinalizeAttempts).toBe(1);
    });

    it('stays correct when a lease expires mid-run and a second finalizer overlaps', async () => {
      const booking = await unfinalizedCompleted();
      let release;
      const gate = new Promise((r) => {
        release = r;
      });
      let calls = 0;
      addListener(async () => {
        calls += 1;
        if (calls === 1) {
          await gate;
          throw new Error('first run failed after losing its lease');
        }
      });

      const first = finalizeCompletion(booking._id);
      await waitFor(() => calls === 1);
      // Simulate the first holder freezing past its lease.
      await Booking.updateOne({ _id: booking._id }, { completionFinalizeLeaseUntil: new Date(Date.now() - 1000) });
      const second = await finalizeCompletion(booking._id);
      release();
      const firstResult = await first;

      expect(second).toBe(true);
      expect(firstResult).toBe(false);
      await expectAppliedOnce(booking._id);
      const saved = await Booking.findById(booking._id);
      expect(saved.completionFinalizeAttempts).toBe(2);
      // The stale holder's failure is fenced out: it must not overwrite the finalized row.
      expect(saved.completionFinalizeLastError?.message).toBeUndefined();
      expect(saved.completionFinalizeLeaseUntil).toBeFalsy();
    });

    it('keeps the client count exact when two of their bookings finalize at the same moment', async () => {
      for (let round = 1; round <= 10; round += 1) {
        const [a, b] = await Promise.all([unfinalizedCompleted(), unfinalizedCompleted()]);
        await Promise.all([finalizeCompletion(a._id), finalizeCompletion(b._id)]);
        expect(await clientCount()).toBe(round * 2);
      }
    }, 60000);
  });

  describe('retries', () => {
    it('records a failed attempt with backoff, then a retry finalizes without duplicating notifications', async () => {
      const booking = await unfinalizedCompleted();
      const failing = async () => {
        throw new Error('chat store unavailable');
      };
      addListener(failing);

      const before = Date.now();
      expect(await finalizeCompletion(booking._id)).toBe(false);

      let saved = await Booking.findById(booking._id);
      expect(saved.completionFinalizedAt).toBeFalsy();
      expect(saved.completionFinalizeAttempts).toBe(1);
      expect(saved.completionFinalizeLastError.message).toMatch(/chat store unavailable/);
      expect(saved.completionFinalizeLastError.attempt).toBe(1);
      expect(saved.completionFinalizeLeaseUntil.getTime()).toBeGreaterThanOrEqual(
        before + COMPLETION_FINALIZE.BACKOFF_MS
      );
      // Still backing off: a sweep right now leaves it alone.
      await sweepStaleRefundRecovery();
      expect(await isFinalized(booking._id)).toBe(false);

      eventBus.off(EVENTS.SESSION_COMPLETED, failing);
      await Booking.updateOne({ _id: booking._id }, { completionFinalizeLeaseUntil: new Date(Date.now() - 1000) });
      await sweepStaleRefundRecovery();

      await expectAppliedOnce(booking._id);
      saved = await Booking.findById(booking._id);
      expect(saved.completionFinalizeAttempts).toBe(2);
    });

    it(`gives up after ${COMPLETION_FINALIZE.MAX_ATTEMPTS} attempts and surfaces the booking for manual handling`, async () => {
      const booking = await unfinalizedCompleted();
      addListener(async () => {
        throw new Error('always broken');
      });

      for (let i = 0; i < COMPLETION_FINALIZE.MAX_ATTEMPTS; i += 1) {
        expect(await finalizeCompletion(booking._id)).toBe(false);
        await Booking.updateOne({ _id: booking._id }, { completionFinalizeLeaseUntil: new Date(Date.now() - 1000) });
      }

      expect(await finalizeCompletion(booking._id)).toBe(false);
      const saved = await Booking.findById(booking._id);
      expect(saved.completionFinalizeAttempts).toBe(COMPLETION_FINALIZE.MAX_ATTEMPTS);
      expect(saved.completionFinalizeLastError.message).toMatch(/always broken/);

      const candidates = await bookingRepository.findPendingRefundRecoveryCandidates();
      expect(candidates.map((b) => b._id.toString())).not.toContain(booking._id.toString());
      const exhausted = await bookingRepository.findExhaustedCompletionFinalizations();
      expect(exhausted.map((b) => b._id.toString())).toContain(booking._id.toString());

      await waitFor(async () => (await AuditLog.countDocuments({ targetId: booking._id.toString() })) > 0);
      const entry = await AuditLog.findOne({ targetId: booking._id.toString() });
      expect(entry.action).toBe('booking.completion_finalize_exhausted');
      expect(entry.severity).toBe('critical');
    });

    it('treats a listener that never returns as a failed attempt instead of hanging', async () => {
      const booking = await unfinalizedCompleted();
      addListener(() => new Promise(() => {}));

      const result = await finalizeCompletion(booking._id, { timeoutMs: 100 });

      expect(result).toBe(false);
      const saved = await Booking.findById(booking._id);
      expect(saved.completionFinalizeLastError.message).toMatch(/timed out/);
      expect(saved.completionFinalizeAttempts).toBe(1);
    });

    it('recovers a completed booking stored before the attempt fields existed', async () => {
      const booking = await unfinalizedCompleted();
      await Booking.collection.updateOne(
        { _id: booking._id },
        { $unset: { completionFinalizeAttempts: '', completionFinalizeLeaseUntil: '' } }
      );

      await sweepStaleRefundRecovery();

      await expectAppliedOnce(booking._id);
    });
  });

  describe('counters and re-completion', () => {
    it('does not count a failed reliability query as zero completed sessions', async () => {
      await StylistProfile.updateOne({ userId: stylist._id }, { completedSessions: 3 });
      const booking = await unfinalizedCompleted();
      jest
        .spyOn(bookingRepository, 'findCompletedAndCancelledByStylistId')
        .mockRejectedValue(new Error('read failed'));

      expect(await finalizeCompletion(booking._id)).toBe(false);
      expect(await stylistCount()).toBe(3);
    });

    it('re-completing a finalized booking through a dispute adds no new effects', async () => {
      const booking = await unfinalizedCompleted();
      await finalizeCompletion(booking._id);
      const firstStamp = (await Booking.findById(booking._id)).completionFinalizedAt;
      await Booking.updateOne({ _id: booking._id }, { status: 'disputed' });

      await bookingService.resolveDispute(admin._id.toString(), booking._id.toString(), {
        outcome: 'completed',
        resolutionNotes: 'still completed',
      });
      await sleep(300);

      await expectAppliedOnce(booking._id);
      expect((await Booking.findById(booking._id)).completionFinalizedAt.getTime()).toBe(firstStamp.getTime());
    });

    it('recounts the client when a completed booking is disputed and then cancelled', async () => {
      const booking = await unfinalizedCompleted();
      await finalizeCompletion(booking._id);
      expect(await clientCount()).toBe(1);
      await Booking.updateOne({ _id: booking._id }, { status: 'disputed' });

      await bookingService.resolveDispute(admin._id.toString(), booking._id.toString(), {
        outcome: 'cancelled',
        resolutionNotes: 'session did not happen',
      });

      await waitFor(async () => (await clientCount()) === 0);
    });
  });

  describe('interrupted demo confirmation', () => {
    it('completes a stale demo session both parties confirmed and paid instead of sending it to review', async () => {
      const scheduledDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const start = bookingService.getAppointmentDateTime({ scheduledDate, scheduledStartMinute: 600 });
      const onTime = new Date(start.getTime() + 5 * 60 * 1000);
      // Crash between the second confirmation write and the promotion to 'completed'.
      const booking = await makeBooking({
        scheduledDate,
        scheduledEndMinute: 720,
        duration: 120,
        checkInAt: onTime,
        clientCheckInAt: onTime,
        stylistCheckInAt: onTime,
        cashCollectedAt: new Date(onTime.getTime() + 60 * 60 * 1000),
        clientConfirmedAt: new Date(onTime.getTime() + 90 * 60 * 1000),
        stylistConfirmedAt: new Date(onTime.getTime() + 91 * 60 * 1000),
      });

      const result = await sweepStaleBookings();

      expect(result.actions).toEqual({ completed_interrupted_confirmation: 1 });
      const saved = await Booking.findById(booking._id);
      expect(saved.status).toBe('completed');
      expect(saved.disputeDetails?.raisedAt).toBeUndefined();
      await expectAppliedOnce(booking._id);
    });
  });

  it('no source file emits SESSION_COMPLETED without waiting for its listeners', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js') && /\.emit\(\s*EVENTS\.SESSION_COMPLETED/.test(fs.readFileSync(full, 'utf8'))) {
          offenders.push(full);
        }
      }
    };
    walk(path.resolve('src'));
    expect(offenders).toEqual([]);
  });
});
