import mongoose from 'mongoose';
import '../../src/common/globals.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import eventBus from '../../src/common/events/event-bus.js';
import { EVENTS } from '../../src/common/constants/events.constant.js';
import { getBusinessDayRange } from '../../src/common/utils/businessDay.util.js';
import { sweepSessionReminders } from '../../src/jobs/session-reminder.cron.js';

// Regression test: the sweep previously queried Booking.date / Booking.time, neither of
// which exists on the schema (it stores scheduledDate + scheduledStartMinute /
// scheduledEndMinute) -- so the query never matched anything and session reminders had
// never fired, ever. This exercises the fixed query against a real MongoDB replica set,
// plus the added reminderSentAt dedup that stops the hourly sweep re-notifying the same
// booking on every subsequent run.
describe('Session reminder sweep', () => {
  let clientUser;
  let stylistUser;

  // Minutes-since-Cairo-midnight corresponding to a given number of hours from now,
  // computed the same way getAppointmentDateTime does it in production -- so the fixture
  // is correct regardless of DST or the machine's local timezone.
  const startMinuteHoursFromNow = (hours) => {
    const { startOfDay } = getBusinessDayRange(new Date());
    const target = new Date(Date.now() + hours * 60 * 60 * 1000);
    return Math.round((target.getTime() - startOfDay.getTime()) / (60 * 1000));
  };

  beforeAll(async () => {
    await connectTestDB();
  }, 300000);

  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  beforeEach(async () => {
    await clearTestDB();

    clientUser = await User.create({
      name: 'Reminder Client',
      email: 'reminder-client@test.com',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'client',
      isEmailVerified: true,
      verification: { status: 'verified' },
    });

    stylistUser = await User.create({
      name: 'Reminder Stylist',
      email: 'reminder-stylist@test.com',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'stylist',
      isEmailVerified: true,
      verification: { status: 'verified' },
    });
  });

  const makeBooking = (overrides = {}) =>
    Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: clientUser._id,
      stylistId: stylistUser._id,
      scheduledDate: new Date(),
      scheduledStartMinute: startMinuteHoursFromNow(2),
      scheduledEndMinute: startMinuteHoursFromNow(2) + 60,
      price: 500,
      duration: 60,
      status: 'confirmed',
      ...overrides,
    });

  it('dispatches a reminder for a confirmed booking starting within the next 24h', async () => {
    const booking = await makeBooking();

    let received = null;
    const handler = (payload) => {
      received = payload;
    };
    eventBus.on(EVENTS.SESSION_REMINDER, handler);

    try {
      const { remindersSent } = await sweepSessionReminders();
      expect(remindersSent).toBe(1);

      expect(received).not.toBeNull();
      expect(received.bookingId).toBe(booking._id.toString());
      expect(received.clientId).toBe(clientUser._id.toString());
      expect(received.stylistId).toBe(stylistUser._id.toString());
      expect(typeof received.time).toBe('string');

      const updated = await Booking.findById(booking._id);
      expect(updated.reminderSentAt).not.toBeNull();
    } finally {
      eventBus.off(EVENTS.SESSION_REMINDER, handler);
    }
  });

  it('does not dispatch a reminder for a booking more than 24h away', async () => {
    await makeBooking({
      scheduledStartMinute: startMinuteHoursFromNow(72),
      scheduledEndMinute: startMinuteHoursFromNow(72) + 60,
    });

    const { remindersSent } = await sweepSessionReminders();
    expect(remindersSent).toBe(0);
  });

  it('does not re-dispatch a reminder already sent (dedup via reminderSentAt)', async () => {
    await makeBooking({ reminderSentAt: new Date() });

    const { remindersSent } = await sweepSessionReminders();
    expect(remindersSent).toBe(0);
  });

  it('does not dispatch a reminder for a non-confirmed booking', async () => {
    await makeBooking({ status: 'cancelled' });

    const { remindersSent } = await sweepSessionReminders();
    expect(remindersSent).toBe(0);
  });
});
