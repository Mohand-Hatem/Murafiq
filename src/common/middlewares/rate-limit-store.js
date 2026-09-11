import { RedisStore } from 'rate-limit-redis';
import { getRedisClient } from '../../config/redis.config.js';
import { logger } from '../../config/logger.config.js';

/**
 * Shared Redis-backed store for every `express-rate-limit` instance in the app.
 *
 * All four limiters previously used the library's default in-memory store: a Map local
 * to one Node process. Two consequences (docs/AUDIT_2026_09_FULL_SYSTEM.md finding X27):
 * every counter resets on a deploy/restart, and horizontal scaling silently multiplies
 * every configured limit by the instance count (5 processes behind a load balancer turns
 * "5 login attempts per 5 minutes" into 25). `ioredis` was already a dependency, wired for
 * BullMQ, and unused for this.
 *
 * Scoped to production only, deliberately: development and test never need a running
 * Redis just to exercise a rate limiter (and `NODE_ENV=test` already sets `skip: true` on
 * every limiter, so the store is never even called there), and a per-process limiter in
 * development is the simpler, lower-friction default. A production deploy is exactly the
 * case with more than one instance, which is what makes a shared store matter.
 */
export const createRateLimitStore = () => {
  // process.env.NODE_ENV, not the parsed env config, matching every other rate limiter's
  // own test-skip check in this project (`skip: () => process.env.NODE_ENV === 'test'`).
  if (process.env.NODE_ENV !== 'production') {
    return undefined; // express-rate-limit's own default MemoryStore
  }

  try {
    const client = getRedisClient();
    return new RedisStore({
      // ioredis exposes `call` for arbitrary commands — the shape rate-limit-redis expects.
      sendCommand: (...args) => client.call(...args),
    });
  } catch (err) {
    // Rate limiting is a defence-in-depth control, not a correctness-critical one. A
    // Redis-client construction failure should degrade to per-process limiting rather
    // than take down every rate-limited route in production.
    logger.error(`Failed to construct Redis-backed rate limit store, falling back to in-memory: ${err.message}`);
    return undefined;
  }
};

export default createRateLimitStore;
