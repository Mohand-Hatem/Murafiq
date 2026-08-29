import cron from 'node-cron';
import noShowService from '../modules/bookings/no-show.service.js';
import couponRepository from '../modules/coupons/coupon.repository.js';
import env from '../config/env.config.js';
import { logger } from '../config/logger.config.js';

// A no-show report the accused never answers must still settle — otherwise ignoring
// the notification is a free way to stall the reporter's refund indefinitely. This
// sweep closes that window in the reporter's favour once it has elapsed.
//
// In-process node-cron, matching offer-expiry.cron.js. Relies on the PM2
// `instances: 1` pin in ecosystem.config.cjs; under cluster mode every instance would
// sweep the same rows. That is harmless here — resolveNoShow is idempotent and returns
// early on an already-terminal booking — but it wastes DB round-trips every tick.

const SWEEP_SCHEDULE = '*/15 * * * *'; // every 15 minutes

let registered = false;

export const startNoShowResolutionCron = () => {
  if (registered) return;
  if (env.NODE_ENV === 'test') return; // tests drive resolution directly, not on a timer

  registered = true;

  cron.schedule(SWEEP_SCHEDULE, async () => {
    try {
      const { resolved, scanned } = await noShowService.autoResolveExpiredNoShows();
      if (resolved > 0) {
        logger.info(`No-show sweep: auto-resolved ${resolved} of ${scanned} unanswered report(s).`);
      }
    } catch (err) {
      logger.error(`No-show auto-resolution sweep failed: ${err.message}`);
    }

    // Coupon expiry rides along on the same tick rather than getting its own schedule.
    // Expiry is enforced lazily at redemption anyway; this only keeps listings honest.
    try {
      const res = await couponRepository.expireOverdue();
      if (res?.modifiedCount) {
        logger.info(`Coupon sweep: marked ${res.modifiedCount} coupon(s) EXPIRED.`);
      }
    } catch (err) {
      logger.error(`Coupon expiry sweep failed: ${err.message}`);
    }
  });

  logger.info(`No-show resolution cron scheduled (${SWEEP_SCHEDULE}).`);
};

export default { startNoShowResolutionCron };
