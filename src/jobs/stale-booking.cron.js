import cron from 'node-cron';
import bookingRepository from '../modules/bookings/booking.repository.js';
import bookingService from '../modules/bookings/booking.service.js';
import { BUSINESS_TIMEZONE } from '../common/constants/defaults.constant.js';
import env from '../config/env.config.js';
import logger from '../config/logger.config.js';

const SWEEP_SCHEDULE = '*/15 * * * *'; // Every 15 minutes

let registered = false;
let isSweeping = false;

/**
 * Sweep for stale bookings past their scheduled session end by at least 24 hours.
 * Uses coarse scheduledDate pre-filter in MongoDB, then strictly enforces
 * `now >= getAppointmentEndDateTime(booking) + 24h` before classifying attendance.
 *
 * @param {Date} [now=new Date()]
 * @param {number} [batchSize=50]
 * @returns {Promise<{ scanned: number, resolved: number, actions: Object }>}
 */
export const sweepStaleBookings = async (now = new Date(), batchSize = 50) => {
  // Coarse pre-filter: scheduledDate is stored around midnight Cairo/UTC.
  // Any session ended 24h ago must have scheduledDate <= (now - 20h).
  const coarseDateEnd = new Date(now.getTime() - 20 * 60 * 60 * 1000);
  const candidates = await bookingRepository.findStaleBookingCandidates(coarseDateEnd, batchSize);

  let resolved = 0;
  const actions = {};

  for (const booking of candidates) {
    try {
      const res = await bookingService.processStaleBooking(booking, now);
      if (res && res.action && !res.action.startsWith('skipped')) {
        resolved += 1;
        actions[res.action] = (actions[res.action] || 0) + 1;
      }
    } catch (err) {
      logger.error(`[Stale Sweep] Failed processing booking ${booking._id}: ${err.message}`);
    }
  }

  return { scanned: candidates.length, resolved, actions };
};

/**
 * Second-pass recovery sweep: resumes unfinalized refunds for system-cancelled
 * or system-detected no-show bookings where the external refund failed or pending.
 *
 * @param {number} [batchSize=50]
 * @returns {Promise<{ scanned: number, recovered: number }>}
 */
export const sweepStaleRefundRecovery = async (batchSize = 50) => {
  const candidates = await bookingRepository.findPendingRefundRecoveryCandidates(batchSize);

  let recovered = 0;

  for (const booking of candidates) {
    try {
      const res = await bookingService.recoverStaleRefund(booking);
      if (res && res.status === 'refund_recovered') {
        recovered += 1;
      }
    } catch (err) {
      logger.error(`[Refund Recovery Sweep] Failed recovery for booking ${booking._id}: ${err.message}`);
    }
  }

  return { scanned: candidates.length, recovered };
};

/**
 * Starts the stale booking resolution and refund recovery cron.
 * In-process node-cron, scheduled every 15 minutes in BUSINESS_TIMEZONE ('Africa/Cairo').
 * Bypassed in test environment so tests can invoke sweeps directly.
 */
export const startStaleBookingCron = () => {
  if (registered) return;
  if (env.NODE_ENV === 'test') return;

  registered = true;

  cron.schedule(
    SWEEP_SCHEDULE,
    async () => {
      if (isSweeping) {
        logger.warn('[Stale Cron] Previous sweep tick still running; skipping tick.');
        return;
      }

      isSweeping = true;
      try {
        // Pass 1: Stale booking sweep
        const staleRes = await sweepStaleBookings();
        if (staleRes.resolved > 0) {
          logger.info(
            `[Stale Cron] Resolved ${staleRes.resolved} of ${staleRes.scanned} candidate booking(s): ${JSON.stringify(staleRes.actions)}`
          );
        }

        // Pass 2: Refund recovery sweep
        const recoveryRes = await sweepStaleRefundRecovery();
        if (recoveryRes.recovered > 0) {
          logger.info(
            `[Stale Cron] Recovered ${recoveryRes.recovered} of ${recoveryRes.scanned} pending refund(s).`
          );
        }
      } catch (err) {
        logger.error(`[Stale Cron] Sweep cycle encountered error: ${err.message}`);
      } finally {
        isSweeping = false;
      }
    },
    { timezone: BUSINESS_TIMEZONE }
  );

  logger.info(`Stale booking sweep cron scheduled (${SWEEP_SCHEDULE}).`);
};

export default {
  startStaleBookingCron,
  sweepStaleBookings,
  sweepStaleRefundRecovery,
};
