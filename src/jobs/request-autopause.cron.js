import cron from 'node-cron';
import Request from '../modules/requests/request.model.js';
import env from '../config/env.config.js';
import { logger } from '../config/logger.config.js';

const AUTOPAUSE_SCHEDULE = '*/5 * * * *'; // Every 5 minutes

let registered = false;

/**
 * Sweeps open requests with zero offers whose 48h timer has expired.
 * Flips to PAUSED (or CLOSED if pauseCount >= 3).
 * @returns {Promise<{ pausedCount: number, closedCount: number }>}
 */
export const sweepAutoPauseRequests = async () => {
  const now = new Date();
  const pausableRequests = await Request.find({
    status: { $in: ['pending', 'OPEN'] },
    offerCount: { $lte: 0 },
    autoPauseAt: { $lte: now, $ne: null },
  });

  let pausedCount = 0;
  let closedCount = 0;

  for (const req of pausableRequests) {
    if (req.pauseCount >= 3) {
      req.status = 'CLOSED';
      req.autoPauseAt = null;
      await req.save();
      closedCount++;
    } else {
      req.status = 'PAUSED';
      req.pauseCount = (req.pauseCount || 0) + 1;
      req.pausedAt = now;
      req.autoPauseAt = null;
      await req.save();
      pausedCount++;
    }
  }

  return { pausedCount, closedCount };
};

export const startRequestAutoPauseCron = () => {
  if (registered) return;
  if (env.NODE_ENV === 'test') return;

  registered = true;

  cron.schedule(AUTOPAUSE_SCHEDULE, async () => {
    try {
      const summary = await sweepAutoPauseRequests();
      if (summary.pausedCount > 0 || summary.closedCount > 0) {
        logger.info(
          `Request auto-pause sweep: Paused ${summary.pausedCount} request(s), Closed ${summary.closedCount} request(s).`
        );
      }
    } catch (err) {
      logger.error(`Request auto-pause sweep failed: ${err.message}`);
    }
  });

  logger.info(`Request auto-pause cron scheduled (${AUTOPAUSE_SCHEDULE}).`);
};

export default { sweepAutoPauseRequests, startRequestAutoPauseCron };
