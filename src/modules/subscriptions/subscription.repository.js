import mongoose from 'mongoose';
import Subscription from './subscription.model.js';
import SubscriptionHistory from './subscription-history.model.js';
import QueryBuilder from '../../common/query-builder/QueryBuilder.js';

export const findActiveByUserId = async (userId, session = null) => {
  const query = Subscription.findOne({
    userId,
    status: 'active',
  }).sort({ createdAt: -1 });
  return session ? await query.session(session) : await query;
};

export const findByUserId = async (userId) => {
  return await Subscription.findOne({ userId }).sort({ createdAt: -1 });
};

export const createSubscription = async (data, session = null) => {
  const options = session ? { session } : {};
  const [sub] = await Subscription.create([data], options);
  return sub;
};

export const updateById = async (id, updateData, session = null) => {
  const options = session ? { session, returnDocument: 'after' } : { returnDocument: 'after' };
  return await Subscription.findByIdAndUpdate(id, updateData, options);
};

/**
 * Creates the caller's active subscription, or returns the one that already exists.
 *
 * Replaces the previous read-then-create in ensureUserSubscription: two concurrent requests
 * (registration retried, or a client firing GET /subscriptions/me twice) could each read "no
 * subscription" and each insert one. The partial unique index on { userId } where
 * status:'active' now rejects the loser with E11000, and this swallows that and re-reads --
 * so the caller always gets exactly one row back, whichever request won.
 *
 * @param {Object} data
 * @param {import('mongoose').ClientSession} [session]
 * @returns {Promise<Object>}
 */
export const findOrCreateActiveSubscription = async (data, session = null) => {
  const existing = await findActiveByUserId(data.userId, session);
  if (existing) return existing;

  try {
    return await createSubscription(data, session);
  } catch (error) {
    if (error.code === 11000) {
      const winner = await findActiveByUserId(data.userId, session);
      if (winner) return winner;
    }
    throw error;
  }
};

/**
 * Compare-and-swap replacement of a user's active plan.
 *
 * Keyed on { _id, status: 'active' } so a row that was cancelled or expired out from under the
 * caller between read and write is NOT silently resurrected -- the update matches nothing and
 * returns null, which callers must treat as "retry or fail", never as success.
 *
 * @param {string|import('mongoose').Types.ObjectId} subscriptionId
 * @param {Object} updateData
 * @param {import('mongoose').ClientSession} [session]
 * @returns {Promise<Object|null>} the updated document, or null if the CAS lost
 */
export const replaceActivePlanCAS = async (subscriptionId, updateData, session = null) => {
  const options = session
    ? { session, returnDocument: 'after', runValidators: true }
    : { returnDocument: 'after', runValidators: true };

  return await Subscription.findOneAndUpdate(
    { _id: subscriptionId, status: 'active' },
    { $set: updateData },
    options
  );
};

export const findExpiringSubscriptions = async (beforeDate = new Date()) => {
  return await Subscription.find({
    status: 'active',
    currentPeriodEnd: { $lte: beforeDate, $ne: null },
  });
};

/**
 * Compare-and-swap expiry write for the renewal sweep. Guarded on the SAME predicate
 * findExpiringSubscriptions used to select the row (`status:'active'`, `currentPeriodEnd`
 * still in the past as of `expectedExpiredBefore`) -- not just `{_id, status:'active'}`
 * like replaceActivePlanCAS. Without the currentPeriodEnd half of the guard, a paid
 * webhook granting a fresh period between the sweep's read and this write would be
 * silently overwritten: the CAS would still match on status alone, and the user would
 * lose a plan they just paid for. A `null` return means exactly that race happened --
 * the caller must skip the row, never retry the downgrade. See
 * docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X8.
 *
 * @param {string|import('mongoose').Types.ObjectId} subscriptionId
 * @param {Object} updateData
 * @param {Date} expectedExpiredBefore
 * @returns {Promise<Object|null>}
 */
export const expireSubscriptionCAS = async (subscriptionId, updateData, expectedExpiredBefore) => {
  return await Subscription.findOneAndUpdate(
    {
      _id: subscriptionId,
      status: 'active',
      currentPeriodEnd: { $lte: expectedExpiredBefore, $ne: null },
    },
    { $set: updateData },
    { returnDocument: 'after', runValidators: true }
  );
};

/**
 * Reports users holding more than one `active` Subscription row.
 *
 * Pre-flight for building the partial unique index on an existing database: creating the index
 * fails outright if duplicates are already present, and the failure message does not say who.
 * Read-only -- it never deletes or merges anything; resolving a duplicate is a judgement call
 * about which plan the user actually paid for.
 *
 * @returns {Promise<Array<{ userId: string, count: number, subscriptions: Array }>>}
 */
export const findDuplicateActiveSubscriptions = async () => {
  const rows = await Subscription.aggregate([
    { $match: { status: 'active' } },
    {
      $group: {
        _id: '$userId',
        count: { $sum: 1 },
        subscriptions: {
          $push: {
            _id: '$_id',
            planCode: '$planCode',
            source: '$source',
            currentPeriodStart: '$currentPeriodStart',
            currentPeriodEnd: '$currentPeriodEnd',
            createdAt: '$createdAt',
          },
        },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]);

  return rows.map((row) => ({
    userId: row._id?.toString(),
    count: row.count,
    subscriptions: row.subscriptions,
  }));
};

// --- Subscription history (append-only) ---

export const createHistoryEntry = async (data, session = null) => {
  const options = session ? { session } : {};
  const [entry] = await SubscriptionHistory.create([data], options);
  return entry;
};

export const findHistoryByUserId = async (userId, queryString = {}) => {
  const builder = new QueryBuilder(SubscriptionHistory.find({ userId }), queryString)
    .filter(['changeType', 'newPlanCode', 'previousPlanCode'])
    .sort()
    .select();

  await builder.paginate(SubscriptionHistory, { userId: new mongoose.Types.ObjectId(String(userId)) });

  const items = await builder.mongooseQuery.populate({
    path: 'changedBy',
    select: 'name email role',
  });

  return { items, meta: builder.meta };
};

export default {
  findActiveByUserId,
  findByUserId,
  createSubscription,
  findOrCreateActiveSubscription,
  updateById,
  replaceActivePlanCAS,
  findExpiringSubscriptions,
  expireSubscriptionCAS,
  findDuplicateActiveSubscriptions,
  createHistoryEntry,
  findHistoryByUserId,
};
