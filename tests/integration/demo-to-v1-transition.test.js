import '../../src/common/globals.js';
import request from 'supertest';
import app from '../../src/app.js';
import User from '../../src/modules/users/user.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import Payment from '../../src/modules/payments/payment.model.js';
import LedgerEntry from '../../src/modules/ledger/ledger-entry.model.js';
import Request from '../../src/modules/requests/request.model.js';
import Offer from '../../src/modules/offers/offer.model.js';
import { seedPlans } from '../../src/modules/subscriptions/plan.repository.js';
import { applyPlanGrant } from '../../src/modules/subscriptions/subscription.service.js';
import * as planRepository from '../../src/modules/subscriptions/plan.repository.js';
import chatService from '../../src/modules/chat/chat.service.js';
import bookingService from '../../src/modules/bookings/booking.service.js';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';

describe('Demo → V1 Same-Database Transition & Invariant Verification (Phase 5)', () => {
  beforeAll(async () => {
    await connectTestDB();
    await seedPlans();
  }, 300000);

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    await seedPlans();
  });

  it('proves the full lifecycle in Demo and seamless transition to V1 on the exact same database', async () => {
    // =========================================================================
    // STEP 1: Registration in Demo & Automatic Free Tier Provisioning
    // =========================================================================
    const clientUser = await User.create({
      name: 'Transition Client',
      email: 'client.transition@murafiq.dev',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'client',
      isEmailVerified: true,
      phone: '+201099998888',
      verification: { status: 'verified' },
    });

    const stylistUser = await User.create({
      name: 'Transition Stylist',
      email: 'stylist.transition@murafiq.dev',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'stylist',
      isEmailVerified: true,
      phone: '+201077776666',
      verification: { status: 'verified' },
    });

    const clientToken = generateAccessToken({ sub: clientUser._id.toString(), role: clientUser.role });
    const stylistToken = generateAccessToken({ sub: stylistUser._id.toString(), role: stylistUser.role });

    // 1.1 Verify Demo exposes only Free plans
    const demoPlansRes = await request(app).get('/api/demo/subscriptions/plans');
    expect(demoPlansRes.statusCode).toBe(200);
    expect(demoPlansRes.body.data.plans.every((p) => p.tier === 'free' && p.priceEgp === 0)).toBe(true);

    // 1.2 Inspect active Demo subscription and Free entitlements
    const demoSubRes = await request(app)
      .get('/api/demo/subscriptions/me')
      .set('Authorization', `Bearer ${clientToken}`);
    expect(demoSubRes.statusCode).toBe(200);
    expect(demoSubRes.body.data.subscription.planCode).toBe('client.free');
    expect(demoSubRes.body.data.subscription.currentPeriodEnd).toBeNull();
    expect(demoSubRes.body.data.entitlements['requests.daily']).toBe(1);

    const stylistSubRes = await request(app)
      .get('/api/demo/subscriptions/me')
      .set('Authorization', `Bearer ${stylistToken}`);
    expect(stylistSubRes.statusCode).toBe(200);
    expect(stylistSubRes.body.data.subscription.planCode).toBe('stylist.free');

    // 1.3 Assert commerce routes return 404 in Demo
    const demoCheckoutRes = await request(app)
      .post('/api/demo/subscriptions/checkout')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ planCode: 'client.pro' });
    expect(demoCheckoutRes.statusCode).toBe(404);

    // =========================================================================
    // STEP 2: Demo Marketplace Request & Offer Lifecycle
    // =========================================================================
    const requestDoc = await Request.create({
      clientId: clientUser._id,
      stylistId: stylistUser._id,
      title: 'Demo Session in Cairo',
      date: new Date(Date.now() + 48 * 60 * 60 * 1000),
      time: '12:00',
      status: 'OPEN',
    });

    const offerDoc = await Offer.create({
      requestId: requestDoc._id,
      clientId: clientUser._id,
      stylistId: stylistUser._id,
      price: 500,
      duration: 60,
      status: 'PENDING',
    });

    // =========================================================================
    // STEP 3: Demo Offer Acceptance & Cash-On-Delivery Booking Creation
    // =========================================================================
    const acceptRes = await request(app)
      .patch(`/api/demo/offers/${offerDoc._id}/accept`)
      .set('Authorization', `Bearer ${clientToken}`);

    expect(acceptRes.statusCode).toBe(200);
    const demoBookingId = acceptRes.body.data._id || acceptRes.body.data.id;

    // 3.1 Verify Demo Booking Persistence Invariants
    const persistedDemoBooking = await Booking.findById(demoBookingId);
    expect(persistedDemoBooking).not.toBeNull();
    expect(persistedDemoBooking.bookingMode).toBe('demo');
    expect(persistedDemoBooking.payoutStatus).toBe('not_owed');
    expect(persistedDemoBooking.status).toBe('confirmed');

    // 3.2 Guarantee ZERO Payment records created
    const paymentRecord = await Payment.findOne({ bookingId: demoBookingId });
    expect(paymentRecord).toBeNull();

    // 3.3 Guarantee ZERO Ledger entries created
    const ledgerEntries = await LedgerEntry.find({ bookingId: demoBookingId });
    expect(ledgerEntries.length).toBe(0);

    // 3.4 Guarantee immediate Chat Unlock
    const conversation = await chatService.getConversation(demoBookingId);
    expect(conversation).toBeDefined();
    expect(conversation.isOpen).toBe(true);

    // 3.5 Guarantee Check-In Bypasses Payment Gate in Demo
    const checkInRes = await request(app)
      .patch(`/api/demo/bookings/${demoBookingId}/check-in`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({});
    expect(checkInRes.statusCode).toBe(200);

    // 3.6 Mutual completion in Demo (both parties confirm)
    await bookingService.confirmCompletion(clientUser, demoBookingId);
    await bookingService.confirmCompletion(stylistUser, demoBookingId);
    const completedDemoBooking = await Booking.findById(demoBookingId);
    expect(completedDemoBooking.status).toBe('completed');
    expect(completedDemoBooking.payoutStatus).toBe('not_owed');

    // =========================================================================
    // STEP 4: Transition to V1 on the Exact Same Database (Zero Data Loss)
    // =========================================================================

    // 4.1 Existing users remain intact
    const v1UserRes = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${clientToken}`);
    expect(v1UserRes.statusCode).toBe(200);
    expect(v1UserRes.body.data.email).toBe('client.transition@murafiq.dev');

    // 4.2 Historical Demo booking remains immutable and identified as 'demo'
    const v1DemoBookingRead = await request(app)
      .get(`/api/v1/bookings/${demoBookingId}`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(v1DemoBookingRead.statusCode).toBe(200);
    expect(v1DemoBookingRead.body.data.bookingMode).toBe('demo');
    // Internal financial status is not leaked to public DTO
    expect(v1DemoBookingRead.body.data.payoutStatus).toBeUndefined();
    const persistedHistoricalBooking = await Booking.findById(demoBookingId);
    expect(persistedHistoricalBooking.payoutStatus).toBe('not_owed');

    // 4.3 V1 exposes full catalogue: Free + Paid Plans
    const v1PlansRes = await request(app).get('/api/v1/subscriptions/plans');
    expect(v1PlansRes.statusCode).toBe(200);
    const v1Plans = v1PlansRes.body.data.plans;
    expect(v1Plans.some((p) => p.code === 'client.free')).toBe(true);
    expect(v1Plans.some((p) => p.code === 'client.pro')).toBe(true);

    // 4.4 Same user upgrades via V1 subscription engine
    const proPlan = await planRepository.findByCode('client.pro');
    await applyPlanGrant({
      userId: clientUser._id,
      role: 'client',
      plan: proPlan,
      billingCycle: 'monthly',
      periodDays: 30,
      source: 'paid',
      changeType: 'paid',
    });

    // 4.5 Verify upgraded status and entitlements on V1
    const v1SubRes = await request(app)
      .get('/api/v1/subscriptions/me')
      .set('Authorization', `Bearer ${clientToken}`);
    expect(v1SubRes.statusCode).toBe(200);
    expect(v1SubRes.body.data.subscription.planCode).toBe('client.pro');
    expect(v1SubRes.body.data.entitlements['requests.daily']).toBe(4);

    // =========================================================================
    // STEP 5: New Booking Created on V1 Enforces Online Payment Only
    // =========================================================================
    const v1RequestDoc = await Request.create({
      clientId: clientUser._id,
      stylistId: stylistUser._id,
      title: 'Official V1 Service Booking',
      date: new Date(Date.now() + 72 * 60 * 60 * 1000),
      time: '14:00',
      status: 'OPEN',
    });

    const v1OfferDoc = await Offer.create({
      requestId: v1RequestDoc._id,
      clientId: clientUser._id,
      stylistId: stylistUser._id,
      price: 1200,
      duration: 90,
      status: 'PENDING',
    });

    // 5.1 Accept offer on /api/v1
    const v1AcceptRes = await request(app)
      .patch(`/api/v1/offers/${v1OfferDoc._id}/accept`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(v1AcceptRes.statusCode).toBe(200);
    const v1BookingId = v1AcceptRes.body.data._id || v1AcceptRes.body.data.id;

    // 5.2 Verify V1 booking invariants
    const persistedV1Booking = await Booking.findById(v1BookingId);
    expect(persistedV1Booking.bookingMode).toBe('standard');
    expect(persistedV1Booking.payoutStatus).toBe('unpaid');

    // 5.3 V1 creates pending Payment record
    const v1Payment = await Payment.findOne({ bookingId: v1BookingId });
    expect(v1Payment).not.toBeNull();
    expect(v1Payment.amount).toBe(1200);
    expect(v1Payment.status).toBe('pending');

    // 5.4 V1 chat stays locked until payment succeeded
    const v1Conversation = await chatService.getConversation(v1BookingId);
    expect(v1Conversation.isOpen).toBe(false);

    // 5.5 V1 check-in is strictly blocked until payment is paid
    const v1PrematureCheckIn = await request(app)
      .patch(`/api/v1/bookings/${v1BookingId}/check-in`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({});
    expect(v1PrematureCheckIn.statusCode).toBe(400);
    expect(v1PrematureCheckIn.body.message).toContain('Payment must be completed before check-in');
  });
});
