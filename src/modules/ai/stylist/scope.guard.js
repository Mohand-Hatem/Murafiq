import { getRedisClient, isRedisConnected } from '../../../config/redis.config.js';
import { logger } from '../../../config/logger.config.js';
import { REFUSAL_CATEGORIES, getRefusalMessage } from '../prompts/refusal.templates.js';

export const MAX_REFUSALS_PER_HOUR = 5;
export const REFUSAL_WINDOW_SECONDS = 3600; // 1 hour window
export const MAX_MESSAGE_LENGTH = 500;

// In-memory fallback store: userId -> [timestamp, timestamp, ...]
const inMemoryRefusalStore = new Map();

// Test & DI override seam
let redisClientOverride = null;
let isRedisConnectedOverride = null;

/**
 * Injects or clears Redis client override (for unit testing without network dependencies).
 * @param {Object|null} client
 * @param {Function|null} isConnectedFn
 */
export const setRedisOverride = (client = null, isConnectedFn = null) => {
  redisClientOverride = client;
  isRedisConnectedOverride = isConnectedFn;
};

const resolveIsConnected = () => {
  if (isRedisConnectedOverride !== null) {
    return typeof isRedisConnectedOverride === 'function'
      ? isRedisConnectedOverride()
      : Boolean(isRedisConnectedOverride);
  }
  return isRedisConnected();
};

const resolveRedisClient = () => {
  if (redisClientOverride) {
    return redisClientOverride;
  }
  return getRedisClient();
};

/**
 * Resets the in-memory fallback refusal store (for testing and isolation).
 */
export const resetInMemoryRefusalStore = () => {
  inMemoryRefusalStore.clear();
};

/**
 * Layer 1 deterministic pre-check:
 * Validates prompt presence, non-empty whitespace, and message length cap (<= 500 chars).
 *
 * @param {string} message
 * @returns {{ valid: boolean, reason?: string, refusalCategory?: string }}
 */
export const validateLayer1 = (message) => {
  if (!message || typeof message !== 'string' || !message.trim()) {
    return {
      valid: false,
      reason: 'empty',
      refusalCategory: REFUSAL_CATEGORIES.INVALID_INPUT,
    };
  }

  if (message.trim().length > MAX_MESSAGE_LENGTH) {
    return {
      valid: false,
      reason: 'length_exceeded',
      refusalCategory: REFUSAL_CATEGORIES.INVALID_INPUT,
    };
  }

  return { valid: true };
};

/**
 * Generates the canonical Redis key for sliding-window scope refusals.
 * @param {string|Object} userId
 * @returns {string}
 */
export const getRefusalKey = (userId) => `ai:scope-refusal:${userId}`;

/**
 * Checks whether the user has exceeded the 5 refusals/hour limit.
 * Uses a Redis sliding-window sorted set in production, with an in-memory fallback.
 *
 * @param {string|Object} userId
 * @returns {Promise<{ allowed: boolean, count: number, refusalCategory?: string }>}
 */
export const checkRefusalRateLimit = async (userId) => {
  const now = Date.now();
  const windowStart = now - REFUSAL_WINDOW_SECONDS * 1000;
  const key = getRefusalKey(userId);

  if (resolveIsConnected()) {
    try {
      const redis = resolveRedisClient();
      // Remove stale entries older than 1 hour and count remaining
      await redis.zremrangebyscore(key, 0, windowStart);
      const count = await redis.zcard(key);

      if (count >= MAX_REFUSALS_PER_HOUR) {
        return {
          allowed: false,
          refusalCategory: REFUSAL_CATEGORIES.RATE_LIMITED,
          count,
        };
      }

      return { allowed: true, count };
    } catch (err) {
      logger.warn(`Redis checkRefusalRateLimit warning, using in-memory fallback: ${err.message}`);
    }
  }

  // In-memory fallback
  const userTimestamps = inMemoryRefusalStore.get(String(userId)) || [];
  const activeTimestamps = userTimestamps.filter((t) => t > windowStart);
  if (activeTimestamps.length > 0) {
    inMemoryRefusalStore.set(String(userId), activeTimestamps);
  } else {
    inMemoryRefusalStore.delete(String(userId));
  }

  if (activeTimestamps.length >= MAX_REFUSALS_PER_HOUR) {
    return {
      allowed: false,
      refusalCategory: REFUSAL_CATEGORIES.RATE_LIMITED,
      count: activeTimestamps.length,
    };
  }

  return { allowed: true, count: activeTimestamps.length };
};

/**
 * Records an out-of-domain scope refusal against the user's sliding-window counter.
 * Valid requests DO NOT call this function.
 *
 * @param {string|Object} userId
 * @returns {Promise<void>}
 */
export const recordScopeRefusal = async (userId) => {
  const now = Date.now();
  const windowStart = now - REFUSAL_WINDOW_SECONDS * 1000;
  const key = getRefusalKey(userId);
  const member = `${now}-${Math.random().toString(36).substring(2, 8)}`;

  if (resolveIsConnected()) {
    try {
      const redis = resolveRedisClient();
      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zadd(key, now, member);
      pipeline.expire(key, REFUSAL_WINDOW_SECONDS);
      await pipeline.exec();
      return;
    } catch (err) {
      logger.warn(`Redis recordScopeRefusal warning, using in-memory fallback: ${err.message}`);
    }
  }

  // In-memory fallback
  if (inMemoryRefusalStore.size > 5000) {
    for (const [k, ts] of inMemoryRefusalStore.entries()) {
      if (ts.every((t) => t <= windowStart)) inMemoryRefusalStore.delete(k);
    }
  }
  const userTimestamps = inMemoryRefusalStore.get(String(userId)) || [];
  const activeTimestamps = userTimestamps.filter((t) => t > windowStart);
  activeTimestamps.push(now);
  inMemoryRefusalStore.set(String(userId), activeTimestamps);
};

export default {
  MAX_REFUSALS_PER_HOUR,
  REFUSAL_WINDOW_SECONDS,
  MAX_MESSAGE_LENGTH,
  validateLayer1,
  getRefusalKey,
  checkRefusalRateLimit,
  recordScopeRefusal,
  resetInMemoryRefusalStore,
  setRedisOverride,
  getRefusalMessage,
};
