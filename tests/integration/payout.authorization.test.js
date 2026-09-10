import request from 'supertest';
import app from '../../src/app.js';
import User from '../../src/modules/users/user.model.js';
import StylistProfile from '../../src/modules/stylists/stylist-profile.model.js';
import Payout from '../../src/modules/payouts/payout.model.js';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';
import { ROLES } from '../../src/common/constants/roles.constant.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';

// Regression suite for the pre-Phase-15 audit findings C-1 and C-2:
//   C-1: payout.controller.js used req.user._id (always undefined, since
//        auth.middleware sets req.user = { id, role }), which Mongoose collapses
//        into an unscoped filter — an attacker could overwrite ANY stylist's
//        payout bank account via PATCH /payouts/account.
//   C-2: findStylistPayouts routed stylistId through QueryBuilder's filter
//        allowlist, which silently dropped it and returned every stylist's
//        payouts (including bank account numbers) from GET /payouts/mine.
describe('Payouts — object-level authorization (IDOR)', () => {
  let stylistA, stylistB, tokenA, tokenB, adminToken;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    stylistA = await User.create({
      name: 'Stylist A',
      email: 'stylist-a@murafiq.com',
      phone: '+201000000010',
      passwordHash: 'hashedpassword',
      role: ROLES.STYLIST,
      isEmailVerified: true,
    });
    stylistB = await User.create({
      name: 'Stylist B',
      email: 'stylist-b@murafiq.com',
      phone: '+201000000011',
      passwordHash: 'hashedpassword',
      role: ROLES.STYLIST,
      isEmailVerified: true,
    });
    const adminUser = await User.create({
      name: 'Admin',
      email: 'admin@murafiq.com',
      passwordHash: 'hashedpassword',
      role: ROLES.ADMIN,
      isEmailVerified: true,
    });

    tokenA = generateAccessToken({ sub: stylistA._id.toString(), role: ROLES.STYLIST });
    tokenB = generateAccessToken({ sub: stylistB._id.toString(), role: ROLES.STYLIST });
    adminToken = generateAccessToken({ sub: adminUser._id.toString(), role: ROLES.ADMIN });

    await StylistProfile.create({
      userId: stylistA._id,
      specialty: 'stylist',
      hourlyPrice: 200,
      payoutAccount: {
        method: 'bank_transfer',
        accountHolderName: 'Stylist A Real Name',
        bankName: 'Bank Of A',
        accountNumber: 'AAAA-1111-VICTIM',
      },
    });
    await StylistProfile.create({
      userId: stylistB._id,
      specialty: 'stylist',
      hourlyPrice: 150,
      payoutAccount: {
        method: 'vodafone_cash',
        walletPhone: '01099999999',
      },
    });

    await Payout.create({
      stylistId: stylistA._id,
      bookingIds: [],
      amount: 850,
      grossAmount: 1000,
      method: 'bank_transfer',
      status: 'pending',
      payoutAccountDetails: {
        accountHolderName: 'Stylist A Real Name',
        bankName: 'Bank Of A',
        accountNumber: 'AAAA-1111-VICTIM',
      },
    });
  });

  describe('GET /api/v1/payouts/mine (C-2)', () => {
    it("does not return another stylist's payouts", async () => {
      const res = await request(app)
        .get('/api/v1/payouts/mine')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      // Stylist B has zero payouts of their own; the only Payout in the DB
      // belongs to stylist A and must never appear here.
      expect(res.body.data.length).toBe(0);
      expect(
        res.body.data.some((p) => p.payoutAccountDetails?.accountNumber === 'AAAA-1111-VICTIM')
      ).toBe(false);
    });

    it("returns the caller's own payouts, scoped correctly", async () => {
      const res = await request(app)
        .get('/api/v1/payouts/mine')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(String(res.body.data[0].stylistId)).toBe(String(stylistA._id));
      expect(res.body.meta.total).toBe(1);
    });
  });

  describe('PATCH /api/v1/payouts/account (C-1)', () => {
    it("updating stylist B's account never mutates stylist A's profile", async () => {
      const res = await request(app)
        .patch('/api/v1/payouts/account')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          method: 'instapay',
          accountHolderName: 'Attacker Controlled Name',
          accountNumber: 'ATTACKER-ACCOUNT',
        });

      expect(res.status).toBe(200);

      const profileA = await StylistProfile.findOne({ userId: stylistA._id });
      expect(profileA.payoutAccount.accountNumber).toBe('AAAA-1111-VICTIM');
      expect(profileA.payoutAccount.accountHolderName).toBe('Stylist A Real Name');

      const profileB = await StylistProfile.findOne({ userId: stylistB._id });
      expect(profileB.payoutAccount.accountNumber).toBe('ATTACKER-ACCOUNT');
    });
  });

  describe('GET /api/v1/payouts/account (C-1)', () => {
    it("returns the caller's own account, not another stylist's", async () => {
      const res = await request(app)
        .get('/api/v1/payouts/account')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      expect(res.body.data.walletPhone).toBe('01099999999');
      expect(res.body.data.accountNumber).not.toBe('AAAA-1111-VICTIM');
    });
  });

  describe('Admin routes remain unaffected by the stylist-scoping fix', () => {
    it('GET /admin returns all payouts across stylists', async () => {
      const res = await request(app)
        .get('/api/v1/payouts/admin')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
    });

    it('a stylist cannot access the admin batch endpoint', async () => {
      const res = await request(app)
        .post('/api/v1/payouts/admin/batch')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ stylistIds: [stylistA._id.toString()] });

      expect(res.status).toBe(403);
    });
  });
});
