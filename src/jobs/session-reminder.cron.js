import cron from 'node-cron';
import Booking from '../modules/bookings/booking.model.js';
import { getAppointmentDateTime } from '../modules/bookings/booking.service.js';
import { minutesToTime } from '../common/utils/timeUtils.js';
import eventBus from '../common/events/event-bus.js';
import { EVENTS } from '../common/constants/events.constant.js';
import env from '../config/env.config.js';
import { logger } from '../config/logger.config.js';

const SESSION_REMINDER_SCHEDULE = '0 * * * *'; // Hourly

let registered = false;

/**
 * Checks for confirmed bookings starting within the next 24h and dispatches a reminder
 * for each, exactly once.
 *
 * Booking has no `date`/`time` fields (the schema stores `scheduledDate` +
 * `scheduledStartMinute`/`scheduledEndMinute`, integer minutes since midnight) -- this
 * previously queried fields that never existed, so the sweep never matched anything and
 * reminders had never fired. The query below pre-filters on the indexed `status` field
 * plus a coarse `scheduledDate` range (to avoid a full collection scan), then computes
 * the exact appointment instant per booking via getAppointmentDateTime -- the same
 * helper booking.service.js uses for cancellation-window math -- since that instant
 * depends on both scheduledDate and scheduledStartMinute together.
 *
 * `reminderSentAt` is set immediately after a reminder is dispatched, so the same
 * booking is never re-notified on a later run of this hourly sweep.
 *
 * @returns {Promise<{ remindersSent: number }>}
 */
export const sweepSessionReminders = async () => {
  const now = new Date();
  const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Coarse pre-filter: any confirmed, not-yet-reminded booking whose calendar date falls
  // within the window (+/- 1 day margin covers a start time near midnight in either
  // direction once the exact minute-of-day is added back in below).
  const coarseWindowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const coarseWindowEnd = new Date(next24h.getTime() + 24 * 60 * 60 * 1000);

  const candidateBookings = await Booking.find({
    status: 'confirmed',
    reminderSentAt: null,
    scheduledDate: { $gte: coarseWindowStart, $lte: coarseWindowEnd },
  });

  let remindersSent = 0;

  for (const booking of candidateBookings) {
    const appointmentAt = getAppointmentDateTime(booking);
    if (appointmentAt < now || appointmentAt > next24h) {
      continue;
    }

    eventBus.emit(EVENTS.SESSION_REMINDER, {
      bookingId: booking._id.toString(),
      clientId: booking.clientId.toString(),
      stylistId: booking.stylistId.toString(),
      scheduledDate: booking.scheduledDate,
      time: minutesToTime(booking.scheduledStartMinute),
    });

    await Booking.updateOne({ _id: booking._id }, { $set: { reminderSentAt: new Date() } });
    remindersSent++;
  }

  return { remindersSent };
};

export const startSessionReminderCron = () => {
  if (registered) return;
  if (env.NODE_ENV === 'test') return;

  registered = true;

  cron.schedule(SESSION_REMINDER_SCHEDULE, async () => {
    try {
      const summary = await sweepSessionReminders();
      if (summary.remindersSent > 0) {
        logger.info(`Session reminder sweep: Dispatched reminders for ${summary.remindersSent} booking(s).`);
      }
    } catch (err) {
      logger.error(`Session reminder sweep failed: ${err.message}`);
    }
  });

  logger.info(`Session reminder cron scheduled (${SESSION_REMINDER_SCHEDULE}).`);
};

export default { sweepSessionReminders, startSessionReminderCron };
