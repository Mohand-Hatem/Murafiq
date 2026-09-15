import 'dotenv/config';
import '../../common/globals.js';
import mongoose from 'mongoose';
import env from '../../config/env.config.js';
import { connectDB } from '../../database/connection.js';
import { closeRedisConnection } from '../../config/redis.config.js';
import { startTryOnWorker, stopTryOnWorker } from './tryon-generation.worker.js';
import { logger } from '../../config/logger.config.js';

const startWorker = async () => {
  logger.info(`Starting Virtual Try-On worker in ${env.NODE_ENV} mode...`);
  await connectDB();
  startTryOnWorker();
  logger.info('🚀 Virtual Try-On BullMQ worker is running and listening for jobs.');

  const shutdown = async (signal) => {
    logger.info(`Received ${signal}. Shutting down Try-On worker gracefully...`);
    try {
      await stopTryOnWorker();
      await closeRedisConnection();
      if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
      }
      logger.info('Try-On worker connections closed.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during Try-On worker shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

startWorker().catch((err) => {
  logger.error('Failed to start Try-On worker:', err);
  process.exit(1);
});
