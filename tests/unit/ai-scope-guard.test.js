import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import {
  validateLayer1,
  checkRefusalRateLimit,
  recordScopeRefusal,
  resetInMemoryRefusalStore,
  setRedisOverride,
  MAX_REFUSALS_PER_HOUR,
  MAX_MESSAGE_LENGTH,
} from '../../src/modules/ai/stylist/scope.guard.js';
import {
  REFUSAL_CATEGORIES,
  getRefusalMessage,
} from '../../src/modules/ai/prompts/refusal.templates.js';

describe('Unit — AI Scope Guard & Localized Refusal Templates (scope.guard.js)', () => {
  beforeEach(() => {
    resetInMemoryRefusalStore();
    setRedisOverride(null, null);
    jest.clearAllMocks();
  });

  describe('1. Layer 1 Validation (validateLayer1)', () => {
    it('rejects null, undefined, empty, and whitespace-only messages', () => {
      expect(validateLayer1(null)).toEqual({
        valid: false,
        reason: 'empty',
        refusalCategory: REFUSAL_CATEGORIES.INVALID_INPUT,
      });

      expect(validateLayer1('')).toEqual({
        valid: false,
        reason: 'empty',
        refusalCategory: REFUSAL_CATEGORIES.INVALID_INPUT,
      });

      expect(validateLayer1('   \n\t  ')).toEqual({
        valid: false,
        reason: 'empty',
        refusalCategory: REFUSAL_CATEGORIES.INVALID_INPUT,
      });
    });

    it('rejects messages exceeding 500 characters', () => {
      const longMessage = 'a'.repeat(MAX_MESSAGE_LENGTH + 1);
      expect(validateLayer1(longMessage)).toEqual({
        valid: false,
        reason: 'length_exceeded',
        refusalCategory: REFUSAL_CATEGORIES.INVALID_INPUT,
      });
    });

    it('accepts valid messages within 500 characters', () => {
      expect(validateLayer1('I have a wedding tomorrow evening, what should I wear?')).toEqual({
        valid: true,
      });

      const maxValid = 'a'.repeat(MAX_MESSAGE_LENGTH);
      expect(validateLayer1(maxValid)).toEqual({
        valid: true,
      });
    });
  });

  describe('2. Localized Refusal Templates (refusal.templates.js)', () => {
    it('returns localized English and Arabic messages for all refusal categories', () => {
      const categories = [
        REFUSAL_CATEGORIES.GENERAL_KNOWLEDGE,
        REFUSAL_CATEGORIES.OTHER_DOMAIN,
        REFUSAL_CATEGORIES.UNSAFE,
        REFUSAL_CATEGORIES.RATE_LIMITED,
        REFUSAL_CATEGORIES.INVALID_INPUT,
      ];

      for (const cat of categories) {
        const en = getRefusalMessage(cat, 'en');
        const ar = getRefusalMessage(cat, 'ar');
        expect(en).toBeDefined();
        expect(typeof en).toBe('string');
        expect(en.length).toBeGreaterThan(10);

        expect(ar).toBeDefined();
        expect(typeof ar).toBe('string');
        expect(ar.length).toBeGreaterThan(10);
      }
    });

    it('falls back to other_domain and en for unknown inputs', () => {
      const fallback = getRefusalMessage('non_existent_category', 'fr');
      expect(fallback).toContain("I'm your Murafiq AI Stylist");
    });
  });

  describe('3. Sliding-Window Refusal Abuse Limiter (In-Memory Fallback)', () => {
    const userId = 'user_test_123';

    it('allows initial requests with 0 refusals', async () => {
      const status = await checkRefusalRateLimit(userId);
      expect(status).toEqual({ allowed: true, count: 0 });
    });

    it('allows up to 5 refusals and blocks on the 6th', async () => {
      for (let i = 1; i <= MAX_REFUSALS_PER_HOUR; i++) {
        await recordScopeRefusal(userId);
        const status = await checkRefusalRateLimit(userId);
        if (i < MAX_REFUSALS_PER_HOUR) {
          expect(status.allowed).toBe(true);
        } else {
          // Exactly 5 refusals reached: next check blocks further model calls
          expect(status.allowed).toBe(false);
          expect(status.refusalCategory).toBe(REFUSAL_CATEGORIES.RATE_LIMITED);
          expect(status.count).toBe(5);
        }
      }
    });

    it('isolates refusal counters between different users', async () => {
      const userA = 'user_A';
      const userB = 'user_B';

      for (let i = 0; i < 5; i++) {
        await recordScopeRefusal(userA);
      }

      const statusA = await checkRefusalRateLimit(userA);
      const statusB = await checkRefusalRateLimit(userB);

      expect(statusA.allowed).toBe(false);
      expect(statusB.allowed).toBe(true);
      expect(statusB.count).toBe(0);
    });

    it('prunes entries older than 1 hour in sliding window', async () => {
      const originalNow = Date.now;
      let currentTime = 1_000_000_000_000;
      Date.now = () => currentTime;

      try {
        // Record 5 refusals at currentTime
        for (let i = 0; i < 5; i++) {
          await recordScopeRefusal(userId);
        }

        let status = await checkRefusalRateLimit(userId);
        expect(status.allowed).toBe(false);

        // Advance time by 61 minutes (3660 seconds)
        currentTime += 3660 * 1000;

        status = await checkRefusalRateLimit(userId);
        expect(status.allowed).toBe(true);
        expect(status.count).toBe(0);
      } finally {
        Date.now = originalNow;
      }
    });
  });

  describe('4. Redis Sliding-Window Integration & Error Fallback', () => {
    const userId = 'redis_user_456';

    it('uses Redis sorted set when Redis is connected', async () => {
      const mockZcard = jest.fn().mockResolvedValue(2);
      const mockZremrangebyscore = jest.fn().mockResolvedValue(0);
      const mockPipeline = {
        zremrangebyscore: jest.fn().mockReturnThis(),
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };

      setRedisOverride(
        {
          zremrangebyscore: mockZremrangebyscore,
          zcard: mockZcard,
          pipeline: () => mockPipeline,
        },
        () => true
      );

      const checkResult = await checkRefusalRateLimit(userId);
      expect(checkResult).toEqual({ allowed: true, count: 2 });
      expect(mockZremrangebyscore).toHaveBeenCalled();
      expect(mockZcard).toHaveBeenCalled();

      await recordScopeRefusal(userId);
      expect(mockPipeline.zremrangebyscore).toHaveBeenCalled();
      expect(mockPipeline.zadd).toHaveBeenCalled();
      expect(mockPipeline.expire).toHaveBeenCalled();
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it('falls back to in-memory gracefully if Redis throws an error', async () => {
      setRedisOverride(
        {
          zremrangebyscore: jest.fn().mockRejectedValue(new Error('Redis connection drop')),
        },
        () => true
      );

      // Should not throw, should fall back to in-memory
      const checkResult = await checkRefusalRateLimit(userId);
      expect(checkResult.allowed).toBe(true);
      expect(checkResult.count).toBe(0);
    });
  });
});
