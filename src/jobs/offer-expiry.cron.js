import cron from 'node-cron';
import offerRepository from '../modules/offers/offer.repository.js';
import env from '../config/env.config.js';
import { logger } from '../config/logger.config.js';

const SWEEP_SCHEDULE = '*/5 * * * *'; // every 5 minutes

let registered = false;

/**
 * Sweeps expired offers (24h standard window and 30-day long-stop window).
 * @returns {Promise<{ modifiedCount: number }>}
 */
export const sweepExpiredOffers = async () => {
  return await offerRepository.expireOldOffers();
};

export const startOfferExpiryCron = () => {
  if (registered) return;
  if (env.NODE_ENV === 'test') return; // deterministic tests drive expiry directly, not on a timer

  registered = true;

  cron.schedule(SWEEP_SCHEDULE, async () => {
    try {
      const result = await sweepExpiredOffers();
      if (result?.modifiedCount) {
        logger.info(`Offer-expiry sweep: flipped ${result.modifiedCount} offer(s) to 'expired'.`);
      }
    } catch (err) {
      logger.error(`Offer-expiry sweep failed: ${err.message}`);
    }
  });

  logger.info(`Offer-expiry cron scheduled (${SWEEP_SCHEDULE}).`);
};

export default { sweepExpiredOffers, startOfferExpiryCron };
