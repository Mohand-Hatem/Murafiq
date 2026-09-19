import 'dotenv/config';
import mongoose from 'mongoose';
import env from '../../config/env.config.js';
import { connectDB } from '../../database/connection.js';
import { closeRedisConnection } from '../../config/redis.config.js';
import { startWardrobeWorker, stopWardrobeWorker } from './wardrobe-classification.worker.js';
import { logger } from '../../config/logger.config.js';

const startWorker = async () => {
  logger.info(`Starting wardrobe classification worker in ${env.NODE_ENV} mode...`);
  await connectDB();
  startWardrobeWorker();
  logger.info('🚀 Wardrobe classification BullMQ worker is running and listening for jobs.');

  const shutdown = async (signal) => {
    logger.info(`Received ${signal}. Shutting down wardrobe worker gracefully...`);
    try {
      await stopWardrobeWorker();
      await closeRedisConnection();
      if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
      }
      logger.info('Wardrobe worker connections closed.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during wardrobe worker shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

startWorker().catch((err) => {
  logger.error('Failed to start wardrobe worker:', err);
  process.exit(1);
});
