import '../../src/common/globals.js';
import { jest, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';

/**
 * Refunds must move money exactly once and our record must match the provider. Paymob ignores
 * Idempotency-Key, a 5xx can still have refunded, and a refund triggers a callback on the
 * ORIGINAL transaction (success: true, full amount). The provider here keeps a per-transaction
 * refunded total like Paymob's refunded_amount_cents, and each test can make it fail.
 */
const refundedCents = new Map();
const refundCalls = [];
const ambiguous = (msg = 'Paymob refund failed: 502 Bad Gateway') => Object.assign(new Error(msg), { statusCode: 502 });
const definite = (msg = 'Paymob refund failed: amount exceeds refundable') =>
  Object.assign(new Error(msg), { statusCode: 502, definite: true });
const recordRefund = (transactionId, amount) =>
  refundedCents.set(transactionId, (refundedCents.get(transactionId) || 0) + Math.round(amount * 100));

let refundImpl;
let lookupImpl;
const provider = {
  refund: async (transactionId, amount, opts) => {
    refundCalls.push({ transactionId, amount });
    return refundImpl(transactionId, amount, opts);
  },
  getRefundedAmount: async (transactionId) => lookupImpl(transactionId),
};
jest.unstable_mockModule('../../src/modules/payments/providers/provider.factory.js', () => ({
  getProvider: () => provider,
  default: { getProvider: () => provider },
}));

const { default: User } = await import('../../src/modules/users/user.model.js');
const { default: Booking } = await import('../../src/modules/bookings/booking.model.js');
const { default: Payment } = await import('../../src/modules/payments/payment.model.js');
const { default: LedgerEntry } = await import('../../src/modules/ledger/ledger-entry.model.js');
const { default: AuditLog } = await import('../../src/modules/audit-log/audit-log.model.js');
const { default: paymentService } = await import('../../src/modules/payments/payment.service.js');
const { sweepStuckRefunds } = await import('../../src/jobs/payment-reconcile.cron.js');
const { default: eventBus } = await import('../../src/common/events/event-bus.js');
const { EVENTS } = await import('../../src/common/constants/events.constant.js');
const { REFUND_RECONCILE_POLICY } = await import('../../src/common/constants/statuses.constant.js');
const { default: auditLogListener } = await import('../../src/modules/audit-log/audit-log.listener.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN = 60 * 1000;

describe('Refund safety (real DB)', () => {
  let client;
  let booking;
  let payment;
  const emitted = { succeeded: 0, refunded: 0 };
  const onSucceeded = () => {
    emitted.succeeded += 1;
  };
  const onRefunded = () => {
    emitted.refunded += 1;
  };

  beforeAll(async () => {
    await connectTestDB();
    auditLogListener.register();
  }, 300000);
  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  beforeEach(async () => {
    await clearTestDB();
    refundedCents.clear();
    refundCalls.length = 0;
    refundImpl = async (transactionId, amount) => {
      recordRefund(transactionId, amount);
      return { status: 'refunded', refundId: 'rf1' };
    };
    lookupImpl = async (transactionId) => refundedCents.get(transactionId) || 0;
    emitted.succeeded = 0;
    emitted.refunded = 0;
    eventBus.on(EVENTS.PAYMENT_SUCCEEDED, onSucceeded);
    eventBus.on(EVENTS.PAYMENT_REFUNDED, onRefunded);

    client = await User.create({
      name: 'C',
      email: 'c@refund.test',
      phone: '01000000009',
      passwordHash: 'x',
      role: 'client',
    });
    booking = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: new mongoose.Types.ObjectId(),
      scheduledDate: new Date(Date.now() + 3 * 86400000),
      scheduledStartMinute: 600,
      scheduledEndMinute: 660,
      price: 500,
      duration: 60,
      status: 'cancelled',
      cancelledBy: 'client',
    });
    payment = await Payment.create({
      bookingId: booking._id,
      clientId: client._id,
      amount: 500,
      platformFeePercentage: 20,
      platformFeeAmount: 100,
      stylistPayoutAmount: 400,
      status: 'paid',
      provider: 'mock',
      providerTransactionId: 'tx1',
      paidAt: new Date(),
    });
  });

  afterEach(() => {
    eventBus.off(EVENTS.PAYMENT_SUCCEEDED, onSucceeded);
    eventBus.off(EVENTS.PAYMENT_REFUNDED, onRefunded);
  });

  const refund = (refundPercentage = 100) =>
    paymentService.processRefund({ bookingId: booking._id.toString(), refundPercentage, reason: 'client_cancel' });
  const fresh = () => Payment.findById(payment._id);
  // Paymob's callback for the ORIGINAL transaction after a refund: success true, full amount.
  const refundCallback = async (extra = {}) =>
    paymentService.settlePayment(await fresh(), {
      success: true,
      status: 'paid',
      transactionId: 'tx1',
      amountCents: 50000,
      isRefund: true,
      ...extra,
    });
  const refundLedgerCount = () => LedgerEntry.countDocuments({ paymentId: payment._id.toString(), entryType: 'REFUND' });

  describe('refund callbacks never turn a refund back into a payment', () => {
    it('keeps a fully refunded payment refunded when Paymob calls back on the original transaction', async () => {
      await refund(100);

      await refundCallback();
      await sleep(50);

      expect((await fresh()).status).toBe('refunded');
      expect(refundCalls).toHaveLength(1);
      expect(emitted.succeeded).toBe(0);
    });

    it('keeps it refunded even when the callback carries no refund flag', async () => {
      await refund(100);

      await refundCallback({ isRefund: undefined });

      expect((await fresh()).status).toBe('refunded');
      expect(refundCalls).toHaveLength(1);
    });

    it('keeps a partial refund on a completed booking partially refunded, without re-announcing the payment', async () => {
      await Booking.updateOne({ _id: booking._id }, { status: 'completed', cancelledBy: null });
      await refund(50);

      await refundCallback();
      await sleep(50);

      expect((await fresh()).status).toBe('partially_refunded');
      expect(emitted.succeeded).toBe(0);
    });

    it('records the refund once when the callback lands before our own final write', async () => {
      let release;
      const gate = new Promise((r) => {
        release = r;
      });
      refundImpl = async (transactionId, amount) => {
        recordRefund(transactionId, amount); // Paymob has refunded; its response is just slow
        await gate;
        return { status: 'refunded', refundId: 'rf1' };
      };

      const pending = refund(100);
      await sleep(100);
      expect((await fresh()).status).toBe('refunding');
      await refundCallback();
      release();
      await pending;
      await sleep(50);

      expect((await fresh()).status).toBe('refunded');
      expect(await refundLedgerCount()).toBe(1);
      expect(emitted.refunded).toBe(1);
    });

    it('does not mistake a refund child transaction for a duplicate capture on a paid payment', async () => {
      await paymentService.settlePayment(await fresh(), {
        success: true,
        status: 'paid',
        transactionId: 'tx_refund_child',
        amountCents: 50000,
        isRefund: true,
      });

      const saved = await fresh();
      expect(saved.status).toBe('paid');
      expect(refundCalls).toHaveLength(0);
      expect(saved.duplicateRefunds || []).toHaveLength(0);
    });

    it('still refunds a genuine duplicate capture on a refunded payment, separately', async () => {
      await refund(100);

      await paymentService.settlePayment(await fresh(), {
        success: true,
        status: 'paid',
        transactionId: 'tx2',
        amountCents: 50000,
      });

      const saved = await fresh();
      expect(saved.status).toBe('refunded');
      expect(refundCalls.map((c) => c.transactionId)).toEqual(['tx1', 'tx2']);
      expect(saved.duplicateRefunds.map((d) => d.transactionId)).toEqual(['tx2']);
    });
  });

  describe('a failed refund call is checked with the provider, never assumed', () => {
    it('records the refund when the provider errored but had actually refunded', async () => {
      refundImpl = async (transactionId, amount) => {
        recordRefund(transactionId, amount);
        throw ambiguous();
      };

      const result = await refund(100);

      expect(result.status).toBe('refunded');
      expect((await fresh()).status).toBe('refunded');
      expect(refundCalls).toHaveLength(1);
      expect(await refundLedgerCount()).toBe(1);
    });

    it('leaves an unconfirmed refund in refunding, then the sweep reverts it once the provider shows nothing refunded', async () => {
      refundImpl = async () => {
        throw ambiguous();
      };

      await expect(refund(100)).rejects.toMatchObject({ statusCode: 502 });
      let saved = await fresh();
      expect(saved.status).toBe('refunding');
      expect(saved.refundError).toMatch(/502/);

      // Too early: within the grace period nothing is decided.
      await sweepStuckRefunds(Date.now());
      expect((await fresh()).status).toBe('refunding');

      await sweepStuckRefunds(Date.now() + (REFUND_RECONCILE_POLICY.REVERT_GRACE_MINUTES + 1) * MIN);
      saved = await fresh();
      expect(saved.status).toBe('paid');

      refundImpl = async (transactionId, amount) => {
        recordRefund(transactionId, amount);
        return { status: 'refunded' };
      };
      await refund(100);
      expect((await fresh()).status).toBe('refunded');
      expect(refundedCents.get('tx1')).toBe(50000);
    });

    it('reverts at once when the provider definitely rejected the refund', async () => {
      refundImpl = async () => {
        throw definite();
      };

      await expect(refund(100)).rejects.toThrow(/amount exceeds refundable/);

      const saved = await fresh();
      expect(saved.status).toBe('paid');
      expect(saved.refundError).toMatch(/amount exceeds refundable/);
    });

    it('stays refunding while the provider cannot be asked, and the sweep records it once the provider shows it refunded', async () => {
      refundImpl = async () => {
        throw ambiguous();
      };
      lookupImpl = async () => {
        throw new Error('lookup unavailable');
      };

      await expect(refund(100)).rejects.toMatchObject({ statusCode: 502 });
      expect((await fresh()).status).toBe('refunding');

      // Later Paymob shows the refund went through after all.
      refundedCents.set('tx1', 50000);
      lookupImpl = async (transactionId) => refundedCents.get(transactionId) || 0;
      await sweepStuckRefunds(Date.now() + 30 * MIN);

      expect((await fresh()).status).toBe('refunded');
      expect(await refundLedgerCount()).toBe(1);
      await sleep(50);
      expect(emitted.refunded).toBe(1);
    });

    it('does not refund again when an earlier failed attempt had in fact refunded', async () => {
      // Old behaviour: a 5xx reverted to paid even though Paymob had refunded.
      await Payment.updateOne({ _id: payment._id }, { refundError: 'Paymob refund failed: 502', refundFailedAt: new Date() });
      refundedCents.set('tx1', 50000);

      const result = await refund(100);

      expect(result.status).toBe('refunded');
      expect(refundCalls).toHaveLength(0);
      expect(await refundLedgerCount()).toBe(1);
    });

    it('raises one critical audit entry when the provider shows a different refunded amount for a day', async () => {
      refundImpl = async (transactionId) => {
        refundedCents.set(transactionId, 20000);
        throw ambiguous();
      };

      await expect(refund(100)).rejects.toMatchObject({ statusCode: 502 });
      const later = Date.now() + (REFUND_RECONCILE_POLICY.ALERT_AFTER_HOURS * 60 + 1) * MIN;
      await sweepStuckRefunds(later);
      await sweepStuckRefunds(later + (REFUND_RECONCILE_POLICY.RETRY_MINUTES + 1) * MIN);
      await sleep(100);

      expect((await fresh()).status).toBe('refunding');
      const entries = await AuditLog.find({ targetId: payment._id.toString(), action: 'payment.refund_unresolved' });
      expect(entries).toHaveLength(1);
      expect(entries[0].severity).toBe('critical');
    });
  });

  describe('repeat and concurrent refund calls', () => {
    it('returns the existing refund when the same refund is requested again', async () => {
      await refund(100);

      const again = await refund(100);

      expect(again.status).toBe('refunded');
      expect(refundCalls).toHaveLength(1);
      expect(await refundLedgerCount()).toBe(1);
    });

    it('refuses a different refund on an already refunded payment', async () => {
      await refund(50);

      await expect(refund(100)).rejects.toMatchObject({ statusCode: 400 });
      expect(refundCalls).toHaveLength(1);
    });

    it('calls the provider once when two refunds race', async () => {
      const results = await Promise.allSettled([refund(100), refund(100)]);

      expect(refundCalls).toHaveLength(1);
      expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
      expect((await fresh()).status).toBe('refunded');
      expect(await refundLedgerCount()).toBe(1);
    });

    it('asks the provider about a stuck refund at most once per retry window', async () => {
      refundImpl = async () => {
        throw ambiguous();
      };
      lookupImpl = async () => {
        throw new Error('lookup unavailable');
      };
      await expect(refund(100)).rejects.toMatchObject({ statusCode: 502 });
      const t = Date.now() + 30 * MIN;
      let lookups = 0;
      lookupImpl = async () => {
        lookups += 1;
        throw new Error('still unavailable');
      };

      await sweepStuckRefunds(t);
      await sweepStuckRefunds(t + MIN);

      expect(lookups).toBe(1);
      expect((await fresh()).status).toBe('refunding');
    });
  });
});
