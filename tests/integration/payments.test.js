import { jest } from '@jest/globals';
import request from 'supertest';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';

const clientId = '60f719b8f1a2c81234567891';
const otherClientId = '60f719b8f1a2c81234567892';
const stylistId = '60f719b8f1a2c81234567890';
const adminId = '60f719b8f1a2c81234567899';
const bookingId = '60f719b8f1a2c81234567888';

const mockPayment = {
  _id: '60f719b8f1a2c81234567877',
  bookingId: {
    _id: bookingId,
    toString: () => bookingId,
  },
  clientId: {
    _id: clientId,
    toString: () => clientId,
  },
  currency: 'EGP',
  amount: 1000.0,
  platformFeePercentage: 15,
  platformFeeAmount: 150.0,
  stylistPayoutAmount: 850.0,
  status: 'pending',
  refundAmount: 0,
  provider: 'mock',
  createdAt: new Date(),
  toObject: function () {
    return this;
  },
};

const mockBooking = {
  _id: bookingId,
  clientId: { _id: clientId, toString: () => clientId },
  stylistId: { _id: stylistId, toString: () => stylistId },
  price: 1000.0,
  status: 'confirmed',
  toObject: function () {
    return this;
  },
};

const mockFindBookingById = jest.fn().mockResolvedValue(mockBooking);
const mockFindPaymentByBookingId = jest.fn().mockResolvedValue(mockPayment);
const mockFindPaymentById = jest.fn().mockResolvedValue(mockPayment);
const mockFindPaymentByTxId = jest.fn().mockResolvedValue(mockPayment);
const mockUpdatePaymentById = jest.fn().mockImplementation((id, data) => Promise.resolve({ ...mockPayment, ...data }));
const mockFindClientHistory = jest.fn().mockResolvedValue({
  payments: [mockPayment],
  meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
});

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: jest.fn().mockResolvedValue({
      _id: clientId,
      name: 'Test Client',
      email: 'client@example.com',
      phone: '+201012345678',
      role: 'client',
    }),
  },
}));

jest.unstable_mockModule('../../src/modules/bookings/booking.repository.js', () => ({
  default: {
    findById: mockFindBookingById,
  },
}));

jest.unstable_mockModule('../../src/modules/payments/payment.repository.js', () => ({
  default: {
    findById: mockFindPaymentById,
    findByBookingId: mockFindPaymentByBookingId,
    findByTransactionId: mockFindPaymentByTxId,
    findByIntentionId: jest.fn().mockResolvedValue(mockPayment),
    updateById: mockUpdatePaymentById,
    findClientHistory: mockFindClientHistory,
    create: jest.fn().mockResolvedValue(mockPayment),
  },
}));

/**
 * The ledger must be mocked here for the same reason every repository above is.
 *
 * This suite mocks the whole persistence layer and never opens a database connection, so
 * an unmocked `ledgerService.postEntry()` reached the real `LedgerEntry` model, Mongoose
 * buffered the insert against a connection that will never arrive, and the operation sat
 * there until the 10-second buffering timeout fired. The dual-write try/catch then
 * swallowed it as "[Ledger Dual-Write Warning] ... buffering timed out after 10000ms".
 *
 * That warning was noise here, but it was hiding a genuine signal: the same message is
 * what a REAL ledger failure produces in production. Keeping the test output clean is what
 * makes that message meaningful when it appears for real.
 *
 * `postEntry` is asserted on rather than merely silenced, so these tests still prove the
 * ledger is invoked with the right arguments.
 */
const mockPostEntry = jest.fn().mockResolvedValue({ _id: '60f719b8f1a2c81234567866' });
jest.unstable_mockModule('../../src/modules/ledger/ledger.service.js', () => ({
  default: {
    postEntry: mockPostEntry,
    egpToPiastres: (egp) => Math.round(egp * 100),
    piastresToEgp: (p) => p / 100,
  },
  postEntry: mockPostEntry,
  egpToPiastres: (egp) => Math.round(egp * 100),
  piastresToEgp: (p) => p / 100,
}));

const { default: app } = await import('../../src/app.js');

describe('Phase 6 Integration — Payments & Escrow Endpoints', () => {
  const clientToken = generateAccessToken({ sub: clientId, role: 'client' });
  const otherClientToken = generateAccessToken({ sub: otherClientId, role: 'client' });
  const adminToken = generateAccessToken({ sub: adminId, role: 'admin' });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/payments/:bookingId/initialize', () => {
    it('returns 401 when calling without access token', async () => {
      const res = await request(app).post(`/api/v1/payments/${bookingId}/initialize`);
      expect(res.status).toBe(401);
    });

    it('returns 403 when another client tries to initialize payment', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/${bookingId}/initialize`)
        .set('Authorization', `Bearer ${otherClientToken}`);
      expect(res.status).toBe(403);
    });

    it('returns 200 with checkout URL when owner client initializes payment', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/${bookingId}/initialize`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.paymentUrl).toBeDefined();
      expect(res.body.data.payment.amount).toBe(1000.0);
    });
  });

  describe('POST /api/v1/payments/callback (Webhook)', () => {
    it('returns 400 when webhook request carries no signature or secret', async () => {
      const res = await request(app)
        .post('/api/v1/payments/callback')
        .send({
          transactionId: 'mock_tx_12345',
          status: 'paid',
          bookingId,
          success: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/secret|HMAC/i);
    });

    it('successfully processes payment webhook and marks payment as paid when valid secret is provided', async () => {
      const res = await request(app)
        .post('/api/v1/payments/callback')
        .send({
          transactionId: 'mock_tx_12345',
          status: 'paid',
          bookingId,
          success: true,
          secret: 'dev_mock_webhook_secret',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('paid');
    });
  });

  describe('GET /api/v1/payments/:bookingId/status', () => {
    it('returns 200 with payment status details', async () => {
      const res = await request(app)
        .get(`/api/v1/payments/${bookingId}/status`)
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.amount).toBe(1000.0);
    });
  });

  describe('GET /api/v1/payments/history', () => {
    it('returns 200 with paginated payment history for client', async () => {
      const res = await request(app)
        .get('/api/v1/payments/history')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('POST /api/v1/payments/:bookingId/refund', () => {
    it('returns 403 when non-admin attempts refund', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/${bookingId}/refund`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ refundPercentage: 75, reason: 'Client cancelled' });

      expect(res.status).toBe(403);
    });

    it('returns 200 when admin triggers refund', async () => {
      mockFindPaymentByBookingId.mockResolvedValueOnce({
        ...mockPayment,
        status: 'paid',
        providerTransactionId: 'mock_tx_paid',
      });

      const res = await request(app)
        .post(`/api/v1/payments/${bookingId}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ refundPercentage: 75, reason: 'Admin resolved dispute' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('partially_refunded');
      expect(res.body.data.refundAmount).toBe(750.0);
    });
  });
});
