import cron from 'node-cron';
import aiConversationRepo from '../modules/ai/conversation/ai-conversation.repository.js';
import { BUSINESS_TIMEZONE } from '../common/constants/defaults.constant.js';
import env from '../config/env.config.js';
import { logger } from '../config/logger.config.js';
import cloudinary from '../config/cloudinary.config.js';

// Run daily at 03:00 AM Cairo business time
const SWEEP_SCHEDULE = '0 3 * * *';

let registered = false;

/**
 * Sweeps ephemeral AI chat images whose 24-hour TTL has expired
 * without being saved to the client's permanent wardrobe.
 * Deletes the Cloudinary asset and clears the imageRef, imageUrl, and imageExpiresAt on the message.
 *
 * @param {Date} [cutoffDate=new Date()]
 * @returns {Promise<{ scanned: number, deleted: number, errors: number }>}
 */
export const sweepExpiredChatImages = async (cutoffDate = new Date()) => {
  const expiredMessages = await aiConversationRepo.findExpiredImageMessages(cutoffDate);

  let deleted = 0;
  let errors = 0;

  for (const message of expiredMessages) {
    if (!message.imageRef) continue;

    try {
      // Destroy asset in Cloudinary
      await cloudinary.uploader.destroy(message.imageRef);

      // Clear image references on message while preserving text and garmentAnalysis
      message.imageRef = null;
      message.imageUrl = null;
      message.imageExpiresAt = null;
      await message.save();

      deleted += 1;
    } catch (err) {
      logger.error(`Failed to clean up ephemeral chat image ${message.imageRef}:`, err.message);
      errors += 1;
    }
  }

  return {
    scanned: expiredMessages.length,
    deleted,
    errors,
  };
};

/**
 * Starts the daily ephemeral chat image cleanup cron job.
 * Idempotently registers once and remains inactive in test environment.
 */
export const startAiChatCleanupCron = () => {
  if (registered) return;
  if (env.NODE_ENV === 'test') return;

  registered = true;

  cron.schedule(
    SWEEP_SCHEDULE,
    async () => {
      try {
        const result = await sweepExpiredChatImages();
        if (result.deleted > 0) {
          logger.info(`AI Chat image cleanup sweep: deleted ${result.deleted} expired ephemeral asset(s).`);
        }
      } catch (err) {
        logger.error(`AI Chat image cleanup sweep failed: ${err.message}`);
      }
    },
    { timezone: BUSINESS_TIMEZONE }
  );

  logger.info(`AI Chat image cleanup cron scheduled (${SWEEP_SCHEDULE}).`);
};

export default {
  sweepExpiredChatImages,
  startAiChatCleanupCron,
};
