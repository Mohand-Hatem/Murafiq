import cron from 'node-cron';
import offerRepository from '../modules/offers/offer.repository.js';
import env from '../config/env.config.js';
import { logger } from '../config/logger.config.js';

// v1 interim solution: offerRepository.expireOldOffers() existed but was never invoked anywhere,
// so expired offers stayed 'pending' in every listing until someone tried to accept one. Requests
// get the same fix via lazy expiry-on-read (see request.service.js#getMine/getIncoming); offers
// get a proactive sweep instead so a stylist's own incoming-offers list doesn't need a client visit
// to self-correct.
//
// This is intentionally in-process node-cron, not a BullMQ worker — one recurring sweep does not
// justify provisioning/monitoring/backing up a Redis server for v1. Migrate to
// jobs/workers/offer-expiry.worker.js when Phase 12 (BullMQ) lands and retries/backoff/multi-worker
// actually matter.
//
// IMPORTANT: must run on exactly one process. In PM2 this means ecosystem.config.cjs pins
// `instances: 1` (fork mode) — running this in cluster mode would sweep the same rows N times per
// tick, which is harmless here (idempotent updateMany) but wastes DB round-trips at every tick.

const SWEEP_SCHEDULE = '*/5 * * * *'; // every 5 minutes

let registered = false;

export const startOfferExpiryCron = () => {
  if (registered) return;
  if (env.NODE_ENV === 'test') return; // deterministic tests drive expiry directly, not on a timer

  registered = true;

  cron.schedule(SWEEP_SCHEDULE, async () => {
    try {
      const result = await offerRepository.expireOldOffers();
      if (result?.modifiedCount) {
        logger.info(`Offer-expiry sweep: flipped ${result.modifiedCount} offer(s) to 'expired'.`);
      }
    } catch (err) {
      logger.error(`Offer-expiry sweep failed: ${err.message}`);
    }
  });

  logger.info(`Offer-expiry cron scheduled (${SWEEP_SCHEDULE}).`);
};

export default { startOfferExpiryCron };
