import mongoose from 'mongoose';
import User from '../../modules/users/user.model.js';

/**
 * Access-token revocation without a database read on every request.
 *
 * A 15-minute access JWT cannot be un-issued, so suspending, restricting, or banning a
 * user previously left them with a fully working token until it expired — which defeats
 * the whole point of the moderation enforcement chain (§I.4). `User.tokenVersion` is
 * stamped into the token at issuance and bumped whenever sessions must die; a mismatch
 * means the token predates the revocation and is rejected.
 *
 * Checking that naively would add a DB round trip to every authenticated request. This
 * cache keeps it to at most one read per user per TTL window.
 *
 * The TTL is the deliberate trade-off: a revoked user may keep working for up to TTL
 * seconds. 30s is short enough that "kick them out" feels immediate and far shorter than
 * the 15-minute token lifetime it replaces. Set it to 0 to disable caching entirely if a
 * deployment ever needs strictly immediate revocation at the cost of a read per request.
 */
const TTL_MS = 30 * 1000;
const MAX_ENTRIES = 10000;

const cache = new Map(); // userId -> { version, expiresAt }

const prune = () => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  // Bound memory even if every entry is still live — evict oldest-inserted first,
  // which Map iteration order gives us for free.
  if (cache.size > MAX_ENTRIES) {
    const excess = cache.size - MAX_ENTRIES;
    let i = 0;
    for (const key of cache.keys()) {
      if (i >= excess) break;
      cache.delete(key);
      i += 1;
    }
  }
};

/**
 * Returns the user's current session state ({ version, accountStatus }),
 * `{ version: null, accountStatus: null }` if the user no longer exists, or
 * `undefined` to mean "cannot determine — skip the check".
 */
export const getCurrentSessionState = async (userId) => {
  if (mongoose.connection?.readyState !== 1) {
    return undefined;
  }

  const key = String(userId);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit;
  }

  // `.lean()` and a tight projection: this runs on the auth path and must stay cheap.
  const doc = await User.findById(key).select('tokenVersion accountStatus').lean();
  if (!doc) {
    const entry = { version: null, accountStatus: null, expiresAt: Date.now() + TTL_MS };
    cache.set(key, entry);
    return entry;
  }

  const entry = {
    version: doc.tokenVersion ?? 0,
    accountStatus: doc.accountStatus || 'active',
    expiresAt: Date.now() + TTL_MS,
  };

  cache.set(key, entry);
  if (cache.size % 500 === 0) prune();

  return entry;
};

/**
 * Returns the user's current tokenVersion, `null` if the user no longer exists, or
 * `undefined` to mean "cannot determine — skip the check".
 */
export const getCurrentTokenVersion = async (userId) => {
  const state = await getCurrentSessionState(userId);
  if (state === undefined) return undefined;
  return state.version;
};

/** Drop a user's cached version so the next request re-reads immediately. */
export const invalidate = (userId) => {
  cache.delete(String(userId));
};

/** Test helper — never call from application code. */
export const _reset = () => cache.clear();

export default { getCurrentSessionState, getCurrentTokenVersion, invalidate, _reset };
