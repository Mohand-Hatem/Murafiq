import crypto from 'crypto';
import mongoose from 'mongoose';
import User from '../users/user.model.js';

/**
 * Refresh-session persistence.
 *
 * Sessions live as a subdocument array on the User document rather than in their own
 * collection: they are always read and written in the context of exactly one user, they
 * are small and bounded (MAX_SESSIONS_PER_USER), and keeping them inline means rotation
 * is a single atomic update instead of a cross-collection transaction.
 *
 * Auth and Users already share the User document, so importing the model here follows the
 * same documented exception as `auth.repository.js`.
 */

/**
 * Deterministic hash, deliberately not bcrypt.
 *
 * Refresh tokens are high-entropy signed JWTs, not user-chosen passwords, so the slow
 * salted hashing that defends against offline dictionary attacks buys nothing. It would
 * also make the atomic rotation below impossible: a salted hash cannot be matched by
 * equality inside a query filter, forcing a read-then-write window that two concurrent
 * refreshes could both pass through.
 */
export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export const createSession = async (userId, { tokenHash, deviceLabel, expiresAt }, maxSessions) => {
  const session = {
    _id: new mongoose.Types.ObjectId(),
    tokenHash,
    deviceLabel: deviceLabel || 'Unknown device',
    createdAt: new Date(),
    lastUsedAt: new Date(),
    expiresAt,
  };

  // $push + $slice keeps the newest N and drops the oldest in one round trip, so a user
  // signing in from an eleventh device silently loses their stalest session rather than
  // accumulating credentials forever.
  await User.updateOne(
    { _id: userId },
    { $push: { sessions: { $each: [session], $slice: -Math.abs(maxSessions || 10) } } }
  );

  return session;
};

/**
 * Rotate one session's token, atomically.
 *
 * The filter matches BOTH the session id and the presented token's hash, so the update
 * only lands if this exact token is still the live one for that session. Two concurrent
 * refreshes carrying the same token therefore cannot both succeed: the first swaps the
 * hash, and the second no longer matches and gets `null` back — which the service treats
 * as a reuse event. No lock, no transaction, one round trip.
 */
export const rotateSession = async (userId, sessionId, currentTokenHash, newTokenHash, newExpiresAt) => {
  return User.findOneAndUpdate(
    {
      _id: userId,
      sessions: { $elemMatch: { _id: sessionId, tokenHash: currentTokenHash } },
    },
    {
      $set: {
        'sessions.$.tokenHash': newTokenHash,
        'sessions.$.lastUsedAt': new Date(),
        'sessions.$.expiresAt': newExpiresAt,
      },
    },
    { new: true }
  )
    .select('+sessions')
    .lean();
};

/** Remove a single session — current-device logout. Other devices are untouched. */
export const removeSession = async (userId, sessionId) => {
  const res = await User.updateOne({ _id: userId }, { $pull: { sessions: { _id: sessionId } } });
  return res.modifiedCount > 0;
};

/** Remove every session — logout-all, admin revocation, password events, theft response. */
export const removeAllSessions = async (userId) => {
  const res = await User.updateOne({ _id: userId }, { $set: { sessions: [] } });
  return res.modifiedCount > 0;
};

/** Does this session id still exist for the user? Used to distinguish reuse from a stale id. */
export const findSessionById = async (userId, sessionId) => {
  const doc = await User.findById(userId).select('+sessions').lean();
  if (!doc?.sessions) return null;
  return doc.sessions.find((s) => String(s._id) === String(sessionId)) || null;
};

/** Active sessions for display — never exposes tokenHash. */
export const listSessions = async (userId) => {
  const doc = await User.findById(userId).select('+sessions').lean();
  if (!doc?.sessions) return [];
  return doc.sessions.map((s) => ({
    id: String(s._id),
    deviceLabel: s.deviceLabel,
    createdAt: s.createdAt,
    lastUsedAt: s.lastUsedAt,
    expiresAt: s.expiresAt,
  }));
};

/** Drop sessions whose refresh token has already expired. */
export const pruneExpiredSessions = async (userId, now = new Date()) => {
  await User.updateOne({ _id: userId }, { $pull: { sessions: { expiresAt: { $lte: now } } } });
};

export default {
  hashToken,
  createSession,
  rotateSession,
  removeSession,
  removeAllSessions,
  findSessionById,
  listSessions,
  pruneExpiredSessions,
};
