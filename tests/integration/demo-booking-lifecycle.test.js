import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import User from '../../src/modules/users/user.model.js';
import Request from '../../src/modules/requests/request.model.js';
import Offer from '../../src/modules/offers/offer.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import Payment from '../../src/modules/payments/payment.model.js';
import Penalty from '../../src/modules/penalties/penalty.model.js';
import LedgerEntry from '../../src/modules/ledger/ledger-entry.model.js';
import bookingService from '../../src/modules/bookings/booking.service.js';
import noShowService from '../../src/modules/bookings/no-show.service.js';
import chatService from '../../src/modules/chat/chat.service.js';
import notificationService from '../../src/modules/notifications/notification.service.js';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';

describe('Demo Booking Lifecycle & Branching Integration Tests (Phase 2)', () => {
  let clientUser;
  let stylistUser;
  let adminUser;
  let clientToken;
  let stylistToken;
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

    clientUser = await User.create({
      name: 'Demo Client',
      email: 'democlient@test.dev',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'client',
      isEmailVerified: true,
      phone: '+201011112222',
      verification: { status: 'verified' },
    });

    stylistUser = await User.create({
      name: 'Demo Stylist',
      email: 'demostylist@test.dev',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'stylist',
      isEmailVerified: true,
      phone: '+201033334444',
      verification: { status: 'verified' },
    });

    adminUser = await User.create({
      name: 'Demo Admin',
      email: 'admin@test.dev',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'admin',
      isEmailVerified: true,
      phone: '+201055556666',
      verification: { status: 'verified' },
    });

    clientToken = generateAccessToken({ sub: clientUser._id.toString(), role: clientUser.role });
    stylistToken = generateAccessToken({ sub: stylistUser._id.toString(), role: stylistUser.role });

    requestDoc = await Request.create({
      clientId: clientUser._id,
      stylistId: stylistUser._id,
      title: 'Demo Session Request',
      date: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48h in future
      time: '11:00',
      status: 'OPEN',
    });

    offerDoc = await Offer.create({
      requestId: requestDoc._id,
      clientId: clientUser._id,
      stylistId: stylistUser._id,
      price: 800,
      duration: 60,
      status: 'PENDING',
    });
  });

  describe('Offer Acceptance: Demo COD vs V1 Online', () => {
    it('accepting offer via /api/demo creates demo booking with zero Payment record and immediate chat unlock', async () => {
      const res = await request(app)
        .patch(`/api/demo/offers/${offerDoc._id}/accept`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const bookingId = res.body.data._id || res.body.data.id;
      const persistedBooking = await Booking.findById(bookingId);

      expect(persistedBooking).not.toBeNull();
      expect(persistedBooking.bookingMode).toBe('demo');
      expect(persistedBooking.payoutStatus).toBe('not_owed');
      expect(persistedBooking.status).toBe('confirmed');

      // Assert zero Payment records created in database
      const payment = await Payment.findOne({ bookingId });
      expect(payment).toBeNull();

      // Assert chat conversation was unlocked immediately
      const convo = await chatService.getConversation(bookingId);
      expect(convo.isOpen).toBe(true);
    });

    it('accepting offer via /api/v1 creates standard booking with pending Payment and locked chat', async () => {
      const res = await request(app)
        .patch(`/api/v1/offers/${offerDoc._id}/accept`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const bookingId = res.body.data._id || res.body.data.id;
      const persistedBooking = await Booking.findById(bookingId);

      expect(persistedBooking.bookingMode).toBe('standard');
      expect(persistedBooking.payoutStatus).toBe('unpaid');

      // Assert pending Payment record exists
      const payment = await Payment.findOne({ bookingId });
      expect(payment).not.toBeNull();
      expect(payment.status).toBe('pending');
      expect(payment.amount).toBe(800);

      // Assert chat starts locked in V1
      const convo = await chatService.getConversation(bookingId);
      expect(convo.isOpen).toBe(false);
    });
  });

  describe('Check-In Payment Gate Bypass in Demo', () => {
    it('allows check-in for demo booking without any payment record', async () => {
      // 1. Accept offer via demo
      const acceptRes = await request(app)
        .patch(`/api/demo/offers/${offerDoc._id}/accept`)
        .set('Authorization', `Bearer ${clientToken}`);

      const bookingId = acceptRes.body.data._id || acceptRes.body.data.id;

      // 2. Perform check-in via client
      const checkInRes = await request(app)
        .patch(`/api/demo/bookings/${bookingId}/check-in`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ lat: 30.0444, lng: 31.2357 });

      expect(checkInRes.statusCode).toBe(200);
      expect(checkInRes.body.success).toBe(true);
      expect(checkInRes.body.data.status).toBe('in-progress');

      const updated = await Booking.findById(bookingId);
      expect(updated.status).toBe('in-progress');
      expect(updated.clientCheckInAt).toBeDefined();
    });

    it('blocks check-in for V1 standard booking if payment is not paid', async () => {
      // 1. Accept offer via V1
      const acceptRes = await request(app)
        .patch(`/api/v1/offers/${offerDoc._id}/accept`)
        .set('Authorization', `Bearer ${clientToken}`);

      const bookingId = acceptRes.body.data._id || acceptRes.body.data.id;

      // 2. Attempt check-in without payment
      const checkInRes = await request(app)
        .patch(`/api/v1/bookings/${bookingId}/check-in`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({});

      expect(checkInRes.statusCode).toBe(400);
      expect(checkInRes.body.message).toContain('Payment must be completed before check-in');
    });
  });

  describe('Cancellation Flow: Zero Refunds and Zero Penalties in Demo', () => {
    it('cancelling a demo booking succeeds with no payment refund and zero ledger entries', async () => {
      const acceptRes = await request(app)
        .patch(`/api/demo/offers/${offerDoc._id}/accept`)
        .set('Authorization', `Bearer ${clientToken}`);

      const bookingId = acceptRes.body.data._id || acceptRes.body.data.id;

      // Cancel as client
      const cancelRes = await request(app)
        .patch(`/api/demo/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ reason: 'Demo test cancellation' });

      expect(cancelRes.statusCode).toBe(200);
      expect(cancelRes.body.data.status).toBe('cancelled');

      // Assert zero penalties and zero ledger entries
      const penalties = await Penalty.find({ bookingId });
      expect(penalties.length).toBe(0);

      const ledgerEntries = await LedgerEntry.find({ bookingId });
      expect(ledgerEntries.length).toBe(0);
    });

    it('stylist cancelling a demo booking creates zero penalty and zero ledger entries', async () => {
      const acceptRes = await request(app)
        .patch(`/api/demo/offers/${offerDoc._id}/accept`)
        .set('Authorization', `Bearer ${clientToken}`);

      const bookingId = acceptRes.body.data._id || acceptRes.body.data.id;

      // Cancel as stylist
      const cancelRes = await request(app)
        .patch(`/api/demo/bookings/${bookingId}/cancel`)
        .set('Authorization', `Bearer ${stylistToken}`)
        .send({ reason: 'Stylist emergency' });

      expect(cancelRes.statusCode).toBe(200);
      expect(cancelRes.body.data.status).toBe('cancelled');

      // Assert zero penalties and zero ledger entries
      const penalties = await Penalty.find({ bookingId });
      expect(penalties.length).toBe(0);

      const ledgerEntries = await LedgerEntry.find({ bookingId });
      expect(ledgerEntries.length).toBe(0);
    });
  });

  describe('Dispute Resolution in Demo', () => {
    it('admin resolving demo dispute resolves cleanly without attempting gateway refund', async () => {
      const acceptRes = await request(app)
        .patch(`/api/demo/offers/${offerDoc._id}/accept`)
        .set('Authorization', `Bearer ${clientToken}`);

      const bookingId = acceptRes.body.data._id || acceptRes.body.data.id;

      // Check in to reach in-progress
      await request(app)
        .patch(`/api/demo/bookings/${bookingId}/check-in`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({});

      // File dispute
      await bookingService.fileDispute(clientUser, bookingId, {
        reason: 'Service dispute in demo',
        type: 'quality',
      });

      // Admin resolves dispute with cancelled outcome
      const resolved = await bookingService.resolveDispute(
        adminUser._id,
        bookingId,
        {
          outcome: 'cancelled',
          refundPercentage: 100,
          resolutionNotes: 'Demo cancellation resolution without payment gateway',
        }
      );

      expect(resolved.status).toBe('cancelled');
      const updated = await Booking.findById(bookingId);
      expect(updated.status).toBe('cancelled');
      expect(updated.disputeResolution.outcome).toBe('cancelled');
    });
  });

  describe('No-Show Settlement in Demo', () => {
    it('no-show settlement sets payoutStatus to not_owed and creates zero ledger entries', async () => {
      const acceptRes = await request(app)
        .patch(`/api/demo/offers/${offerDoc._id}/accept`)
        .set('Authorization', `Bearer ${clientToken}`);

      const bookingId = acceptRes.body.data._id || acceptRes.body.data.id;

      // Report client no-show as stylist
      await Booking.findByIdAndUpdate(bookingId, {
        noShowDetails: {
          reportedBy: stylistUser._id,
          reportedAt: new Date(Date.now() - 3600000),
          reportedAgainst: 'client',
        },
      });

      // Settle no-show
      const settled = await noShowService.resolveNoShow(bookingId);

      expect(settled.status).toBe('no-show-client');

      const updated = await Booking.findById(bookingId);
      expect(updated.payoutStatus).toBe('not_owed');

      // Assert zero ledger entries posted
      const ledgerEntries = await LedgerEntry.find({ bookingId });
      expect(ledgerEntries.length).toBe(0);
    });
  });

  describe('Session Completion & Notification Tailoring', () => {
    it('notifies stylist with review prompt instead of payout notification on demo session completion', async () => {
      const sendSpy = jest.spyOn(notificationService, 'send');

      const acceptRes = await request(app)
        .patch(`/api/demo/offers/${offerDoc._id}/accept`)
        .set('Authorization', `Bearer ${clientToken}`);

      const bookingId = acceptRes.body.data._id || acceptRes.body.data.id;

      // Both check in
      await request(app)
        .patch(`/api/demo/bookings/${bookingId}/check-in`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({});

      await request(app)
        .patch(`/api/demo/bookings/${bookingId}/check-in`)
        .set('Authorization', `Bearer ${stylistToken}`)
        .send({});

      // Both confirm completion
      await bookingService.confirmCompletion(clientUser, bookingId);
      await bookingService.confirmCompletion(stylistUser, bookingId);

      // Wait a tick for event bus handlers
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stylistCall = sendSpy.mock.calls.find(
        ([userId, payload]) =>
          userId.toString() === stylistUser._id.toString() && payload.title === 'Session Completed'
      );

      expect(stylistCall).toBeDefined();
      expect(stylistCall[1].type).toBe('review');
      expect(stylistCall[1].body).toContain('leave a review');
      expect(stylistCall[1].body).not.toContain('eligible for payout');

      sendSpy.mockRestore();
    });
  });
});
