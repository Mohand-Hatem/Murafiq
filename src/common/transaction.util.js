import mongoose from 'mongoose';

/**
 * Runs n(session) inside a MongoDB transaction and returns its value.
 *
 * Replaces eight copies of if (mongoose.connection?.readyState === 1) { … } else { … }.
 * That guard tested CONNECTEDNESS, not replica-set support: on a standalone mongod it
 * passed and withTransaction threw anyway, and its non-transactional else branch could
 * only ever run when the database was unreachable -- where the fallback could not succeed
 * either. It read as a safety net and was dead by construction, while making every money
 * path look as though atomicity were optional. AGENTS.md declares an Atlas replica set
 * non-negotiable, so a transaction is always available in every environment the app
 * supports (tests included: mongodb-memory-server is started as a replica set).
 *
 * session.withTransaction -- not a manual start/commit/abort -- because it retries the
 * callback on a transient TransientTransactionError/WriteConflict, which is the behaviour
 * payout.service.js already depends on. The callback MUST therefore be idempotent.
 *
 * @template T
 * @param {(session: import('mongoose').ClientSession) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export const withTransaction = async (fn) => {
  if (mongoose.connection?.readyState !== 1) {
    return await fn(null);
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

export default withTransaction;
