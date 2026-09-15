/**
 * Phase 15D Step 5 — Fashion Knowledge Service Tests (knowledge.service.js).
 *
 * Covers:
 * 1. computeCacheKey normalization and hashing.
 * 2. Vector search retrieval on cache miss (cacheHit: false).
 * 3. 24h Redis cache hit on repeated query (cacheHit: true, zero vector calls).
 * 4. Fail-open fallback to MongoDB text search when vector search throws or returns empty.
 * 5. In-memory cache fallback when Redis is offline.
 * 6. Empty / blank query validation.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  computeCacheKey,
  searchFashionKnowledge,
  setKnowledgeRedisOverride,
  clearInMemoryCache,
  CACHE_TTL_SECONDS,
} from '../../src/modules/ai/knowledge/knowledge.service.js';
import vectorConfig from '../../src/config/vector.config.js';
import fashionKnowledgeRepo from '../../src/modules/ai/knowledge/fashion-knowledge.repository.js';

describe('Phase 15D Step 5 — knowledge.service.js', () => {
  let mockRedis;
  let vectorQuerySpy;
  let mongoSearchSpy;

  beforeEach(() => {
    clearInMemoryCache();

    mockRedis = {
      store: new Map(),
      get: jest.fn(async (key) => mockRedis.store.get(key) || null),
      set: jest.fn(async (key, val, _ex, _ttl) => {
        mockRedis.store.set(key, val);
        return 'OK';
      }),
    };

    setKnowledgeRedisOverride(mockRedis, () => true);

    vectorQuerySpy = jest.fn();
    jest.spyOn(vectorConfig, 'getKnowledgeVectorNamespace').mockReturnValue({
      query: vectorQuerySpy,
      upsert: jest.fn(),
      delete: jest.fn(),
    });

    mongoSearchSpy = jest.spyOn(fashionKnowledgeRepo, 'searchByText');
  });

  afterEach(() => {
    setKnowledgeRedisOverride(null, null);
    clearInMemoryCache();
    jest.restoreAllMocks();
  });

  describe('computeCacheKey', () => {
    it('normalizes eventType, season, and hashes queryEn', () => {
      const key1 = computeCacheKey('Wedding', 'Summer', 'formal tuxedo suit');
      const key2 = computeCacheKey('wedding', 'summer', 'formal tuxedo suit');
      const key3 = computeCacheKey('wedding', 'summer', 'different query');

      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key1).toMatch(/^ai:fashion-kb:wedding:summer:[a-f0-9]{16}$/);
    });

    it('handles null/missing eventType and season with defaults', () => {
      const key = computeCacheKey(null, null, 'linen shirt');
      expect(key).toMatch(/^ai:fashion-kb:general:all:[a-f0-9]{16}$/);
    });
  });

  describe('searchFashionKnowledge', () => {
    it('returns empty array when query is empty or whitespace', async () => {
      const res1 = await searchFashionKnowledge('');
      const res2 = await searchFashionKnowledge('   ');
      const res3 = await searchFashionKnowledge(null);

      expect(res1).toEqual([]);
      expect(res2).toEqual([]);
      expect(res3).toEqual([]);
      expect(vectorQuerySpy).not.toHaveBeenCalled();
    });

    it('queries vector store on cache miss, caches results, and returns cacheHit: false', async () => {
      const mockVectorItem = {
        id: 'kb_dress-codes_0',
        score: 0.95,
        metadata: {
          slug: 'dress-codes',
          title: 'Black Tie and Gala Attire',
          topic: 'dress_codes',
          body: 'Tuxedo and black bow tie mandatory.',
        },
      };
      vectorQuerySpy.mockResolvedValueOnce([mockVectorItem]);

      const results = await searchFashionKnowledge('black tie tuxedo gala', {
        eventType: 'wedding',
        season: 'summer',
        topK: 2,
      });

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Black Tie and Gala Attire');
      expect(results[0].cacheHit).toBe(false);

      // Verify vector query called
      expect(vectorQuerySpy).toHaveBeenCalledWith({
        data: 'black tie tuxedo gala',
        topK: 2,
      });

      // Verify cached in Redis with 24h TTL
      const expectedKey = computeCacheKey('wedding', 'summer', 'black tie tuxedo gala');
      expect(mockRedis.set).toHaveBeenCalledWith(
        expectedKey,
        expect.any(String),
        'EX',
        CACHE_TTL_SECONDS
      );
    });

    it('returns cached results on repeated query with cacheHit: true without calling vector index', async () => {
      const mockVectorItem = {
        id: 'kb_egyptian_norms_0',
        score: 0.94,
        metadata: {
          slug: 'egyptian-regional-norms',
          title: 'Cairo Luxury Hotel Weddings',
          topic: 'egyptian_norms',
          body: 'Ballroom weddings call for luxury evening gowns.',
        },
      };
      vectorQuerySpy.mockResolvedValueOnce([mockVectorItem]);

      // Call 1: Cache miss
      const firstCall = await searchFashionKnowledge('cairo luxury ballroom wedding', {
        eventType: 'wedding',
        season: 'all',
      });
      expect(firstCall[0].cacheHit).toBe(false);
      expect(vectorQuerySpy).toHaveBeenCalledTimes(1);

      // Call 2: Identical query -> Cache hit
      const secondCall = await searchFashionKnowledge('cairo luxury ballroom wedding', {
        eventType: 'wedding',
        season: 'all',
      });
      expect(secondCall[0].cacheHit).toBe(true);
      expect(secondCall[0].title).toBe('Cairo Luxury Hotel Weddings');
      // Vector index must NOT be called a second time
      expect(vectorQuerySpy).toHaveBeenCalledTimes(1);
    });

    it('falls back to MongoDB text search when vector query throws an error', async () => {
      vectorQuerySpy.mockRejectedValueOnce(new Error('Upstash rate limit or network outage'));

      const mockDbDoc = {
        vectorId: 'kb_fabrics_0',
        slug: 'fabric-seasonality',
        title: 'Egyptian Cotton and Linen',
        topic: 'fabrics',
        body: 'Breathable Giza cotton for Cairo heat.',
      };
      mongoSearchSpy.mockResolvedValueOnce([mockDbDoc]);

      const results = await searchFashionKnowledge('cotton linen heat', {
        eventType: 'casual',
        season: 'summer',
      });

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Egyptian Cotton and Linen');
      expect(results[0].fallbackSource).toBe('mongo');
      expect(results[0].cacheHit).toBe(false);

      expect(mongoSearchSpy).toHaveBeenCalledWith('cotton linen heat', {
        topic: undefined,
        limit: 3,
      });
    });

    it('uses in-memory fallback cache when Redis is disconnected', async () => {
      // Disconnect Redis
      setKnowledgeRedisOverride(null, () => false);

      const mockVectorItem = {
        id: 'kb_color_0',
        score: 0.91,
        metadata: {
          slug: 'color-theory',
          title: 'Neutral Anchors',
          topic: 'color_theory',
          body: 'Navy and charcoal pairings.',
        },
      };
      vectorQuerySpy.mockResolvedValueOnce([mockVectorItem]);

      // First run: Cache miss
      const first = await searchFashionKnowledge('navy charcoal pairing', { eventType: 'formal' });
      expect(first[0].cacheHit).toBe(false);

      // Second run: In-memory cache hit
      const second = await searchFashionKnowledge('navy charcoal pairing', { eventType: 'formal' });
      expect(second[0].cacheHit).toBe(true);
      expect(vectorQuerySpy).toHaveBeenCalledTimes(1);
    });
  });
});
