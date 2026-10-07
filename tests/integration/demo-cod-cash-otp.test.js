import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import User from '../../src/modules/users/user.model.js';
import Request from '../../src/modules/requests/request.model.js';
import Offer from '../../src/modules/offers/offer.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import notificationService from '../../src/modules/notifications/notification.service.js';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';
import getBusinessDayRange from '../../src/common/utils/businessDay.util.js';

const makeBookingActiveNow = async (bookingId) => {
  const now = new Date();
  const { startOfDay } = getBusinessDayRange(now, 'Africa/Cairo');
  const nowMinutes = Math.floor((now.getTime() - startOfDay.getTime()) / (60 * 1000));
  await Booking.findByIdAndUpdate(bookingId, {
    scheduledDate: now,
    scheduledStartMinute: Math.max(0, nowMinutes - 10),
    scheduledEndMinute: nowMinutes + 60,
  });
};

describe('Demo COD 4-Digit Cash OTP Integration Tests', () => {
  let clientUser;
  let stylistUser;
  let clientToken;
  let stylistToken;
  let requestDoc;
  let offerDoc;
  let bookingId;

  beforeAll(async () => {
    await connectTestDB();
  }, 300000);

  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  beforeEach(async () => {
    await clearTestDB();

    clientUser = await User.create({
      name: 'Test Client',
      email: 'client@cod.test',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'client',
      isEmailVerified: true,
      phone: '+201011119999',
      verification: { status: 'verified' },
    });

    stylistUser = await User.create({
      name: 'Test Stylist',
      email: 'stylist@cod.test',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'stylist',
      isEmailVerified: true,
      phone: '+201022228888',
      verification: { status: 'verified' },
    });

    clientToken = generateAccessToken({ sub: clientUser._id.toString(), role: clientUser.role });
    stylistToken = generateAccessToken({ sub: stylistUser._id.toString(), role: stylistUser.role });

    requestDoc = await Request.create({
      clientId: clientUser._id,
      stylistId: stylistUser._id,
      title: 'COD Demo Session',
      date: new Date(),
      time: '12:00',
      status: 'OPEN',
    });

    offerDoc = await Offer.create({
      requestId: requestDoc._id,
      clientId: clientUser._id,
      stylistId: stylistUser._id,
      price: 500,
      duration: 60,
      status: 'PENDING',
    });

    // Accept offer in demo mode
    const acceptRes = await request(app)
      .patch(`/api/demo/offers/${offerDoc._id}/accept`)
      .set('Authorization', `Bearer ${clientToken}`);

    bookingId = acceptRes.body.data._id || acceptRes.body.data.id;
    await makeBookingActiveNow(bookingId);
  });

  it('1. Generates 4-digit cash OTP on check-in: visible to stylist, hidden from client', async () => {
    // Client checks in
    const clientCheckIn = await request(app)
      .patch(`/api/demo/bookings/${bookingId}/check-in`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({});
    expect(clientCheckIn.statusCode).toBe(200);
    expect(clientCheckIn.body.data.cashOtp).toBeUndefined(); // Client MUST NOT see OTP

    // Stylist checks in
    const stylistCheckIn = await request(app)
      .patch(`/api/demo/bookings/${bookingId}/check-in`)
      .set('Authorization', `Bearer ${stylistToken}`)
      .send({});
    expect(stylistCheckIn.statusCode).toBe(200);
    expect(stylistCheckIn.body.data.cashOtp).toBeDefined();
    expect(stylistCheckIn.body.data.cashOtp).toMatch(/^\d{4}$/); // Exactly 4 digits

    // Stylist GET /bookings/:id sees cashOtp
    const stylistGet = await request(app)
      .get(`/api/demo/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${stylistToken}`);
    expect(stylistGet.statusCode).toBe(200);
    expect(stylistGet.body.data.cashOtp).toBe(stylistCheckIn.body.data.cashOtp);

    // Client GET /bookings/:id does NOT see cashOtp
    const clientGet = await request(app)
      .get(`/api/demo/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(clientGet.statusCode).toBe(200);
    expect(clientGet.body.data.cashOtp).toBeUndefined();
  });

  it('2. Rejects incorrect Cash OTP with 400', async () => {
    // Stylist checks in to generate OTP
    await request(app)
      .patch(`/api/demo/bookings/${bookingId}/check-in`)
      .set('Authorization', `Bearer ${stylistToken}`)
      .send({});

    const wrongOtpRes = await request(app)
      .post(`/api/demo/bookings/${bookingId}/verify-cash-otp`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ otp: '0000' }); // Wrong OTP

    expect(wrongOtpRes.statusCode).toBe(400);
    expect(wrongOtpRes.body.message).toContain('Invalid Cash OTP');
  });

  it('3. Rejects stylist attempting to verify Cash OTP with 403', async () => {
    const stylistRes = await request(app)
      .patch(`/api/demo/bookings/${bookingId}/check-in`)
      .set('Authorization', `Bearer ${stylistToken}`)
      .send({});
    const otp = stylistRes.body.data.cashOtp;

    // Stylist calls verify-cash-otp (blocked by route or service guard)
    const stylistVerifyRes = await request(app)
      .post(`/api/demo/bookings/${bookingId}/verify-cash-otp`)
      .set('Authorization', `Bearer ${stylistToken}`)
      .send({ otp });

    expect(stylistVerifyRes.statusCode).toBe(403);
  });

  it('4. Blocks session completion before Cash OTP is verified with 400', async () => {
    // Both check in
    await request(app)
      .patch(`/api/demo/bookings/${bookingId}/check-in`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({});
    await request(app)
      .patch(`/api/demo/bookings/${bookingId}/check-in`)
      .set('Authorization', `Bearer ${stylistToken}`)
      .send({});

    // Client attempts to confirm completion
    const completeRes = await request(app)
      .patch(`/api/demo/bookings/${bookingId}/confirm-completion`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({});

    expect(completeRes.statusCode).toBe(400);
    expect(completeRes.body.message).toContain('Cash payment must be verified before completing');
  });

  it('5. Successfully verifies valid Cash OTP, notifies stylist, and unlocks session completion', async () => {
    const sendSpy = jest.spyOn(notificationService, 'send').mockImplementation(async () => {});

    // Both check in
    await request(app)
      .patch(`/api/demo/bookings/${bookingId}/check-in`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({});
    const stylistCheckIn = await request(app)
      .patch(`/api/demo/bookings/${bookingId}/check-in`)
      .set('Authorization', `Bearer ${stylistToken}`)
      .send({});

    const otp = stylistCheckIn.body.data.cashOtp;
    expect(otp).toBeDefined();

    // Client verifies correct OTP
    const verifyRes = await request(app)
      .post(`/api/demo/bookings/${bookingId}/verify-cash-otp`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ otp });

    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.body.success).toBe(true);
    expect(verifyRes.body.data.cashCollectedAt).toBeDefined();

    // Verify notification was sent to stylist
    await new Promise((r) => setTimeout(r, 200));
    const notifyCall = sendSpy.mock.calls.find(
      ([userId, payload]) =>
        userId.toString() === stylistUser._id.toString() && payload.title === 'Cash Payment Verified'
    );
    expect(notifyCall).toBeDefined();
    expect(notifyCall[1].body).toContain('500 EGP');

    // Trying to verify again fails
    const duplicateRes = await request(app)
      .post(`/api/demo/bookings/${bookingId}/verify-cash-otp`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ otp });
    expect(duplicateRes.statusCode).toBe(400);
    expect(duplicateRes.body.message).toContain('already been verified');

    // Now both can complete the session successfully
    const clientComplete = await request(app)
      .patch(`/api/demo/bookings/${bookingId}/confirm-completion`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({});
    expect(clientComplete.statusCode).toBe(200);

    const stylistComplete = await request(app)
      .patch(`/api/demo/bookings/${bookingId}/confirm-completion`)
      .set('Authorization', `Bearer ${stylistToken}`)
      .send({});
    expect(stylistComplete.statusCode).toBe(200);
    expect(stylistComplete.body.data.status).toBe('completed');

    sendSpy.mockRestore();
  });
});
