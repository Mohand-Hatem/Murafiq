import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';

/**
 * Accepting an offer RESERVES the slot as `pending_payment` and returns the checkout link;
 * payment confirms it; a missed deadline (or a client cancel) releases the slot, reopens the
 * request and revives the rival offers. See docs/superpowers/specs/2026-10-21-pay-before-confirm-design.md
 */
const providerState = { failInitialize: false, inquire: async () => null };
jest.unstable_mockModule('../../src/modules/payments/providers/provider.factory.js', () => ({
  getProvider: () => ({
    initialize: async ({ bookingId, reference }) => {
      if (providerState.failInitialize) throw new Error('Paymob down');
      return {
        paymentUrl: `https://checkout.test/pay/${reference || bookingId}`,
        clientSecret: 'secret',
        providerIntentionId: `int_${Date.now()}_${Math.random()}`,
      };
    },
    inquire: async (ref) => providerState.inquire(ref),
    refund: async () => ({ status: 'refunded', refundId: 'r1' }),
  }),
  default: {},
}));

const { default: User } = await import('../../src/modules/users/user.model.js');
const { default: Request } = await import('../../src/modules/requests/request.model.js');
const { default: Offer } = await import('../../src/modules/offers/offer.model.js');
const { default: Booking } = await import('../../src/modules/bookings/booking.model.js');
const { default: Payment } = await import('../../src/modules/payments/payment.model.js');
const { default: ScheduleBlock } = await import('../../src/modules/bookings/schedule.model.js');
const { default: offerService } = await import('../../src/modules/offers/offer.service.js');
const { default: bookingService } = await import('../../src/modules/bookings/booking.service.js');
const { default: paymentService } = await import('../../src/modules/payments/payment.service.js');
const { sweepUnpaidBookings } = await import('../../src/jobs/payment-timeout.cron.js');
const { default: eventBus } = await import('../../src/common/events/event-bus.js');

const MIN = 60 * 1000;

describe('Pay-before-confirm', () => {
  let client;
  let stylistA;
  let stylistB;
  let request;
  let offerA;
  let offerB;

  beforeAll(async () => {
    await connectTestDB();
    await Booking.syncIndexes();
    await Offer.syncIndexes();
  }, 300000);
  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  const mkUser = (name, role) =>
    User.create({
      name,
      email: `${name}@test.com`,
      phone: `010${Math.floor(Math.random() * 1e8)}`,
      passwordHash: 'x',
      role,
      isEmailVerified: true,
      verification: { status: 'verified' },
    });

  const mkRequest = (daysAhead = 3) =>
    Request.create({
      clientId: client._id,
      visibility: 'broadcast',
      title: 'Wedding outfit',
      status: 'OPEN',
      date: new Date(Date.now() + daysAhead * 86400000),
      time: '10:00',
      expiresAt: new Date(Date.now() + 48 * 60 * MIN),
      offerCount: 2,
    });

  const mkOffer = (stylist, price) =>
    Offer.create({
      requestId: request._id,
      stylistId: stylist._id,
      clientId: client._id,
      requestVisibility: 'broadcast',
      price,
      duration: 60,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 24 * 60 * MIN),
    });

  const accept = (offer = offerA, options) =>
    offerService.acceptOfferAndPay(client, offer._id.toString(), options);

  const expire = (bookingId) =>
    Booking.updateOne({ _id: bookingId }, { paymentExpiresAt: new Date(Date.now() - MIN) });

  beforeEach(async () => {
    await clearTestDB();
    providerState.failInitialize = false;
    providerState.inquire = async () => null;
    client = await mkUser('client', 'client');
    stylistA = await mkUser('stylistA', 'stylist');
    stylistB = await mkUser('stylistB', 'stylist');
    request = await mkRequest();
    offerA = await mkOffer(stylistA, 500);
    offerB = await mkOffer(stylistB, 600);
  });

  describe('accept', () => {
    it('reserves the slot as pending_payment with a 30-minute deadline and returns the link', async () => {
      const { booking, paymentUrl } = await accept();

      expect(booking.status).toBe('pending_payment');
      const ms = new Date(booking.paymentExpiresAt).getTime() - Date.now();
      expect(ms).toBeGreaterThan(29 * MIN);
      expect(ms).toBeLessThanOrEqual(30 * MIN);
      expect(paymentUrl).toContain('https://checkout.test/pay/');
      expect((await Payment.findOne({ bookingId: booking._id })).status).toBe('pending');
      expect(await ScheduleBlock.countDocuments({ bookingId: booking._id })).toBe(1);
      expect((await Request.findById(request._id)).status).toBe('FULFILLED');
    });

    it('records which offers this accept closed, so they can be revived', async () => {
      const { booking } = await accept();

      const b = await Offer.findById(offerB._id);
      expect(b.status).toBe('CLOSED');
      expect(String(b.closedByBookingId)).toBe(String(booking._id));
    });

    it('still accepts when Paymob is down — paymentUrl is null and the client can retry', async () => {
      providerState.failInitialize = true;

      const { booking, paymentUrl } = await accept();

      expect(booking.status).toBe('pending_payment');
      expect(paymentUrl).toBeNull();
    });

    it('never sets a deadline later than the session start', async () => {
      await Request.updateOne({ _id: request._id }, { date: new Date(Date.now() + 10 * MIN) });
      // 10:00 on that date may be far away; force the start 10 minutes out explicitly.
      const soon = new Date(Date.now() + 10 * MIN);
      const hh = String(soon.getHours()).padStart(2, '0');
      const mm = String(soon.getMinutes()).padStart(2, '0');
      await Request.updateOne({ _id: request._id }, { date: soon, time: `${hh}:${mm}` });

      const { booking } = await accept();

      expect(new Date(booking.paymentExpiresAt).getTime()).toBeLessThanOrEqual(
        Date.now() + 11 * MIN
      );
    });

    it('demo (cash) bookings skip payment and are confirmed immediately', async () => {
      const { booking, paymentUrl } = await accept(offerA, { bookingMode: 'demo' });

      expect(booking.status).toBe('confirmed');
      expect(paymentUrl).toBeNull();
      expect(await Payment.countDocuments({ bookingId: booking._id })).toBe(0);
    });
  });

  describe('payment', () => {
    const paid = (payment) =>
      paymentService.settlePayment(payment, {
        success: true,
        status: 'paid',
        transactionId: 'tx1',
        amountCents: 50000,
      });

    it('confirms the booking in the same step that marks the payment paid', async () => {
      const { booking } = await accept();
      const events = [];
      const l = (p) => events.push(p);
      eventBus.on('payment.succeeded', l);

      await paid(await Payment.findOne({ bookingId: booking._id }));
      eventBus.off('payment.succeeded', l);

      const after = await Booking.findById(booking._id);
      expect(after.status).toBe('confirmed');
      expect(after.paymentExpiresAt).toBeFalsy();
      expect(events).toHaveLength(1);
    });

    it('refunds a payment that arrives after the booking was released', async () => {
      const { booking } = await accept();
      const payment = await Payment.findOne({ bookingId: booking._id });
      await expire(booking._id);
      await sweepUnpaidBookings();

      // The webhook reads the payment fresh — by now the release has marked it 'failed'.
      await paid(await Payment.findById(payment._id));

      expect((await Booking.findById(booking._id)).status).toBe('cancelled');
      expect((await Payment.findById(payment._id)).status).toBe('refunded');
    });

    it('refuses to start a payment for a released booking', async () => {
      const { booking } = await accept();
      await expire(booking._id);
      await sweepUnpaidBookings();

      await expect(
        paymentService.initializePayment(client, booking._id.toString())
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('deadline sweep', () => {
    it('releases an unpaid booking: slot, request and offers all come back', async () => {
      const { booking } = await accept();
      const emitted = [];
      const l = (p) => emitted.push(p);
      eventBus.on('booking.cancelled', l);
      await expire(booking._id);

      const res = await sweepUnpaidBookings();
      eventBus.off('booking.cancelled', l);

      expect(res.released).toBe(1);
      const b = await Booking.findById(booking._id);
      expect(b.status).toBe('cancelled');
      expect(b.cancelledBy).toBe('system');
      expect(b.cancellationReason).toBe('payment_timeout');
      expect(b.isLive).toBe(false);
      expect(await ScheduleBlock.countDocuments({ bookingId: booking._id })).toBe(0);
      expect((await Request.findById(request._id)).status).toBe('OPEN');
      expect((await Offer.findById(offerA._id)).status).toBe('PENDING');
      expect((await Offer.findById(offerB._id)).status).toBe('PENDING');
      expect((await Payment.findOne({ bookingId: booking._id })).status).toBe('failed');
      expect(emitted).toHaveLength(1);
      expect(emitted[0].cancelledBy).toBe('system');
    });

    it('lets the client accept again afterwards — even a different rival offer', async () => {
      const first = await accept(offerA);
      await expire(first.booking._id);
      await sweepUnpaidBookings();

      const second = await accept(offerB);

      expect(second.booking.status).toBe('pending_payment');
      expect(String(second.booking._id)).not.toBe(String(first.booking._id));
    });

    it('closes the request and expires the offers when the session start has already passed', async () => {
      const { booking } = await accept();
      await Booking.updateOne(
        { _id: booking._id },
        { paymentExpiresAt: new Date(Date.now() - MIN), scheduledDate: new Date(Date.now() - 86400000) }
      );

      await sweepUnpaidBookings();

      expect((await Request.findById(request._id)).status).toBe('CLOSED');
      expect((await Offer.findById(offerB._id)).status).toBe('EXPIRED');
    });

    it('does not touch bookings that are paid, confirmed or still inside their window', async () => {
      const { booking } = await accept();

      expect((await sweepUnpaidBookings()).released).toBe(0);

      await Booking.updateOne(
        { _id: booking._id },
        { status: 'confirmed', paymentExpiresAt: new Date(Date.now() - MIN) }
      );
      expect((await sweepUnpaidBookings()).released).toBe(0);
      expect((await Booking.findById(booking._id)).status).toBe('confirmed');
    });

    it('asks Paymob first: a payment whose webhook was lost confirms instead of expiring', async () => {
      const { booking } = await accept();
      await Payment.updateOne(
        { bookingId: booking._id },
        { providerIntentionId: 'int_x', paymentUrlCreatedAt: new Date(Date.now() - 20 * MIN) }
      );
      await expire(booking._id);
      providerState.inquire = async () => ({
        success: true,
        pending: false,
        transactionId: 'tx9',
        amountCents: 50000,
      });

      const res = await sweepUnpaidBookings();

      expect(res.released).toBe(0);
      expect((await Booking.findById(booking._id)).status).toBe('confirmed');
      expect((await Payment.findOne({ bookingId: booking._id })).status).toBe('paid');
    });

    it('is idempotent — a second run releases nothing', async () => {
      const { booking } = await accept();
      await expire(booking._id);

      await sweepUnpaidBookings();
      const again = await sweepUnpaidBookings();

      expect(again.released).toBe(0);
    });
  });

  describe('client cancels while unpaid', () => {
    it('releases the booking with no refund, no fee and cancelledBy=client', async () => {
      const { booking } = await accept();

      await bookingService.cancelBooking(client, booking._id.toString(), {});

      const b = await Booking.findById(booking._id);
      expect(b.status).toBe('cancelled');
      expect(b.cancelledBy).toBe('client');
      expect(b.isLive).toBe(false);
      expect((await Payment.findOne({ bookingId: booking._id })).status).toBe('failed');
      expect((await Request.findById(request._id)).status).toBe('OPEN');
    });
  });

  describe('existing flows ignore pending_payment', () => {
    it('check-in is refused until the booking is confirmed', async () => {
      const { booking } = await accept();

      await expect(
        bookingService.checkIn(client, booking._id.toString(), {})
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('live-booking uniqueness', () => {
    it('still forbids two live bookings for one request', async () => {
      await accept(offerA);

      await expect(accept(offerB)).rejects.toBeDefined();
      expect(await Booking.countDocuments({ requestId: request._id, isLive: true })).toBe(1);
    });
  });
});

