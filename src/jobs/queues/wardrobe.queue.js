import { Queue } from 'bullmq';
import env from '../../config/env.config.js';
import { getRedisClient } from '../../config/redis.config.js';
import { logger } from '../../config/logger.config.js';

let wardrobeQueue = null;

export const getWardrobeQueue = () => {
  if (!wardrobeQueue) {
    if (env.NODE_ENV === 'test') {
      return {
        add: async (name, data) => ({ id: 'mock-job-id', name, data }),
        close: async () => {},
      };
    }

    const redis = getRedisClient();
    wardrobeQueue = new Queue('wardrobe-classification', {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 3000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });

    wardrobeQueue.on('error', (err) => {
      logger.error('Wardrobe classification queue error:', err);
    });
  }

  return wardrobeQueue;
};

export const addWardrobeClassificationJob = async ({ itemId, userId, imageUrl }) => {
  const queue = getWardrobeQueue();
  return queue.add('classify-image', {
    itemId: itemId.toString(),
    userId: userId.toString(),
    imageUrl,
  });
};

export default {
  getWardrobeQueue,
  addWardrobeClassificationJob,
};
