import cron from 'node-cron';
import User from '../modules/users/user.model.js';
import env from '../config/env.config.js';
import { logger } from '../config/logger.config.js';

const OTP_CLEANUP_SCHEDULE = '0 4 * * *'; // Daily at 4:00 AM Cairo time

let registered = false;

/**
 * Cleans up expired OTP hashes and resets attempt counters.
 * @returns {Promise<{ cleanedCount: number }>}
 */
export const sweepExpiredOtps = async () => {
  const now = new Date();
  const result = await User.updateMany(
    { otpExpiresAt: { $lt: now } },
    {
      $unset: { otpCode: '', otpExpiresAt: '' },
      $set: { otpAttempts: 0 },
    }
  );

  return { cleanedCount: result.modifiedCount || 0 };
};

export const startOtpCleanupCron = () => {
  if (registered) return;
  if (env.NODE_ENV === 'test') return;

  registered = true;

  cron.schedule(OTP_CLEANUP_SCHEDULE, async () => {
    try {
      const summary = await sweepExpiredOtps();
      if (summary.cleanedCount > 0) {
        logger.info(`OTP cleanup sweep: Cleared expired OTP for ${summary.cleanedCount} user(s).`);
      }
    } catch (err) {
      logger.error(`OTP cleanup sweep failed: ${err.message}`);
    }
  });

  logger.info(`OTP cleanup cron scheduled (${OTP_CLEANUP_SCHEDULE}).`);
};

export default { sweepExpiredOtps, startOtpCleanupCron };
