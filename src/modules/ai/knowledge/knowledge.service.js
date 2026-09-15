import crypto from 'crypto';
import { getRedisClient, isRedisConnected } from '../../../config/redis.config.js';
import { logger } from '../../../config/logger.config.js';
import vectorConfig from '../../../config/vector.config.js';
import fashionKnowledgeRepo from './fashion-knowledge.repository.js';

export const CACHE_TTL_SECONDS = 86400; // 24 hours per spec
export const DEFAULT_TOP_K = 3;

// In-memory fallback cache store when Redis is unavailable or in offline test mode
const inMemoryCache = new Map();

// Test & DI override seam
let redisClientOverride = null;
let isRedisConnectedOverride = null;

/**
 * Injects or clears Redis client override (for unit testing without network dependencies).
 * @param {Object|null} client
 * @param {Function|null} isConnectedFn
 */
export const setKnowledgeRedisOverride = (client = null, isConnectedFn = null) => {
  redisClientOverride = client;
  isRedisConnectedOverride = isConnectedFn;
};

/**
 * Clears in-memory fallback cache (for test isolation).
 */
export const clearInMemoryCache = () => {
  inMemoryCache.clear();
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
 * Compute normalized 24-hour cache key.
 * Format: ai:fashion-kb:{eventType}:{season}:{queryHash}
 *
 * @param {string} [eventType='general']
 * @param {string} [season='all']
 * @param {string} [queryEn='']
 * @returns {string}
 */
export const computeCacheKey = (eventType = 'general', season = 'all', queryEn = '') => {
  const normEvent = String(eventType || 'general').toLowerCase().trim();
  const normSeason = String(season || 'all').toLowerCase().trim();
  const normQuery = String(queryEn || '').toLowerCase().trim();
  const queryHash = crypto.createHash('sha256').update(normQuery).digest('hex').slice(0, 16);

  return `ai:fashion-kb:${normEvent}:${normSeason}:${queryHash}`;
};

/**
 * Search the curated fashion knowledge base using RAG.
 *
 * Steps:
 * 1. Check 24-hour Redis cache (eventType + season + queryHash).
 * 2. On cache miss: query Upstash KB vector index.
 * 3. On vector failure or empty results: fail-open fallback to MongoDB text search.
 * 4. Write results back to Redis with 24h TTL.
 *
 * @param {string} queryEn - Canonical English search query
 * @param {Object} [options={}]
 * @param {string} [options.eventType='general']
 * @param {string} [options.season='all']
 * @param {string} [options.topic] - Optional topic filter
 * @param {number} [options.topK=3]
 * @returns {Promise<Array<{ id: string, slug: string, title: string, topic: string, body: string, score: number, cacheHit: boolean }>>}
 */
export const searchFashionKnowledge = async (queryEn, options = {}) => {
  const {
    eventType = 'general',
    season = 'all',
    topic,
    topK = DEFAULT_TOP_K,
  } = options;

  if (!queryEn || typeof queryEn !== 'string' || !queryEn.trim()) {
    return [];
  }

  const cacheKey = computeCacheKey(eventType, season, queryEn);

  // 1. Check 24-Hour Cache (Redis or In-Memory fallback)
  try {
    if (resolveIsConnected()) {
      const redis = resolveRedisClient();
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((chunk) => ({ ...chunk, cacheHit: true }));
        }
      }
    } else if (inMemoryCache.has(cacheKey)) {
      const entry = inMemoryCache.get(cacheKey);
      if (Date.now() < entry.expiresAt) {
        return entry.chunks.map((chunk) => ({ ...chunk, cacheHit: true }));
      }
      inMemoryCache.delete(cacheKey);
    }
  } catch (cacheErr) {
    logger.warn(`[FashionKB] Cache read failed for key ${cacheKey}:`, cacheErr.message);
  }

  // 2. Query Upstash KB Vector Store
  let retrievedChunks = [];
  try {
    const vectorNs = vectorConfig.getKnowledgeVectorNamespace(topic || 'dress_codes');
    const vectorResults = await vectorNs.query({
      data: queryEn,
      topK,
    });

    if (Array.isArray(vectorResults) && vectorResults.length > 0) {
      retrievedChunks = vectorResults
        .filter((res) => res.score == null || res.score >= 0.7)
        .map((res) => ({
          id: res.id,
          slug: res.metadata?.slug || 'fashion-knowledge',
          title: res.metadata?.title || 'Editorial Fashion Guidelines',
          topic: res.metadata?.topic || topic || 'dress_codes',
          body: res.metadata?.body || '',
          score: res.score || 0.9,
          cacheHit: false,
        }));
    }
  } catch (vectorErr) {
    logger.warn('[FashionKB] Vector search failed, falling back to MongoDB:', vectorErr.message);
  }

  // 3. Fail-Open MongoDB Fallback (if vector search yielded 0 results or threw)
  if (retrievedChunks.length === 0) {
    try {
      const dbResults = await fashionKnowledgeRepo.searchByText(queryEn, {
        topic,
        limit: topK,
      });

      if (Array.isArray(dbResults) && dbResults.length > 0) {
        retrievedChunks = dbResults.map((doc) => ({
          id: doc.vectorId || `kb_${doc.slug}_${doc.chunkIndex}`,
          slug: doc.slug,
          title: doc.title,
          topic: doc.topic,
          body: doc.body,
          score: 0.85,
          cacheHit: false,
          fallbackSource: 'mongo',
        }));
      }
    } catch (mongoErr) {
      logger.error('[FashionKB] MongoDB fallback search also failed:', mongoErr.message);
    }
  }

  // 4. Populate 24-Hour Cache on Successful Retrieval
  if (retrievedChunks.length > 0) {
    try {
      if (resolveIsConnected()) {
        const redis = resolveRedisClient();
        await redis.set(cacheKey, JSON.stringify(retrievedChunks), 'EX', CACHE_TTL_SECONDS);
      } else {
        inMemoryCache.set(cacheKey, {
          chunks: retrievedChunks,
          expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000,
        });
      }
    } catch (cacheSetErr) {
      logger.warn(`[FashionKB] Cache write failed for key ${cacheKey}:`, cacheSetErr.message);
    }
  }

  return retrievedChunks;
};

export default {
  CACHE_TTL_SECONDS,
  DEFAULT_TOP_K,
  setKnowledgeRedisOverride,
  clearInMemoryCache,
  computeCacheKey,
  searchFashionKnowledge,
};
