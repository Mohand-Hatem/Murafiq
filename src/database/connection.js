import mongoose from 'mongoose';
import dbConfig from '../config/database.config.js';
import { logger } from '../config/logger.config.js';

export const connectDB = async () => {
  try {
    const conn = await mongoose.connect(dbConfig.uri, dbConfig.options);
    logger.info(`✅ MongoDB Connected: Murafiq is Online Now`);
    return conn;
  } catch (error) {
    logger.error(`❌ MongoDB Connection Error: ${error.message}`);
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
  }
};
