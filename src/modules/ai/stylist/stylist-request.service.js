import { getRedisClient, isRedisConnected } from '../../../config/redis.config.js';
import { logger } from '../../../config/logger.config.js';
import AiMessage from '../conversation/ai-message.model.js';
import conversationService from '../conversation/ai-conversation.service.js';
import entitlementService from '../../subscriptions/entitlement.service.js';

const CACHE_TTL_SECONDS = 86_400; // 24 hours
const inMemoryStore = new Map();

let redisClientOverride = null;
let isRedisConnectedOverride = null;

export const setStylistRequestRedisOverride = (client = null, isConnectedFn = null) => {
  redisClientOverride = client;
  isRedisConnectedOverride = isConnectedFn;
};

const checkRedisConnected = () => {
  if (isRedisConnectedOverride !== null) {
    return typeof isRedisConnectedOverride === 'function'
      ? isRedisConnectedOverride()
      : Boolean(isRedisConnectedOverride);
  }
  return isRedisConnected();
};

const resolveRedisClient = () => redisClientOverride || getRedisClient();

const getCacheKey = (requestId) => `ai:stylist:request:${requestId}`;

/**
 * Creates or initializes a tracked stylist request.
 */
export const createRequest = async ({ requestId, userId, message, conversationId, consumedQuota = null }) => {
  const record = {
    requestId,
    userId: String(userId),
    conversationId: conversationId ? String(conversationId) : null,
    message: message || '',
    status: 'processing',
    responseType: null,
    searchStatus: null,
    assistantMessage: null,
    result: null,
    consumedQuota: consumedQuota || null,
    refunded: false,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  inMemoryStore.set(requestId, record);

  if (checkRedisConnected()) {
    try {
      const redis = resolveRedisClient();
      await redis.set(getCacheKey(requestId), JSON.stringify(record), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      logger.warn(`[StylistRequest] Redis write failure, using in-memory fallback: ${err.message}`);
    }
  }

  return record;
};

/**
 * Updates an active request status and result.
 */
export const updateRequest = async (requestId, updateData = {}) => {
  let record = inMemoryStore.get(requestId) || null;

  if (checkRedisConnected()) {
    try {
      const redis = resolveRedisClient();
      const raw = await redis.get(getCacheKey(requestId));
      if (raw) {
        record = JSON.parse(raw);
      }
    } catch (err) {
      logger.warn(`[StylistRequest] Redis read failure on update: ${err.message}`);
    }
  }

  if (!record) {
    record = { requestId, createdAt: new Date().toISOString() };
  }

  // Race Guard (Case C): If request is already cancelled, prevent overwriting to completed or failed
  if (record.status === 'cancelled' && updateData.status && updateData.status !== 'cancelled') {
    return record;
  }

  Object.assign(record, updateData);
  inMemoryStore.set(requestId, record);

  if (checkRedisConnected()) {
    try {
      const redis = resolveRedisClient();
      await redis.set(getCacheKey(requestId), JSON.stringify(record), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      logger.warn(`[StylistRequest] Redis write failure on update: ${err.message}`);
    }
  }

  return record;
};

/**
 * Retrieves a mobile-safe request summary enforcing user ownership.
 */
export const getRequest = async (requestId, userId) => {
  const currentUserId = String(userId);
  let record = inMemoryStore.get(requestId) || null;

  if (checkRedisConnected()) {
    try {
      const redis = resolveRedisClient();
      const raw = await redis.get(getCacheKey(requestId));
      if (raw) {
        record = JSON.parse(raw);
      }
    } catch (err) {
      logger.warn(`[StylistRequest] Redis read failure on get: ${err.message}`);
    }
  }

  if (record) {
    if (record.userId && record.userId !== currentUserId) {
      return null; // Return null so controller returns 404
    }
    return {
      requestId: record.requestId,
      status: record.status || 'completed',
      responseType: record.responseType || 'success',
      searchStatus: record.searchStatus || 'skipped',
      assistantMessage: record.assistantMessage || null,
      result: record.result || null,
    };
  }

  // Fallback to persisted AiMessage if Redis TTL elapsed
  try {
    const message = await AiMessage.findOne({ traceId: requestId });
    if (message) {
      const conv = await conversationService.getConversation(message.conversationId, currentUserId);
      if (conv) {
        const structured = message.structuredResult || {};
        return {
          requestId,
          status: 'completed',
          responseType: structured.responseType || 'success',
          searchStatus: structured.searchStatus || 'skipped',
          assistantMessage: message.content || null,
          result: structured,
        };
      }
    }
  } catch (err) {
    logger.warn(`[StylistRequest] AiMessage fallback query failed: ${err.message}`);
  }

  return null;
};

/**
 * Cancels a stylist request idempotently with quota refund if active.
 */
export const cancelRequest = async (requestId, userId) => {
  const currentUserId = String(userId);
  let record = inMemoryStore.get(requestId) || null;

  if (checkRedisConnected()) {
    try {
      const redis = resolveRedisClient();
      const raw = await redis.get(getCacheKey(requestId));
      if (raw) {
        record = JSON.parse(raw);
      }
    } catch (err) {
      logger.warn(`[StylistRequest] Redis read failure on cancel: ${err.message}`);
    }
  }

  if (!record) {
    return null;
  }

  if (record.userId && record.userId !== currentUserId) {
    return null;
  }

  // Race Guard (Case B) & Idempotency:
  // If already completed, failed, or cancelled, return existing state without modifying status or refunding
  if (['completed', 'failed', 'cancelled'].includes(record.status)) {
    return {
      requestId: record.requestId,
      status: record.status,
      responseType: record.responseType || 'success',
      searchStatus: record.searchStatus || 'skipped',
      assistantMessage: record.assistantMessage || null,
      result: record.result || null,
    };
  }

  // Quota refund: refund exactly once using the metric that was consumed
  if (!record.refunded) {
    try {
      if (Array.isArray(record.consumedQuota) && record.consumedQuota.length > 0) {
        for (const item of record.consumedQuota) {
          if (item && item.metric) {
            await entitlementService.refundQuota(currentUserId, item.metric, Number(item.count) || 1);
          }
        }
      } else {
        // Fallback: determine metric based on active subscription entitlements
        const { entitlements: userEntitlements } = await entitlementService.getEntitlements(currentUserId, 'client');
        const metric =
          userEntitlements?.['ai.messages.daily'] !== undefined ? 'ai.messages.daily' : 'ai.messages.lifetime';
        await entitlementService.refundQuota(currentUserId, metric, 1);
      }
    } catch (refundErr) {
      logger.warn(`[StylistRequest] Quota refund on cancel failed: ${refundErr.message}`);
    }
  }

  const updated = await updateRequest(requestId, {
    status: 'cancelled',
    responseType: 'error',
    searchStatus: 'skipped',
    assistantMessage: 'Request cancelled by user',
    refunded: true,
    completedAt: new Date().toISOString(),
  });

  return {
    requestId: updated.requestId,
    status: 'cancelled',
    responseType: 'error',
    searchStatus: 'skipped',
    assistantMessage: updated.assistantMessage,
    result: null,
  };
};

/**
 * Checks whether a request has been marked as cancelled.
 * Used for cooperative pipeline cancellation.
 */
export const isCancelled = async (requestId) => {
  let record = inMemoryStore.get(requestId) || null;

  if (checkRedisConnected()) {
    try {
      const redis = resolveRedisClient();
      const raw = await redis.get(getCacheKey(requestId));
      if (raw) {
        record = JSON.parse(raw);
      }
    } catch (err) {
      logger.warn(`[StylistRequest] Redis read failure on isCancelled: ${err.message}`);
    }
  }

  return Boolean(record && record.status === 'cancelled');
};

/**
 * Retrieves the raw tracking record for internal lifecycle checks.
 */
export const getRequestRecord = async (requestId) => {
  let record = inMemoryStore.get(requestId) || null;

  if (checkRedisConnected()) {
    try {
      const redis = resolveRedisClient();
      const raw = await redis.get(getCacheKey(requestId));
      if (raw) {
        record = JSON.parse(raw);
      }
    } catch (err) {
      logger.warn(`[StylistRequest] Redis read failure on getRequestRecord: ${err.message}`);
    }
  }

  return record;
};

export default {
  createRequest,
  updateRequest,
  getRequest,
  cancelRequest,
  isCancelled,
  getRequestRecord,
  setStylistRequestRedisOverride,
};
