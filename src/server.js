import http from 'http';
import mongoose from 'mongoose';
import app from './app.js';
import env from './config/env.config.js';
import { connectDB } from './database/connection.js';
import { logger } from './config/logger.config.js';
import { startOfferExpiryCron } from './jobs/offer-expiry.cron.js';
import { startLedgerReconciliationCron } from './jobs/ledger-reconciliation.cron.js';
import { startSubscriptionRenewalCron } from './jobs/subscription-renewal.cron.js';
import { startRequestAutoPauseCron } from './jobs/request-autopause.cron.js';
import { startOtpCleanupCron } from './jobs/otp-cleanup.cron.js';
import { startSessionReminderCron } from './jobs/session-reminder.cron.js';
import { startNoShowResolutionCron } from './jobs/no-show-resolution.cron.js';
import { startWardrobeWorker, stopWardrobeWorker } from './jobs/workers/wardrobe-classification.worker.js';
import { closeRedisConnection } from './config/redis.config.js';

const PORT = env.PORT || 4000;
const server = http.createServer(app);

const startServer = async () => {
  await connectDB();
  startOfferExpiryCron();
  startLedgerReconciliationCron();
  startSubscriptionRenewalCron();
  startRequestAutoPauseCron();
  startNoShowResolutionCron();
  startOtpCleanupCron();
  startSessionReminderCron();
  startWardrobeWorker();
  server.listen(PORT, () => {
    logger.info(`🚀 Server running in ${env.NODE_ENV} mode on port ${PORT}`);
  });
};

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

// Graceful shutdown
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    logger.info('HTTP server closed.');
    try {
      await stopWardrobeWorker();
      await closeRedisConnection();
      if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
        logger.info('MongoDB connection closed.');
      }
      process.exit(0);
    } catch (err) {
      logger.error('Error during graceful shutdown:', err);
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { server, startServer };
