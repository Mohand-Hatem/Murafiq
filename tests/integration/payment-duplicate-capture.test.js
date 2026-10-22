import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';

/**
 * If a client pays twice (an old checkout link plus a newer attempt), the SECOND captured
 * transaction is refunded through the provider on its own transaction id. It must never go
 * through processRefund -- that would mark the real, legitimate payment as refunded.
 */
const refunds = [];
let refundImpl = async () => ({ status: 'refunded', refundId: 'rf1' });
jest.unstable_mockModule('../../src/modules/payments/providers/provider.factory.js', () => ({
  getProvider: () => ({
    refund: async (transactionId, amount, opts) => {
      refunds.push({ transactionId, amount, key: opts?.idempotencyKey });
      return refundImpl(transactionId, amount, opts);
    },
  }),
  default: {},
}));

const { default: User } = await import('../../src/modules/users/user.model.js');
const { default: Booking } = await import('../../src/modules/bookings/booking.model.js');
const { default: Payment } = await import('../../src/modules/payments/payment.model.js');
const { default: paymentService } = await import('../../src/modules/payments/payment.service.js');

describe('Duplicate capture on a paid payment', () => {
  let payment;

  beforeAll(async () => {
    await connectTestDB();
  }, 300000);
  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  beforeEach(async () => {
    await clearTestDB();
    refunds.length = 0;
    refundImpl = async () => ({ status: 'refunded', refundId: 'rf1' });
    const client = await User.create({
      name: 'C',
      email: 'c@test.com',
      phone: '01000000001',
      passwordHash: 'x',
      role: 'client',
    });
    const booking = await Booking.create({
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
      status: 'paid',
      provider: 'mock',
      providerTransactionId: 'tx1',
      paidAt: new Date(),
    });
  });

  // Like the real webhook, read the payment fresh on every delivery.
  const paidAgain = async (transactionId, amountCents = 50000) =>
    paymentService.settlePayment(await Payment.findById(payment._id), {
      success: true,
      status: 'paid',
      transactionId,
      amountCents,
    });

  it('refunds the second transaction on its own id and leaves the real payment paid', async () => {
    await paidAgain('tx2');

    expect(refunds).toEqual([{ transactionId: 'tx2', amount: 500, key: 'duplicate_capture:tx2' }]);
    const after = await Payment.findById(payment._id);
    expect(after.status).toBe('paid');
    expect(after.providerTransactionId).toBe('tx1');
    expect(after.duplicateRefunds).toHaveLength(1);
    expect(after.duplicateRefunds[0]).toMatchObject({
      transactionId: 'tx2',
      amount: 500,
      refundId: 'rf1',
    });
  });

  it('refunds the amount Paymob actually captured', async () => {
    await paidAgain('tx2', 30000);

    expect(refunds[0].amount).toBe(300);
  });

  it('does nothing when the same duplicate is delivered again', async () => {
    await paidAgain('tx2');
    await paidAgain('tx2');

    expect(refunds).toHaveLength(1);
    expect((await Payment.findById(payment._id)).duplicateRefunds).toHaveLength(1);
  });

  it('does nothing when the webhook for the real transaction is redelivered', async () => {
    await paidAgain('tx1');

    expect(refunds).toHaveLength(0);
  });

  it('records nothing and lets the provider retry when the refund call fails', async () => {
    refundImpl = async () => {
      throw new Error('Paymob unavailable');
    };

    await expect(paidAgain('tx2')).rejects.toMatchObject({ statusCode: 502 });
    expect((await Payment.findById(payment._id)).duplicateRefunds).toHaveLength(0);

    refundImpl = async () => ({ status: 'refunded', refundId: 'rf2' });
    await paidAgain('tx2');

    expect((await Payment.findById(payment._id)).duplicateRefunds[0].refundId).toBe('rf2');
  });

  it('never touches a payment that is not paid', async () => {
    await Payment.updateOne({ _id: payment._id }, { status: 'pending', providerTransactionId: undefined });
    const pending = await Payment.findById(payment._id);

    await paymentService.settlePayment(pending, {
      success: true,
      status: 'paid',
      transactionId: 'tx9',
      amountCents: 50000,
    });

    expect(refunds).toHaveLength(0);
  });
});
