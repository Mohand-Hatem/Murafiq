import cron from 'node-cron';
import LedgerEntry from '../modules/ledger/ledger-entry.model.js';
import Payment from '../modules/payments/payment.model.js';
import { PAYMENT_STATUS } from '../common/constants/statuses.constant.js';
import env from '../config/env.config.js';
import { logger } from '../config/logger.config.js';

const RECONCILIATION_SCHEDULE = '0 3 * * *'; // Daily at 3:00 AM Cairo time

let registered = false;

/**
 * Finds settled payments that have NO ledger entries at all.
 *
 * The balance check below cannot see these. It derives its booking list from the ledger
 * itself, so a payment whose dual-write failed entirely never enters the list and reports
 * as clean — debits and credits are both zero, which balances perfectly.
 *
 * That is the exact shape of a real failure: the two entries of a pair are written inside
 * one try/catch, so when the first throws the second never runs and BOTH go missing. The
 * ledger write is deliberately non-fatal (failing a webhook would make the provider retry
 * and risk double-processing), which means the only thing standing between a silent gap
 * and an auditable one is this check.
 *
 * Starts from Payment — the operational record of money actually moving — rather than from
 * the ledger, so a missing ledger entry cannot hide itself.
 */
const findPaymentsMissingLedgerEntries = async (since) => {
  const settled = await Payment.find({
    status: { $in: [PAYMENT_STATUS.PAID, PAYMENT_STATUS.REFUNDED, PAYMENT_STATUS.PARTIALLY_REFUNDED] },
    updatedAt: { $gte: since },
  })
    .select('_id bookingId status amount')
    .lean();

  const orphans = [];
  for (const payment of settled) {
    const count = await LedgerEntry.countDocuments({ paymentId: payment._id });
    if (count === 0) {
      orphans.push(payment);
    }
  }
  return orphans;
};

/**
 * Checks all bookings touched in the last 24h to assert zero delta between debits and credits.
 * sum(debits) === sum(credits)
 * @returns {Promise<{ checkedBookings: number, unbalancedCount: number, missingLedgerCount: number }>}
 */
export const reconcileLedger = async () => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentBookings = await LedgerEntry.distinct('bookingId', {
    bookingId: { $ne: null },
    createdAt: { $gte: since },
  });

  let unbalancedCount = 0;
  for (const bookingId of recentBookings) {
    const entries = await LedgerEntry.find({ bookingId });
    const totalDebits = entries
      .filter((e) => e.direction === 'DEBIT')
      .reduce((acc, e) => acc + e.amountMinor, 0);
    const totalCredits = entries
      .filter((e) => e.direction === 'CREDIT')
      .reduce((acc, e) => acc + e.amountMinor, 0);

    if (totalDebits !== totalCredits) {
      unbalancedCount++;
      logger.error(
        `[Ledger Reconciliation Alert] Unbalanced booking ${bookingId}: Total Debits=${totalDebits} piastres, Total Credits=${totalCredits} piastres, Delta=${totalDebits - totalCredits}`
      );
    }
  }

  // Second pass: settled payments with no ledger record at all. Invisible to the balance
  // check above, because a booking with zero entries never appears in `recentBookings`.
  const orphans = await findPaymentsMissingLedgerEntries(since);
  for (const payment of orphans) {
    logger.error(
      `[Ledger Reconciliation Alert] Payment ${payment._id} (booking ${payment.bookingId}) is '${payment.status}' for ${payment.amount} EGP but has NO ledger entries. The dual-write failed and money moved without an audit record.`
    );
  }

  return {
    checkedBookings: recentBookings.length,
    unbalancedCount,
    missingLedgerCount: orphans.length,
  };
};

export const startLedgerReconciliationCron = () => {
  if (registered) return;
  if (env.NODE_ENV === 'test') return; // Tests drive reconciliation directly

  registered = true;

  cron.schedule(RECONCILIATION_SCHEDULE, async () => {
    try {
      const summary = await reconcileLedger();
      logger.info(
        `Ledger reconciliation complete: Checked ${summary.checkedBookings} booking(s), ${summary.unbalancedCount} unbalanced, ${summary.missingLedgerCount} settled payment(s) with no ledger entry.`
      );
    } catch (err) {
      logger.error(`Ledger reconciliation cron failed: ${err.message}`);
    }
  });

  logger.info(`Ledger reconciliation cron scheduled (${RECONCILIATION_SCHEDULE}).`);
};

export default { reconcileLedger, startLedgerReconciliationCron };
