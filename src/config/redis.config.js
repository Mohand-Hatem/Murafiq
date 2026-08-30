import IORedis from 'ioredis';
import env from './env.config.js';
import { logger } from './logger.config.js';

let redisInstance = null;
let isConnected = false;

export const createRedisConnection = () => {
  if (redisInstance) {
    return redisInstance;
  }

  // maxRetriesPerRequest: null is mandatory for BullMQ
  const redis = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy(times) {
      if (env.NODE_ENV === 'test') {
        return null;
      }
      return Math.min(times * 500, 5000);
    },
  });

  redis.on('connect', () => {
    isConnected = true;
    logger.info('✅ Connected to Redis successfully');
  });

  redis.on('ready', () => {
    isConnected = true;
  });

  redis.on('error', (err) => {
    isConnected = false;
    if (env.NODE_ENV !== 'test') {
      logger.warn(`⚠️ Redis connection warning: ${err.message}`);
    }
  });

  redis.on('close', () => {
    isConnected = false;
  });

  redisInstance = redis;
  return redisInstance;
};

export const getRedisClient = () => {
  if (!redisInstance) {
    return createRedisConnection();
  }
  return redisInstance;
};

export const isRedisConnected = () => isConnected;

export const closeRedisConnection = async () => {
  if (redisInstance) {
    try {
      await redisInstance.quit();
    } catch {
      redisInstance.disconnect();
    } finally {
      redisInstance = null;
      isConnected = false;
    }
  }
};

export default getRedisClient;
