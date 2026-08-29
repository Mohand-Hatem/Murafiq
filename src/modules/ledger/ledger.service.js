import ledgerRepository from './ledger.repository.js';

/**
 * Converts a decimal EGP amount to integer piastres (minor units).
 * e.g., 250.50 EGP -> 25050 piastres
 * @param {number} egp
 * @returns {number} integer piastres
 */
export const egpToPiastres = (egp) => {
  if (typeof egp !== 'number' || isNaN(egp)) {
    throw new Error('Amount in EGP must be a valid number');
  }
  return Math.round(egp * 100);
};

/**
 * Converts integer piastres back to decimal EGP.
 * e.g., 25050 piastres -> 250.50 EGP
 * @param {number} piastres
 * @returns {number} decimal EGP
 */
export const piastresToEgp = (piastres) => {
  if (typeof piastres !== 'number' || isNaN(piastres)) {
    throw new Error('Amount in piastres must be a valid number');
  }
  return Math.round(piastres) / 100;
};

/**
 * Posts a single immutable ledger entry with idempotency protection.
 * If an entry with the same idempotencyKey already exists, returns the existing record.
 *
 * @param {Object} entryData
 * @param {import('mongoose').ClientSession} [session]
 * @returns {Promise<Object>} The created or existing LedgerEntry document
 */
export const postEntry = async (entryData, session = null) => {
  const {
    idempotencyKey,
    entryType,
    amountMinor,
    accountType,
    direction,
    currency = 'EGP',
    bookingId = null,
    paymentId = null,
    payoutId = null,
    accountId = null,
    correlationId = null,
    notes = '',
  } = entryData;

  if (!idempotencyKey) {
    throw new Error('idempotencyKey is required for every ledger entry');
  }
  if (!entryType || !accountType || !direction || amountMinor === undefined) {
    throw new Error('Missing required fields for ledger entry (entryType, accountType, direction, amountMinor)');
  }
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error('amountMinor must be a non-negative integer piastres value');
  }

  try {
    return await ledgerRepository.createEntry(
      {
        idempotencyKey,
        entryType,
        amountMinor,
        accountType,
        direction,
        currency,
        bookingId,
        paymentId,
        payoutId,
        accountId,
        correlationId,
        notes,
      },
      session
    );
  } catch (error) {
    // Catch duplicate idempotency key and return the existing ledger entry
    if (error.code === 11000 && idempotencyKey) {
      const existing = await ledgerRepository.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        return existing;
      }
    }
    throw error;
  }
};

/**
 * Posts a balanced pair of debit and credit ledger entries atomically within a session.
 *
 * @param {Object} debitData
 * @param {Object} creditData
 * @param {import('mongoose').ClientSession} [session]
 * @returns {Promise<[Object, Object]>}
 */
export const postDoubleEntry = async (debitData, creditData, session = null) => {
  if (debitData.amountMinor !== creditData.amountMinor) {
    throw new Error('Double entry debit and credit amounts must match exactly');
  }

  const debitEntry = await postEntry({ ...debitData, direction: 'DEBIT' }, session);
  const creditEntry = await postEntry({ ...creditData, direction: 'CREDIT' }, session);

  return [debitEntry, creditEntry];
};

/**
 * Retrieves the full financial statement for a booking.
 * @param {string|import('mongoose').Types.ObjectId} bookingId
 * @returns {Promise<Array>}
 */
export const getBookingStatement = async (bookingId) => {
  return await ledgerRepository.findByBookingId(bookingId);
};

/**
 * Retrieves ledger entries associated with a user.
 * @param {string|import('mongoose').Types.ObjectId} accountId
 * @param {Object} [filter]
 * @param {Object} [options]
 * @returns {Promise<Array>}
 */
export const getUserStatement = async (accountId, filter = {}, options = {}) => {
  return await ledgerRepository.findBySubjectId(accountId, filter, options);
};

export default {
  egpToPiastres,
  piastresToEgp,
  postEntry,
  postDoubleEntry,
  getBookingStatement,
  getUserStatement,
};
