import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';

/**
 * Paymob rejects a second intention that reuses special_reference ("An Order with ref ...
 * already exists"), and the checkout link was never stored -- so a client who closed the payment
 * page could never pay that booking. initializePayment must reuse a live link, and otherwise
 * create attempt N+1 under a unique reference the webhook can still map back to the booking.
 */
const calls = [];
jest.unstable_mockModule('../../src/modules/payments/providers/provider.factory.js', () => ({
  getProvider: () => ({
    initialize: async ({ bookingId, reference, amount }) => {
      calls.push({ reference: reference || bookingId, amount });
      const n = calls.length;
      return {
        paymentUrl: `https://checkout.test/pay/${reference || bookingId}?n=${n}`,
        providerIntentionId: `int_${n}`,
      };
    },
  }),
  default: {},
}));

const { default: User } = await import('../../src/modules/users/user.model.js');
const { default: Booking } = await import('../../src/modules/bookings/booking.model.js');
const { default: Payment } = await import('../../src/modules/payments/payment.model.js');
const { default: paymentService } = await import('../../src/modules/payments/payment.service.js');
const { default: PaymobProvider } = await import(
  '../../src/modules/payments/providers/paymob.provider.js'
);

describe('Payment re-initialization (P1)', () => {
  let client;
  let booking;

  beforeAll(async () => {
    await connectTestDB();
  }, 300000);
  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  beforeEach(async () => {
    await clearTestDB();
    calls.length = 0;
    client = await User.create({
      name: 'Client',
      email: 'c@test.com',
      phone: '01000000001',
      passwordHash: 'x',
      role: 'client',
      isEmailVerified: true,
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
  });

  const init = () => paymentService.initializePayment(client, booking._id.toString());

  it('first call uses the plain booking id as the Paymob reference and stores the link', async () => {
    const res = await init();

    expect(calls).toHaveLength(1);
    expect(calls[0].reference).toBe(booking._id.toString());
    expect(res.paymentUrl).toContain('n=1');
    const stored = await Payment.findOne({ bookingId: booking._id }).select('+providerPaymentUrl');
    expect(stored.providerPaymentUrl).toBe(res.paymentUrl);
  });

  it('second call within the reuse window returns the SAME link without calling Paymob', async () => {
    const first = await init();
    const second = await init();

    expect(calls).toHaveLength(1);
    expect(second.paymentUrl).toBe(first.paymentUrl);
  });

  it('after the link goes stale, creates attempt 1 under a unique reference', async () => {
    await init();
    await Payment.updateOne(
      { bookingId: booking._id },
      { paymentUrlCreatedAt: new Date(Date.now() - 60 * 60 * 1000) }
    );

    const res = await init();

    expect(calls).toHaveLength(2);
    expect(calls[1].reference).toBe(`${booking._id}-1`);
    expect(res.paymentUrl).toContain('n=2');
    expect((await Payment.findOne({ bookingId: booking._id })).paymentAttempt).toBe(1);
  });

  it('a payment initialised before this fix (intention id, no stored link) gets attempt 1', async () => {
    await Payment.create({
      bookingId: booking._id,
      clientId: client._id,
      amount: 500,
      platformFeePercentage: 20,
      platformFeeAmount: 100,
      stylistPayoutAmount: 400,
      status: 'pending',
      provider: 'mock',
      providerIntentionId: 'legacy_int',
    });

    await init();

    expect(calls[0].reference).toBe(`${booking._id}-1`);
  });

  it('does not reuse a link whose amount no longer matches the payment (coupon applied)', async () => {
    await init();
    await Payment.updateOne({ bookingId: booking._id }, { amount: 450 });

    await init();

    expect(calls).toHaveLength(2);
    expect(calls[1].amount).toBe(450);
  });

  it('refuses to initialise an already-paid booking', async () => {
    await init();
    await Payment.updateOne({ bookingId: booking._id }, { status: 'paid' });

    await expect(init()).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('PaymobProvider.handleCallback — attempt-suffixed references', () => {
  const callback = async (specialReference) => {
    const provider = new PaymobProvider();
    provider.verifyHmac = () => true; // signature checking is covered elsewhere
    return provider.handleCallback({
      obj: { id: 1, success: true, special_reference: specialReference, order: { id: 9 } },
    });
  };
  const id = '6ad9bb4884f35ee7d6b4b3da';

  it('maps "<bookingId>-<attempt>" back to the bookingId', async () => {
    expect((await callback(`${id}-2`)).bookingId).toBe(id);
  });

  it('leaves a plain bookingId and subscription references untouched', async () => {
    expect((await callback(id)).bookingId).toBe(id);
    expect((await callback('subord_6ac458b6abf7e30245b837c2')).bookingId).toBe(
      'subord_6ac458b6abf7e30245b837c2'
    );
  });
});
