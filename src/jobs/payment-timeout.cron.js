import cron from 'node-cron';
import bookingRepository from '../modules/bookings/booking.repository.js';
import bookingService from '../modules/bookings/booking.service.js';
import paymentRepository from '../modules/payments/payment.repository.js';
import paymentService from '../modules/payments/payment.service.js';
import { BUSINESS_TIMEZONE } from '../common/constants/defaults.constant.js';
import { BOOKING_PAYMENT_POLICY, BOOKING_STATUS } from '../common/constants/statuses.constant.js';
import env from '../config/env.config.js';
import { logger } from '../config/logger.config.js';

let registered = false;

/**
 * Releases bookings still `pending_payment` past their deadline. Before giving up on one it asks
 * Paymob once, so a payment whose webhook was lost confirms the booking instead of destroying it.
 * @returns {Promise<{ scanned: number, released: number }>}
 */
export const sweepUnpaidBookings = async (now = new Date()) => {
  const expired = await bookingRepository.findExpiredPendingPayment(
    now,
    BOOKING_PAYMENT_POLICY.BATCH_SIZE
  );
  let released = 0;

  for (const booking of expired) {
    try {
      const payment = await paymentRepository.findByBookingId(booking._id);
      if (payment?.status === 'pending' && payment.providerIntentionId) {
        await paymentService.reconcilePayment(payment);
        const fresh = await bookingRepository.findById(booking._id);
        if (fresh?.status !== BOOKING_STATUS.PENDING_PAYMENT) continue; // it was paid
      }

      const res = await bookingService.releaseUnpaidBooking(booking._id, {
        cancelledBy: 'system',
        reason: 'payment_timeout',
      });
      if (res) released += 1;
    } catch (err) {
      logger.error(`Releasing unpaid booking ${booking._id} failed: ${err.message}`);
    }
  }

  return { scanned: expired.length, released };
};

export const startPaymentTimeoutCron = () => {
  if (registered) return;
  if (env.NODE_ENV === 'test') return;
  registered = true;

  cron.schedule(
    BOOKING_PAYMENT_POLICY.SWEEP_SCHEDULE,
    async () => {
      try {
        const { released } = await sweepUnpaidBookings();
        if (released > 0) logger.info(`Payment-timeout sweep released ${released} unpaid booking(s).`);
      } catch (err) {
        logger.error(`Payment-timeout sweep failed: ${err.message}`);
      }
    },
    { timezone: BUSINESS_TIMEZONE }
  );

  logger.info(`Payment-timeout cron scheduled (${BOOKING_PAYMENT_POLICY.SWEEP_SCHEDULE}).`);
};

export default { sweepUnpaidBookings, startPaymentTimeoutCron };
