import LedgerEntry from './ledger-entry.model.js';

export const createEntry = async (data, session = null) => {
  const options = session ? { session } : {};
  const [entry] = await LedgerEntry.create([data], options);
  return entry;
};

export const createEntries = async (entries, session = null) => {
  const options = session ? { session } : {};
  return await LedgerEntry.create(entries, options);
};

export const findByIdempotencyKey = async (idempotencyKey) => {
  return await LedgerEntry.findOne({ idempotencyKey });
};

export const findByBookingId = async (bookingId) => {
  return await LedgerEntry.find({ bookingId }).sort({ createdAt: 1 });
};

export const findByPaymentId = async (paymentId) => {
  return await LedgerEntry.find({ paymentId }).sort({ createdAt: 1 });
};

export const findByPayoutId = async (payoutId) => {
  return await LedgerEntry.find({ payoutId }).sort({ createdAt: 1 });
};

// Renamed from findBySubjectId: LedgerEntry has no `subjectId` field (the schema field is
// `accountId`, see ledger-entry.model.js), so the previous query always matched zero
// documents -- both getUserStatement and the admin ledger-statement `subjectId` filter
// silently returned empty results for every user.
export const findByAccountId = async (accountId, filter = {}, options = {}) => {
  return await LedgerEntry.find({ accountId, ...filter }, null, options).sort({ createdAt: -1 });
};

export const findByCorrelationId = async (correlationId) => {
  return await LedgerEntry.find({ correlationId }).sort({ createdAt: 1 });
};

export const aggregateBookingBalance = async (bookingId) => {
  return await LedgerEntry.aggregate([
    { $match: { bookingId } },
    {
      $group: {
        _id: '$accountType',
        totalDebit: {
          $sum: {
            $cond: [{ $eq: ['$direction', 'DEBIT'] }, '$amountMinor', 0],
          },
        },
        totalCredit: {
          $sum: {
            $cond: [{ $eq: ['$direction', 'CREDIT'] }, '$amountMinor', 0],
          },
        },
      },
    },
  ]);
};

export const findEntries = async (query = {}, pagination = { page: 1, limit: 20 }) => {
  const page = parseInt(pagination.page, 10) || 1;
  const limit = parseInt(pagination.limit, 10) || 20;
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    LedgerEntry.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    LedgerEntry.countDocuments(query),
  ]);

  return {
    items,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export default {
  createEntry,
  createEntries,
  findByIdempotencyKey,
  findByBookingId,
  findByPaymentId,
  findByPayoutId,
  findByAccountId,
  findByCorrelationId,
  aggregateBookingBalance,
  findEntries,
};
