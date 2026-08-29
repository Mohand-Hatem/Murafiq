import cron from 'node-cron';
import Booking from '../modules/bookings/booking.model.js';
import eventBus from '../common/events/event-bus.js';
import { EVENTS } from '../common/constants/events.constant.js';
import env from '../config/env.config.js';
import { logger } from '../config/logger.config.js';

const SESSION_REMINDER_SCHEDULE = '0 * * * *'; // Hourly

let registered = false;

/**
 * Checks for confirmed bookings starting within the next 24h or 2h.
 * @returns {Promise<{ remindersSent: number }>}
 */
export const sweepSessionReminders = async () => {
  const now = new Date();
  const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const upcomingBookings = await Booking.find({
    status: 'confirmed',
    date: { $gte: now, $lte: next24h },
  });

  let remindersSent = 0;

  for (const booking of upcomingBookings) {
    eventBus.emit(EVENTS.SESSION_REMINDER || 'session.reminder', {
      bookingId: booking._id.toString(),
      clientId: booking.clientId.toString(),
      stylistId: booking.stylistId.toString(),
      date: booking.date,
      time: booking.time,
    });
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
