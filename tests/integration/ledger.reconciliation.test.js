import mongoose from 'mongoose';
import LedgerEntry from '../../src/modules/ledger/ledger-entry.model.js';
import Payment from '../../src/modules/payments/payment.model.js';
import { reconcileLedger } from '../../src/jobs/ledger-reconciliation.cron.js';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';

/**
 * Reconciliation is the only thing standing between a failed ledger dual-write and money
 * moving with no audit record. The ledger write is deliberately non-fatal — failing a
 * payment webhook would make the provider retry and risk double-processing — so a write
 * that throws is logged and swallowed. This job has to catch what that swallows.
 *
 * The blind spot these tests pin: the balance check derives its booking list FROM THE
 * LEDGER. A payment whose dual-write failed entirely never enters that list, and reports
 * as perfectly balanced because zero debits equal zero credits. And a real failure has
 * exactly that shape — both entries of a pair share one try/catch, so when the first
 * throws the second never runs and both go missing together.
 */

const bookingId = new mongoose.Types.ObjectId();
const clientId = new mongoose.Types.ObjectId();

const makePayment = (over = {}) =>
  Payment.create({
    bookingId: new mongoose.Types.ObjectId(),
    clientId,
    amount: 1000,
    platformFeeAmount: 150,
    stylistPayoutAmount: 850,
    status: 'paid',
    ...over,
  });

const makeEntry = (over = {}) =>
  LedgerEntry.create({
    idempotencyKey: `k-${new mongoose.Types.ObjectId()}`,
    entryType: 'PAYMENT',
    accountType: 'CLIENT',
    direction: 'DEBIT',
    amountMinor: 100000,
    bookingId,
    ...over,
  });

beforeAll(async () => {
  await connectTestDB();
});
afterAll(async () => {
  await closeTestDB();
});
beforeEach(async () => {
  await clearTestDB();
});

describe('Balance check', () => {
  it('reports a balanced booking as clean', async () => {
    await makeEntry({ direction: 'DEBIT', amountMinor: 100000 });
    await makeEntry({ direction: 'CREDIT', amountMinor: 100000, accountType: 'ESCROW' });

    const res = await reconcileLedger();
    expect(res.unbalancedCount).toBe(0);
  });

  it('flags a booking whose debits and credits disagree', async () => {
    await makeEntry({ direction: 'DEBIT', amountMinor: 100000 });
    await makeEntry({ direction: 'CREDIT', amountMinor: 40000, accountType: 'ESCROW' });

    const res = await reconcileLedger();
    expect(res.unbalancedCount).toBe(1);
  });
});

describe('Missing-entry detection', () => {
  it('flags a PAID payment that has no ledger entries at all', async () => {
    // This is what a failed dual-write leaves behind: real money recorded on the Payment,
    // nothing in the ledger.
    const orphan = await makePayment({ status: 'paid' });

    const res = await reconcileLedger();
    expect(res.missingLedgerCount).toBe(1);

    // And it must NOT show up as unbalanced — zero equals zero. That is precisely why the
    // balance check alone could never find it.
    expect(res.unbalancedCount).toBe(0);
    expect(orphan.status).toBe('paid');
  });

  it.each(['refunded', 'partially_refunded'])(
    'flags a %s payment with no ledger entries',
    async (status) => {
      await makePayment({ status, refundAmount: 500 });
      const res = await reconcileLedger();
      expect(res.missingLedgerCount).toBe(1);
    }
  );

  it('does not flag a payment that has its ledger entries', async () => {
    const payment = await makePayment({ status: 'paid' });
    await makeEntry({ paymentId: payment._id, direction: 'DEBIT', amountMinor: 100000 });
    await makeEntry({
      paymentId: payment._id,
      direction: 'CREDIT',
      amountMinor: 100000,
      accountType: 'ESCROW',
    });

    const res = await reconcileLedger();
    expect(res.missingLedgerCount).toBe(0);
  });

  it('ignores payments that have not settled', async () => {
    // A pending or failed payment has no money to account for, so it must not raise noise.
    await makePayment({ status: 'pending' });
    await makePayment({ status: 'failed' });

    const res = await reconcileLedger();
    expect(res.missingLedgerCount).toBe(0);
  });

  it('counts every orphan, not just the first', async () => {
    await makePayment({ status: 'paid' });
    await makePayment({ status: 'paid' });
    await makePayment({ status: 'refunded' });

    const res = await reconcileLedger();
    expect(res.missingLedgerCount).toBe(3);
  });
});

describe('Ledger entries are immutable and idempotent', () => {
  it('refuses a duplicate idempotency key', async () => {
    const key = 'duplicate-probe-key';
    await makeEntry({ idempotencyKey: key });
    // The unique index is what makes a retried refund or a redelivered webhook safe.
    await expect(makeEntry({ idempotencyKey: key })).rejects.toMatchObject({ code: 11000 });
  });

  it('stores amounts as integer piastres', async () => {
    const entry = await makeEntry({ amountMinor: 33333 });
    expect(Number.isInteger(entry.amountMinor)).toBe(true);
    // Integer minor units, not floats: the ledger exists to be summed across many rows,
    // and repeated float addition is where drift appears.
    expect(entry.amountMinor).toBe(33333);
  });
});
