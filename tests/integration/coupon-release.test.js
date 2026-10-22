import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';

/**
 * A coupon redeemed on a payment that never completes must go back to the client, and the
 * discount's ledger entries must be reversed (an ADJUSTMENT pair, never an edit or delete).
 */
jest.unstable_mockModule('../../src/modules/payments/providers/provider.factory.js', () => ({
  getProvider: () => ({
    initialize: async ({ bookingId, reference }) => ({
      paymentUrl: `https://checkout.test/pay/${reference || bookingId}`,
      providerIntentionId: `int_${Math.random()}`,
    }),
    inquire: async () => null,
    refund: async () => ({ status: 'refunded', refundId: 'r1' }),
  }),
  default: {},
}));

const { default: User } = await import('../../src/modules/users/user.model.js');
const { default: Request } = await import('../../src/modules/requests/request.model.js');
const { default: Offer } = await import('../../src/modules/offers/offer.model.js');
const { default: Booking } = await import('../../src/modules/bookings/booking.model.js');
const { default: Coupon } = await import('../../src/modules/coupons/coupon.model.js');
const { default: LedgerEntry } = await import('../../src/modules/ledger/ledger-entry.model.js');
const { default: offerService } = await import('../../src/modules/offers/offer.service.js');
const { default: paymentService } = await import('../../src/modules/payments/payment.service.js');
const { sweepUnpaidBookings } = await import('../../src/jobs/payment-timeout.cron.js');

const MIN = 60 * 1000;

describe('Coupon given back when an unpaid booking is released', () => {
  let client;
  let stylist;
  let booking;
  let coupon;

  beforeAll(async () => {
    await connectTestDB();
    await Booking.syncIndexes();
  }, 300000);
  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  beforeEach(async () => {
    await clearTestDB();
    const mk = (name, role) =>
      User.create({
        name,
        email: `${name}@test.com`,
        phone: `010${Math.floor(Math.random() * 1e8)}`,
        passwordHash: 'x',
        role,
        isEmailVerified: true,
        verification: { status: 'verified' },
      });
    client = await mk('client', 'client');
    stylist = await mk('stylist', 'stylist');
    const request = await Request.create({
      clientId: client._id,
      visibility: 'broadcast',
      title: 'Outfit',
      status: 'OPEN',
      date: new Date(Date.now() + 3 * 86400000),
      time: '10:00',
      expiresAt: new Date(Date.now() + 48 * 60 * MIN),
      offerCount: 1,
    });
    const offer = await Offer.create({
      requestId: request._id,
      stylistId: stylist._id,
      clientId: client._id,
      requestVisibility: 'broadcast',
      price: 500,
      duration: 60,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 24 * 60 * MIN),
    });
    coupon = await Coupon.create({
      code: 'WELCOME10',
      recipientId: client._id,
      discountPercentage: 10,
      maxDiscountEgp: 150,
      status: 'ISSUED',
      issuedReason: 'MARKETING',
      expiresAt: new Date(Date.now() + 14 * 86400000),
    });

    ({ booking } = await offerService.acceptOfferAndPay(client, offer._id.toString()));
    await paymentService.initializePayment(client, booking._id.toString(), {
      couponCode: 'WELCOME10',
    });
  });

  const release = async () => {
    await Booking.updateOne({ _id: booking._id }, { paymentExpiresAt: new Date(Date.now() - MIN) });
    return sweepUnpaidBookings();
  };

  const discountEntries = () =>
    LedgerEntry.find({ bookingId: booking._id, entryType: { $in: ['COUPON_DISCOUNT', 'ADJUSTMENT'] } });

  it('precondition: the coupon is redeemed and the discount is on the ledger', async () => {
    expect((await Coupon.findById(coupon._id)).status).toBe('REDEEMED');
    expect(await discountEntries()).toHaveLength(2);
  });

  it('makes the coupon usable again', async () => {
    await release();

    const after = await Coupon.findById(coupon._id);
    expect(after.status).toBe('ISSUED');
    expect(after.redeemedOnBookingId).toBeUndefined();
    expect(after.redeemedAt).toBeUndefined();
  });

  it('reverses the discount on the ledger with an ADJUSTMENT pair that nets to zero', async () => {
    await release();

    const entries = await discountEntries();
    expect(entries).toHaveLength(4);
    const sum = (dir) =>
      entries.filter((e) => e.direction === dir).reduce((n, e) => n + e.amountMinor, 0);
    expect(sum('DEBIT')).toBe(sum('CREDIT'));
    expect(entries.filter((e) => e.entryType === 'ADJUSTMENT')).toHaveLength(2);
    // The coupon discount was 50 EGP = 5000 piastres; the reversal returns exactly that.
    expect(entries.filter((e) => e.entryType === 'ADJUSTMENT').every((e) => e.amountMinor === 5000)).toBe(true);
  });

  it('lets the client redeem the same coupon on a new booking afterwards', async () => {
    await release();

    const again = await Coupon.findOneAndUpdate(
      { _id: coupon._id, status: 'ISSUED' },
      { $set: { status: 'REDEEMED' } }
    );
    expect(again).not.toBeNull();
  });

  it('is idempotent — a second release attempt posts nothing more', async () => {
    await release();
    await release();

    expect(await discountEntries()).toHaveLength(4);
  });

  it('leaves a coupon untouched when no coupon was used', async () => {
    const other = await Coupon.create({
      code: 'OTHER',
      recipientId: client._id,
      status: 'ISSUED',
      issuedReason: 'MARKETING',
      expiresAt: new Date(Date.now() + 86400000),
    });

    await release();

    expect((await Coupon.findById(other._id)).status).toBe('ISSUED');
  });
});
