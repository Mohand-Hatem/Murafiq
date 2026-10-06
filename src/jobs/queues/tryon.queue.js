import { Queue } from 'bullmq';
import env from '../../config/env.config.js';
import { getRedisClient } from '../../config/redis.config.js';
import { logger } from '../../config/logger.config.js';
import { getRequestId } from '../../common/utils/request-context.js';

let tryOnQueue = null;

/**
 * Gets or initializes the BullMQ Try-On generation queue.
 *
 * Configured with:
 * - max attempts: 2 (to strictly cap GPU costs)
 * - exponential backoff delay: 5000ms
 *
 * @returns {Queue}
 */
export const getTryOnQueue = () => {
  if (!tryOnQueue) {
    if (env.NODE_ENV === 'test') {
      tryOnQueue = {
        add: async (name, data, opts) => ({ id: 'mock-tryon-job-id', name, data, opts }),
        close: async () => {},
        getJobCounts: async () => ({ waiting: 0, active: 0, failed: 0, delayed: 0 }),
      };
      return tryOnQueue;
    }

    const redis = getRedisClient();
    tryOnQueue = new Queue('tryon-generation', {
      connection: redis,
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });

    tryOnQueue.on('error', (err) => {
      logger.error('Try-On queue error:', err);
    });
  }

  return tryOnQueue;
};

/**
 * Adds a new Try-On generation job to the queue.
 *
 * @param {Object} params
 * @param {string|import('mongoose').Types.ObjectId} params.generationId
 * @param {string} params.jobId
 * @param {string|import('mongoose').Types.ObjectId} params.userId
 * @param {Object} [opts={}]
 * @returns {Promise<import('bullmq').Job>}
 */
export const addTryOnJob = async ({ generationId, jobId, userId }, opts = {}) => {
  const queue = getTryOnQueue();
  const requestId = getRequestId();
  const jobOpts = {
    ...opts,
    ...(requestId ? { custom: { requestId, ...(opts.custom || {}) } } : {}),
  };
  const data = {
    generationId: generationId.toString(),
    jobId,
    userId: userId.toString(),
  };

  if (Object.keys(jobOpts).length > 0) {
    return queue.add('generate-tryon', data, jobOpts);
  }
  return queue.add('generate-tryon', data);
};

export default {
  getTryOnQueue,
  addTryOnJob,
};
