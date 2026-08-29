import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../src/app.js';
import User from '../../src/modules/users/user.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import Payment from '../../src/modules/payments/payment.model.js';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';
import { ROLES } from '../../src/common/constants/roles.constant.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';

describe('Admin Dashboard Statistics Integration Tests', () => {
  let adminToken;
  let operatorToken;
  let clientToken;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    // Create Admin
    const adminUser = await User.create({
      name: 'Super Admin',
      email: 'admin@murafiq.com',
      passwordHash: 'hashedpassword',
      role: ROLES.ADMIN,
      isEmailVerified: true,
    });
    adminToken = generateAccessToken({ sub: adminUser._id.toString(), role: ROLES.ADMIN });

    // Create Operator
    const operatorUser = await User.create({
      name: 'Operator User',
      email: 'operator@murafiq.com',
      passwordHash: 'hashedpassword',
      role: ROLES.OPERATOR,
      isEmailVerified: true,
    });
    operatorToken = generateAccessToken({ sub: operatorUser._id.toString(), role: ROLES.OPERATOR });

    // Create Client
    const clientUser = await User.create({
      name: 'Client User',
      email: 'client@murafiq.com',
      passwordHash: 'hashedpassword',
      role: ROLES.CLIENT,
      isEmailVerified: true,
      verification: { status: 'pending' },
    });
    clientToken = generateAccessToken({ sub: clientUser._id.toString(), role: ROLES.CLIENT });

    // Create Stylist
    const stylistUser = await User.create({
      name: 'Stylist User',
      email: 'stylist@murafiq.com',
      passwordHash: 'hashedpassword',
      role: ROLES.STYLIST,
      isEmailVerified: true,
    });

    // Create Bookings
    const booking1 = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: clientUser._id,
      stylistId: stylistUser._id,
      scheduledDate: new Date(),
      scheduledStartMinute: 600,
      scheduledEndMinute: 720,
      price: 1000,
      duration: 120,
      status: 'confirmed',
    });

    const booking2 = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: clientUser._id,
      stylistId: stylistUser._id,
      scheduledDate: new Date(),
      scheduledStartMinute: 800,
      scheduledEndMinute: 920,
      price: 2000,
      duration: 120,
      status: 'completed',
    });

    const booking3 = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: clientUser._id,
      stylistId: stylistUser._id,
      scheduledDate: new Date(),
      scheduledStartMinute: 1000,
      scheduledEndMinute: 1120,
      price: 1500,
      duration: 120,
      status: 'disputed',
    });

    // Create Payments for current month
    // Payment 1: Full paid (1000 EGP: 150 fee, 850 payout)
    await Payment.create({
      bookingId: booking1._id,
      clientId: clientUser._id,
      amount: 1000,
      currency: 'EGP',
      platformFeePercentage: 15,
      platformFeeAmount: 150,
      stylistPayoutAmount: 850,
      status: 'paid',
      createdAt: new Date(),
    });

    // Payment 2: Partially refunded (2000 EGP total, 500 refunded, 1500 retained -> fee 225, payout 1275)
    await Payment.create({
      bookingId: booking2._id,
      clientId: clientUser._id,
      amount: 2000,
      currency: 'EGP',
      platformFeePercentage: 15,
      platformFeeAmount: 225,
      stylistPayoutAmount: 1275,
      refundAmount: 500,
      status: 'partially_refunded',
      createdAt: new Date(),
    });

    // Payment 3: Fully refunded (1500 EGP total, 1500 refunded -> status refunded)
    await Payment.create({
      bookingId: booking3._id,
      clientId: clientUser._id,
      amount: 1500,
      currency: 'EGP',
      platformFeePercentage: 15,
      platformFeeAmount: 0,
      stylistPayoutAmount: 0,
      refundAmount: 1500,
      status: 'refunded',
      createdAt: new Date(),
    });
  });

  it('allows Admin to retrieve dashboard statistics with accurate counts and revenue', async () => {
    const res = await request(app)
      .get('/api/v1/admin/dashboard/stats')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Dashboard statistics retrieved successfully');

    const data = res.body.data;
    expect(data.users).toBeDefined();
    expect(data.users.total).toBe(4);
    expect(data.users.byRole.clients).toBe(1);
    expect(data.users.byRole.stylists).toBe(1);
    expect(data.users.byRole.operators).toBe(1);
    expect(data.users.byRole.admins).toBe(1);
    expect(data.users.pendingVerifications).toBe(1);

    expect(data.bookings).toBeDefined();
    expect(data.bookings.total).toBe(3);
    expect(data.bookings.active).toBe(1); // confirmed (1) + inProgress (0)
    expect(data.bookings.byStatus.confirmed).toBe(1);
    expect(data.bookings.byStatus.completed).toBe(1);
    expect(data.bookings.byStatus.disputed).toBe(1);
    expect(data.bookings.openDisputes).toBe(1);

    expect(data.revenueThisMonth).toBeDefined();
    // Gross: (1000 - 0) + (2000 - 500) = 2500
    expect(data.revenueThisMonth.grossVolume).toBe(2500);
    // Platform commission: 150 + 225 = 375
    expect(data.revenueThisMonth.platformCommission).toBe(375);
    // Stylist payouts: 850 + 1275 = 2125
    expect(data.revenueThisMonth.stylistPayouts).toBe(2125);
    expect(data.revenueThisMonth.transactionCount).toBe(2);
  });

  it('forbids Operator and Client from accessing GET /admin/dashboard/stats', async () => {
    const operatorRes = await request(app)
      .get('/api/v1/admin/dashboard/stats')
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(operatorRes.status).toBe(403);

    const clientRes = await request(app)
      .get('/api/v1/admin/dashboard/stats')
      .set('Authorization', `Bearer ${clientToken}`);
    expect(clientRes.status).toBe(403);
  });
});
