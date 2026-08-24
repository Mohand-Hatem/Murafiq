import '../../src/common/globals.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import Request from '../../src/modules/requests/request.model.js';
import Offer from '../../src/modules/offers/offer.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import ScheduleBlock from '../../src/modules/bookings/schedule.model.js';
import Payment from '../../src/modules/payments/payment.model.js';
import offerService from '../../src/modules/offers/offer.service.js';
import bookingService from '../../src/modules/bookings/booking.service.js';
import { round2 } from '../../src/modules/payments/payment.service.js';

describe('Real Database Integration (In-Memory Replica Set)', () => {
  let clientUser;
  let stylistUser;
  let requestDoc;
  let offerDoc;

  beforeAll(async () => {
    await connectTestDB();
  }, 300000);

  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  beforeEach(async () => {
    await clearTestDB();

    // Create real users in MongoDB
    clientUser = await User.create({
      name: 'Real Client',
      email: 'client@real.dev',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'client',
      isEmailVerified: true,
      phone: '+201012345678',
      verification: { status: 'verified' },
    });

    stylistUser = await User.create({
      name: 'Real Stylist',
      email: 'stylist@real.dev',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'stylist',
      isEmailVerified: true,
      phone: '+201087654321',
      verification: { status: 'verified' },
    });

    // Create real styling request
    requestDoc = await Request.create({
      clientId: clientUser._id,
      stylistId: stylistUser._id,
      title: 'Real In-Memory Styling Session',
      date: new Date('2026-09-01T00:00:00.000Z'),
      time: '10:00',
      status: 'pending',
    });

    // Create real offer
    offerDoc = await Offer.create({
      requestId: requestDoc._id,
      clientId: clientUser._id,
      stylistId: stylistUser._id,
      price: 1000,
      duration: 60,
      status: 'pending',
    });
  });

  it('atomically creates Booking, ScheduleBlock, and Payment records in MongoDB upon offer acceptance', async () => {
    const booking = await offerService.acceptOffer(clientUser, offerDoc._id.toString());

    expect(booking).toBeDefined();

    // Verify real documents persisted in MongoDB
    const persistedBooking = await Booking.findById(booking._id);
    expect(persistedBooking).not.toBeNull();
    expect(persistedBooking.status).toBe('confirmed');

    const persistedBlock = await ScheduleBlock.findOne({ bookingId: booking._id });
    expect(persistedBlock).not.toBeNull();
    expect(persistedBlock.startMinute).toBe(600); // 10:00 AM
    expect(persistedBlock.endMinute).toBe(660);   // +60 min

    const persistedPayment = await Payment.findOne({ bookingId: booking._id });
    expect(persistedPayment).not.toBeNull();
    expect(persistedPayment.amount).toBe(1000);
    expect(persistedPayment.status).toBe('pending');
  });

  it('rejects overlapping bookings via unique schedule constraint in real MongoDB', async () => {
    // 1. Accept first offer
    await offerService.acceptOffer(clientUser, offerDoc._id.toString());

    // 2. Create second request & offer for same stylist at same time
    const secondReq = await Request.create({
      clientId: clientUser._id,
      stylistId: stylistUser._id,
      title: 'Conflicting Request',
      date: new Date('2026-09-01T00:00:00.000Z'),
      time: '10:00',
      status: 'pending',
    });

    const secondOffer = await Offer.create({
      requestId: secondReq._id,
      clientId: clientUser._id,
      stylistId: stylistUser._id,
      price: 1200,
      duration: 60,
      status: 'pending',
    });

    // 3. Attempting to accept conflicting offer must fail with 409
    await expect(offerService.acceptOffer(clientUser, secondOffer._id.toString())).rejects.toThrow(
      /already booked/i
    );
  });

  it('retains 25% platform fee and sets PARTIALLY_REFUNDED status on <24h cancellation', async () => {
    // Set scheduled date within 4 hours
    const nearFuture = new Date(Date.now() + 4 * 60 * 60 * 1000);
    await Request.findByIdAndUpdate(requestDoc._id, { date: nearFuture });

    const booking = await offerService.acceptOffer(clientUser, offerDoc._id.toString());

    // Mark payment paid
    await Payment.findOneAndUpdate({ bookingId: booking._id }, { status: 'paid', paidAt: new Date() });

    // Cancel booking as client < 24h before
    await bookingService.cancelBooking(clientUser, booking._id.toString(), {
      reason: 'Emergency reschedule',
    });

    const updatedPayment = await Payment.findOne({ bookingId: booking._id });
    expect(updatedPayment.status).toBe('partially_refunded');
    expect(updatedPayment.refundAmount).toBe(750.0);
    expect(updatedPayment.platformFeeAmount).toBe(250.0);
    expect(updatedPayment.stylistPayoutAmount).toBe(0.0);

    // Ledger invariant holds
    expect(
      round2(
        updatedPayment.platformFeeAmount +
          updatedPayment.stylistPayoutAmount +
          updatedPayment.refundAmount
      )
    ).toBe(updatedPayment.amount);
  });
});
