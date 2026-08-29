import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';

const clientId = '60f719b8f1a2c81234567891';
const stylistId = '60f719b8f1a2c81234567890';
const bookingId = '60f719b8f1a2c81234567888';
const paymentId = '60f719b8f1a2c81234567877';

const mockPayment = {
  _id: paymentId,
  bookingId: { _id: bookingId, toString: () => bookingId },
  clientId: { _id: clientId, toString: () => clientId },
  currency: 'EGP',
  amount: 1000.0,
  platformFeePercentage: 15,
  platformFeeAmount: 150.0,
  stylistPayoutAmount: 850.0,
  status: 'OPEN',
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
  payoutStatus: 'unpaid',
  toObject: function () {
    return this;
  },
};

const mockPostEntry = jest.fn().mockResolvedValue({});
const mockFindBookingById = jest.fn().mockResolvedValue(mockBooking);
const mockFindPaymentByBookingId = jest.fn().mockResolvedValue(mockPayment);
const mockFindPaymentById = jest.fn().mockResolvedValue(mockPayment);
const mockFindPaymentByTxId = jest.fn().mockResolvedValue(mockPayment);
const mockUpdatePaymentById = jest.fn().mockImplementation((id, data) => Promise.resolve({ ...mockPayment, ...data }));

jest.unstable_mockModule('../../src/modules/ledger/ledger.service.js', () => ({
  default: {
    postEntry: mockPostEntry,
    postDoubleEntry: jest.fn().mockResolvedValue([{}, {}]),
    egpToPiastres: (egp) => Math.round(egp * 100),
    piastresToEgp: (piastres) => piastres / 100,
    getBookingStatement: jest.fn().mockResolvedValue([]),
    getUserStatement: jest.fn().mockResolvedValue([]),
  },
  postEntry: mockPostEntry,
  postDoubleEntry: jest.fn().mockResolvedValue([{}, {}]),
  egpToPiastres: (egp) => Math.round(egp * 100),
  piastresToEgp: (piastres) => piastres / 100,
  getBookingStatement: jest.fn().mockResolvedValue([]),
  getUserStatement: jest.fn().mockResolvedValue([]),
}));

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: {
    findById: jest.fn().mockResolvedValue({
      _id: clientId,
      name: 'Test Client',
      email: 'client@example.com',
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
    create: jest.fn().mockResolvedValue(mockPayment),
  },
}));

const { default: app } = await import('../../src/app.js');
const paymentService = (await import('../../src/modules/payments/payment.service.js')).default;

describe('Stage R2 Integration — Ledger Dual-Write Journaling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should post balanced Client DEBIT and Escrow CREDIT ledger entries on successful payment webhook', async () => {
    const res = await request(app)
      .post('/api/v1/payments/callback')
      .send({
        transactionId: 'mock_tx_ledger_123',
        status: 'paid',
        bookingId,
        success: true,
        secret: 'dev_mock_webhook_secret',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(mockPostEntry).toHaveBeenCalledTimes(2);

    expect(mockPostEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        entryType: 'PAYMENT',
        accountType: 'CLIENT',
        direction: 'DEBIT',
        amountMinor: 100000,
        idempotencyKey: `payment:paid:client:${paymentId}`,
      })
    );

    expect(mockPostEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        entryType: 'ESCROW_HOLD',
        accountType: 'ESCROW',
        direction: 'CREDIT',
        amountMinor: 100000,
        idempotencyKey: `payment:paid:escrow:${paymentId}`,
      })
    );
  });

  it('should post balanced Escrow DEBIT and Client CREDIT ledger entries on refund', async () => {
    const paidPayment = {
      ...mockPayment,
      status: 'paid',
      amount: 1000.0,
      providerTransactionId: 'mock_tx_ledger_123',
    };
    mockFindPaymentByBookingId.mockResolvedValueOnce(paidPayment);

    const result = await paymentService.processRefund({
      bookingId,
      refundPercentage: 100,
      reason: 'Client cancelled ahead of time',
    });

    expect(result).toBeDefined();
    expect(mockPostEntry).toHaveBeenCalledTimes(2);

    expect(mockPostEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        entryType: 'ESCROW_RELEASE',
        accountType: 'ESCROW',
        direction: 'DEBIT',
        amountMinor: 100000,
      })
    );

    expect(mockPostEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        entryType: 'REFUND',
        accountType: 'CLIENT',
        direction: 'CREDIT',
        amountMinor: 100000,
      })
    );
  });
});
