import Payment from '../src/modules/payments/payment.model.js';
import Payout from '../src/modules/payouts/payout.model.js';
import Booking from '../src/modules/bookings/booking.model.js';
import LedgerEntry from '../src/modules/ledger/ledger-entry.model.js';
import * as ledgerService from '../src/modules/ledger/ledger.service.js';
import { connectDB } from '../src/database/connection.js';

export const backfillLedgerOpeningBalances = async () => {
  console.log('Connecting to database for Ledger Opening Balances migration...');
  await connectDB();

  try {
    let paymentCount = 0;
    let refundCount = 0;
    let payoutCount = 0;

    // 1. Process settled Payments
    const settledPayments = await Payment.find({
      status: { $in: ['paid', 'refunded', 'partially_refunded'] },
    });

    for (const payment of settledPayments) {
      const paymentIdStr = payment._id.toString();
      const bookingIdStr = (payment.bookingId?._id || payment.bookingId || '').toString();
      const clientIdStr = (payment.clientId?._id || payment.clientId || '').toString();
      const amountMinor = ledgerService.egpToPiastres(payment.amount);

      // Client Payment Debit & Escrow Credit
      const clientPaidKey = `opening_balance:payment:client:${paymentIdStr}`;
      const existingClientEntry = await LedgerEntry.findOne({ idempotencyKey: clientPaidKey });

      if (!existingClientEntry) {
        await LedgerEntry.create([
          {
            idempotencyKey: clientPaidKey,
            entryType: 'ADJUSTMENT',
            accountType: 'CLIENT',
            direction: 'DEBIT',
            amountMinor,
            bookingId: bookingIdStr || null,
            paymentId: paymentIdStr,
            accountId: clientIdStr || null,
            correlationId: 'MIGRATION_OPENING_BALANCE',
            notes: 'Opening balance migration: historical client payment',
          },
          {
            idempotencyKey: `opening_balance:payment:escrow:${paymentIdStr}`,
            entryType: 'ADJUSTMENT',
            accountType: 'ESCROW',
            direction: 'CREDIT',
            amountMinor,
            bookingId: bookingIdStr || null,
            paymentId: paymentIdStr,
            correlationId: 'MIGRATION_OPENING_BALANCE',
            notes: 'Opening balance migration: historical escrow hold',
          },
        ]);
        paymentCount++;
      }

      // If refunded, add refund adjustment
      if (payment.refundAmount > 0) {
        const refundKey = `opening_balance:refund:client:${paymentIdStr}`;
        const existingRefundEntry = await LedgerEntry.findOne({ idempotencyKey: refundKey });

        if (!existingRefundEntry) {
          const refundMinor = ledgerService.egpToPiastres(payment.refundAmount);
          await LedgerEntry.create([
            {
              idempotencyKey: `opening_balance:refund:escrow:${paymentIdStr}`,
              entryType: 'ADJUSTMENT',
              accountType: 'ESCROW',
              direction: 'DEBIT',
              amountMinor: refundMinor,
              bookingId: bookingIdStr || null,
              paymentId: paymentIdStr,
              correlationId: 'MIGRATION_OPENING_BALANCE',
              notes: 'Opening balance migration: historical escrow refund release',
            },
            {
              idempotencyKey: refundKey,
              entryType: 'ADJUSTMENT',
              accountType: 'CLIENT',
              direction: 'CREDIT',
              amountMinor: refundMinor,
              bookingId: bookingIdStr || null,
              paymentId: paymentIdStr,
              accountId: clientIdStr || null,
              correlationId: 'MIGRATION_OPENING_BALANCE',
              notes: 'Opening balance migration: historical client refund',
            },
          ]);
          refundCount++;
        }
      }
    }

    console.log(
      `✅ Backfilled opening balances for ${paymentCount} historical Payment(s) and ${refundCount} refund(s).`
    );

    // 2. Process paid Payouts
    const paidPayouts = await Payout.find({ status: 'paid' });

    for (const payout of paidPayouts) {
      const payoutIdStr = payout._id.toString();
      const stylistIdStr = (payout.stylistId?._id || payout.stylistId || '').toString();

      for (const bookingId of payout.bookingIds) {
        const bookingIdStr = (bookingId?._id || bookingId).toString();
        const payoutBookingKey = `opening_balance:payout:stylist:${payoutIdStr}:${bookingIdStr}`;
        const existingPayoutEntry = await LedgerEntry.findOne({ idempotencyKey: payoutBookingKey });

        if (!existingPayoutEntry) {
          const bookingDoc = await Booking.findById(bookingIdStr);
          const amountEgp = bookingDoc && bookingDoc.price
            ? Math.round(bookingDoc.price * 0.85 * 100) / 100
            : (payout.amount / (payout.bookingIds.length || 1));
          const amountMinor = ledgerService.egpToPiastres(amountEgp);

          await LedgerEntry.create([
            {
              idempotencyKey: `opening_balance:payout:escrow:${payoutIdStr}:${bookingIdStr}`,
              entryType: 'ADJUSTMENT',
              accountType: 'ESCROW',
              direction: 'DEBIT',
              amountMinor,
              bookingId: bookingIdStr,
              payoutId: payoutIdStr,
              correlationId: 'MIGRATION_OPENING_BALANCE',
              notes: 'Opening balance migration: historical payout escrow release',
            },
            {
              idempotencyKey: payoutBookingKey,
              entryType: 'ADJUSTMENT',
              accountType: 'STYLIST',
              direction: 'CREDIT',
              amountMinor,
              bookingId: bookingIdStr,
              payoutId: payoutIdStr,
              accountId: stylistIdStr || null,
              correlationId: 'MIGRATION_OPENING_BALANCE',
              notes: 'Opening balance migration: historical stylist payout',
            },
          ]);
          payoutCount++;
        }
      }
    }

    console.log(`✅ Backfilled opening balances for ${payoutCount} historical Payout booking item(s).`);
  } catch (error) {
    console.error(`❌ Opening balance migration failed: ${error.message}`);
    throw error;
  }
};

if (process.argv[1] && process.argv[1].endsWith('backfill-ledger-opening-balances.js')) {
  backfillLedgerOpeningBalances()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default backfillLedgerOpeningBalances;
