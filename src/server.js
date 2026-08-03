import http from 'http';
import mongoose from 'mongoose';
import app from './app.js';
import env from './config/env.config.js';
import { connectDB } from './database/connection.js';
import { logger } from './config/logger.config.js';

const PORT = env.PORT || 4000;
const server = http.createServer(app);

const startServer = async () => {
  await connectDB();
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
