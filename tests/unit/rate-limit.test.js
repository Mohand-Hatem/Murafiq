import '../../src/common/globals.js';
import { jest, describe, it, expect, afterEach } from '@jest/globals';

/**
 * Regression tests for docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X27: every rate limiter
 * used the library's per-process default store (reset on every restart, silently
 * multiplied by instance count under horizontal scaling), the global limiter sat in
 * front of /health and both payment webhooks, and OTP-sensitive routes were keyed by IP
 * alone (which a distributed attacker trivially works around).
 */

// RedisStore's constructor eagerly runs `SCRIPT LOAD` for its two Lua scripts and expects
// a SHA1 string back, even though this test never actually exercises a rate-limit hit —
// a bare `jest.fn()` (resolving `undefined`) makes the real library throw during
// construction. Returning a fake-but-string-shaped reply keeps the test focused on this
// project's own store-selection logic instead of the library's internals.
const mockCall = jest.fn().mockResolvedValue('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
const mockGetRedisClient = jest.fn(() => ({ call: mockCall }));

// The real redis.config.js constructs a live ioredis client against whatever REDIS_URL
// is configured (a real Upstash instance in this repo's own .env) -- mocked here so this
// unit test verifies the STORE-SELECTION logic (production -> RedisStore,
// non-production -> the library default) without depending on network reachability.
jest.unstable_mockModule('../../src/config/redis.config.js', () => ({
  getRedisClient: mockGetRedisClient,
  default: mockGetRedisClient,
}));

const { shouldSkipGlobalRateLimit, EXEMPT_PATHS } = await import(
  '../../src/common/middlewares/rate-limiter.middleware.js'
);
const { accountAwareKey } = await import('../../src/common/middlewares/auth-rate-limiter.middleware.js');
const { default: createRateLimitStore } = await import('../../src/common/middlewares/rate-limit-store.js');

describe('shouldSkipGlobalRateLimit — health and webhook exemptions (X27)', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('exempts the health check', () => {
    process.env.NODE_ENV = 'production';
    expect(shouldSkipGlobalRateLimit({ path: '/api/v1/health' })).toBe(true);
  });

  it('exempts the payment webhook', () => {
    process.env.NODE_ENV = 'production';
    expect(shouldSkipGlobalRateLimit({ path: '/api/v1/payments/callback' })).toBe(true);
  });

  it('exempts the subscription webhook', () => {
    process.env.NODE_ENV = 'production';
    expect(shouldSkipGlobalRateLimit({ path: '/api/v1/subscriptions/webhook' })).toBe(true);
  });

  it('does NOT exempt an ordinary route', () => {
    process.env.NODE_ENV = 'production';
    expect(shouldSkipGlobalRateLimit({ path: '/api/v1/bookings/mine' })).toBe(false);
  });

  it('exempts every declared path, not a hardcoded duplicate list', () => {
    for (const path of EXEMPT_PATHS) {
      process.env.NODE_ENV = 'production';
      expect(shouldSkipGlobalRateLimit({ path })).toBe(true);
    }
  });
});

describe('accountAwareKey — per-account rate-limit keying (X27)', () => {
  it('combines IP and email so a distributed attacker cannot reset the budget per source IP', () => {
    const keyA = accountAwareKey({ ip: '1.2.3.4', body: { email: 'Victim@Example.com' } });
    const keyB = accountAwareKey({ ip: '5.6.7.8', body: { email: 'victim@example.com' } });
    // Different source IPs, same (case-insensitively normalised) target account — the
    // whole point is that these collide onto the same budget.
    expect(keyA).toBe(keyB);
  });

  it('still distinguishes two different accounts from the same IP', () => {
    const keyA = accountAwareKey({ ip: '1.2.3.4', body: { email: 'alice@example.com' } });
    const keyB = accountAwareKey({ ip: '1.2.3.4', body: { email: 'bob@example.com' } });
    expect(keyA).not.toBe(keyB);
  });

  it('falls back to IP alone when the request has no email', () => {
    const key = accountAwareKey({ ip: '1.2.3.4', body: {} });
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });
});

describe('createRateLimitStore — production-only Redis backing (X27)', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.clearAllMocks();
  });

  it('returns undefined (the library default in-memory store) outside production', () => {
    process.env.NODE_ENV = 'development';
    expect(createRateLimitStore()).toBeUndefined();
    expect(mockGetRedisClient).not.toHaveBeenCalled();
  });

  it('constructs a Redis-backed store in production', () => {
    process.env.NODE_ENV = 'production';
    const store = createRateLimitStore();
    expect(store).toBeDefined();
    expect(typeof store.increment).toBe('function');
    expect(mockGetRedisClient).toHaveBeenCalled();
  });

  it('falls back to undefined instead of throwing if the Redis client cannot be constructed', () => {
    process.env.NODE_ENV = 'production';
    mockGetRedisClient.mockImplementationOnce(() => {
      throw new Error('Simulated Redis client construction failure');
    });
    let result;
    expect(() => {
      result = createRateLimitStore();
    }).not.toThrow();
    expect(result).toBeUndefined();
  });
});
