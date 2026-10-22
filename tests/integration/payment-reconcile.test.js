import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';

/**
 * A lost Paymob webhook must not leave a paid booking unpaid. reconcilePayment asks Paymob
 * (transaction inquiry) about a still-pending payment and settles it through the SAME code path
 * as the webhook. Paymob documents inquiry as "for manual checks", so the sweep is throttled.
 */
const inquiries = [];
let inquireImpl = async () => null;
jest.unstable_mockModule('../../src/modules/payments/providers/provider.factory.js', () => ({
  getProvider: () => ({
    inquire: async (ref) => {
      inquiries.push(ref);
      return inquireImpl(ref);
    },
  }),
  default: {},
}));

const { default: User } = await import('../../src/modules/users/user.model.js');
const { default: Booking } = await import('../../src/modules/bookings/booking.model.js');
const { default: Payment } = await import('../../src/modules/payments/payment.model.js');
const { default: LedgerEntry } = await import('../../src/modules/ledger/ledger-entry.model.js');
const { default: paymentService } = await import('../../src/modules/payments/payment.service.js');
const { default: paymentRepository } = await import(
  '../../src/modules/payments/payment.repository.js'
);
const { default: PaymobProvider } = await import(
  '../../src/modules/payments/providers/paymob.provider.js'
);
const { default: eventBus } = await import('../../src/common/events/event-bus.js');

const MIN = 60 * 1000;

describe('Payment reconciliation', () => {
  let booking;
  let payment;

  beforeAll(async () => {
    await connectTestDB();
  }, 300000);
  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  beforeEach(async () => {
    await clearTestDB();
    inquiries.length = 0;
    inquireImpl = async () => null;
    const client = await User.create({
      name: 'C',
      email: 'c@test.com',
      phone: '01000000001',
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
      status: 'confirmed',
    });
    payment = await Payment.create({
      bookingId: booking._id,
      clientId: client._id,
      amount: 500,
      platformFeePercentage: 20,
      platformFeeAmount: 100,
      stylistPayoutAmount: 400,
      status: 'pending',
      provider: 'mock',
      providerIntentionId: 'int_1',
      paymentUrlCreatedAt: new Date(Date.now() - 10 * MIN),
    });
  });

  const paidResult = { success: true, pending: false, transactionId: '777', amountCents: 50000 };

  it('settles a pending payment that Paymob reports as paid — payment, ledger and event', async () => {
    inquireImpl = async () => paidResult;
    const emitted = [];
    const listener = (p) => emitted.push(p);
    eventBus.on('payment.succeeded', listener);

    const res = await paymentService.reconcilePayment(payment);
    eventBus.off('payment.succeeded', listener);

    expect(res.settled).toBe(true);
    const after = await Payment.findById(payment._id);
    expect(after.status).toBe('paid');
    expect(after.providerTransactionId).toBe('777');
    expect(await LedgerEntry.countDocuments({ paymentId: payment._id })).toBe(2);
    expect(emitted).toHaveLength(1);
  });

  it('asks about every attempt reference, newest first, and stops at the first paid one', async () => {
    await Payment.updateOne({ _id: payment._id }, { paymentAttempt: 2 });
    payment = await Payment.findById(payment._id);
    inquireImpl = async (ref) => (ref.endsWith('-1') ? paidResult : null);

    await paymentService.reconcilePayment(payment);

    expect(inquiries).toEqual([`${booking._id}-2`, `${booking._id}-1`]);
  });

  it('leaves the payment pending when Paymob says unpaid, still pending, or unknown', async () => {
    for (const r of [null, { success: false, pending: false }, { success: false, pending: true }]) {
      inquireImpl = async () => r;
      const res = await paymentService.reconcilePayment(payment);
      expect(res.settled).toBe(false);
    }
    expect((await Payment.findById(payment._id)).status).toBe('pending');
  });

  it('refuses a paid result whose amount differs from what was expected', async () => {
    inquireImpl = async () => ({ ...paidResult, amountCents: 100 });

    await expect(paymentService.reconcilePayment(payment)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect((await Payment.findById(payment._id)).status).toBe('pending');
  });

  it('is idempotent: reconciling twice settles once', async () => {
    inquireImpl = async () => paidResult;
    await paymentService.reconcilePayment(payment);
    const second = await paymentService.reconcilePayment(await Payment.findById(payment._id));

    expect(second.settled).toBe(false);
    expect(await LedgerEntry.countDocuments({ paymentId: payment._id })).toBe(2);
  });

  describe('claimStalePending (sweep throttle)', () => {
    const claim = (now = Date.now()) =>
      paymentRepository.claimStalePending({
        now,
        minAgeMs: 2 * MIN,
        maxAgeMs: 60 * MIN,
        retryMs: 5 * MIN,
      });

    it('claims a payment pending 2-60 minutes, then not again within the retry window', async () => {
      expect(String((await claim())._id)).toBe(String(payment._id));
      expect(await claim()).toBeNull();
    });

    it('claims it again once the retry window has passed', async () => {
      await claim();
      expect(await claim(Date.now() + 6 * MIN)).not.toBeNull();
    });

    it('ignores payments that are too new, too old, paid, or never initialised', async () => {
      await Payment.updateOne({ _id: payment._id }, { paymentUrlCreatedAt: new Date() });
      expect(await claim()).toBeNull();
      await Payment.updateOne(
        { _id: payment._id },
        { paymentUrlCreatedAt: new Date(Date.now() - 3 * 60 * MIN) }
      );
      expect(await claim()).toBeNull();
      await Payment.updateOne(
        { _id: payment._id },
        { paymentUrlCreatedAt: new Date(Date.now() - 10 * MIN), status: 'paid' }
      );
      expect(await claim()).toBeNull();
      await Payment.updateOne(
        { _id: payment._id },
        { status: 'pending', providerIntentionId: null }
      );
      expect(await claim()).toBeNull();
    });
  });
});

describe('PaymobProvider.inquire', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const withFetch = (inquiryResponse) => {
    globalThis.fetch = jest.fn(async (url) =>
      String(url).includes('/api/auth/tokens')
        ? { ok: true, json: async () => ({ token: 'tok' }) }
        : inquiryResponse
    );
  };

  it('normalises a found transaction', async () => {
    withFetch({
      ok: true,
      status: 200,
      json: async () => ({ id: 558307532, success: true, pending: false, amount_cents: 90000 }),
    });
    const res = await new PaymobProvider().inquire('abc');
    expect(res).toEqual({
      success: true,
      pending: false,
      transactionId: '558307532',
      amountCents: 90000,
    });
  });

  it('returns null for an unknown reference (404)', async () => {
    withFetch({ ok: false, status: 404, json: async () => ({}) });
    expect(await new PaymobProvider().inquire('nope')).toBeNull();
  });
});
