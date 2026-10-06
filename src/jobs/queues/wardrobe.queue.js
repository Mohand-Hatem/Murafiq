import { Queue } from 'bullmq';
import env from '../../config/env.config.js';
import { getRedisClient } from '../../config/redis.config.js';
import { logger } from '../../config/logger.config.js';
import { getRequestId } from '../../common/utils/request-context.js';

let wardrobeQueue = null;

export const getWardrobeQueue = () => {
  if (!wardrobeQueue) {
    if (env.NODE_ENV === 'test') {
      return {
        add: async (name, data, opts) => ({ id: 'mock-job-id', name, data, opts }),
        close: async () => {},
        getJobCounts: async () => ({ waiting: 0, active: 0, failed: 0, delayed: 0 }),
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

export const addWardrobeClassificationJob = async ({ itemId, userId, imageUrl }, opts = {}) => {
  const queue = getWardrobeQueue();
  const requestId = getRequestId();
  const jobOpts = {
    ...opts,
    ...(requestId ? { custom: { requestId, ...(opts.custom || {}) } } : {}),
  };
  const data = {
    itemId: itemId.toString(),
    userId: userId.toString(),
    imageUrl,
  };

  if (Object.keys(jobOpts).length > 0) {
    return queue.add('classify-image', data, jobOpts);
  }
  return queue.add('classify-image', data);
};

export default {
  getWardrobeQueue,
  addWardrobeClassificationJob,
};
