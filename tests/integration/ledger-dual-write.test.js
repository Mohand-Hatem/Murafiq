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
const mockPostDoubleEntry = jest.fn(async (debit, credit) => [
  await mockPostEntry({ ...debit, direction: 'DEBIT' }),
  await mockPostEntry({ ...credit, direction: 'CREDIT' }),
]);
const mockFindBookingById = jest.fn().mockResolvedValue(mockBooking);
const mockFindPaymentByBookingId = jest.fn().mockResolvedValue(mockPayment);
const mockFindPaymentById = jest.fn().mockResolvedValue(mockPayment);
const mockFindPaymentByTxId = jest.fn().mockResolvedValue(mockPayment);
const mockUpdatePaymentById = jest.fn().mockImplementation((id, data) => Promise.resolve({ ...mockPayment, ...data }));
// CAS mock for payment.repository.transitionStatus — see docs/AUDIT_2026_09_FULL_SYSTEM.md
// findings X17/X18/X19. Accumulates across calls since processRefund() now calls this
// twice per invocation (claim into REFUNDING, then resolve to the terminal status).
let lastTransitionResult = null;
const mockTransitionStatus = jest.fn().mockImplementation((id, _fromStatus, data) => {
  lastTransitionResult = { ...(lastTransitionResult || mockPayment), ...data };
  return Promise.resolve(lastTransitionResult);
});

jest.unstable_mockModule('../../src/common/transaction.util.js', () => ({
  default: async (fn) => fn({}),
  withTransaction: async (fn) => fn({}),
}));

jest.unstable_mockModule('../../src/modules/ledger/ledger.service.js', () => ({
  default: {
    postEntry: mockPostEntry,
    postDoubleEntry: mockPostDoubleEntry,
    egpToPiastres: (egp) => Math.round(egp * 100),
    piastresToEgp: (piastres) => piastres / 100,
    getBookingStatement: jest.fn().mockResolvedValue([]),
    getUserStatement: jest.fn().mockResolvedValue([]),
  },
  postEntry: mockPostEntry,
  postDoubleEntry: mockPostDoubleEntry,
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
    transitionStatus: mockTransitionStatus,
    create: jest.fn().mockResolvedValue(mockPayment),
  },
}));

const { default: app } = await import('../../src/app.js');
const paymentService = (await import('../../src/modules/payments/payment.service.js')).default;

describe('Stage R2 Integration — Ledger Dual-Write Journaling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastTransitionResult = null;
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

  // Regression test for docs/AUDIT_2026_09_FULL_SYSTEM.md finding X20: a cancelled
  // booking's retained platform fee (3%/20% depending on timing) used to sit in ESCROW
  // forever with no ledger entry ever recognising it as PLATFORM revenue -- cancelled
  // bookings never reach PAYOUT_ELIGIBILITY, which was the only other place that
  // recognition happened, so this money was correctly accounted for (debits still equal
  // credits) but never shows up as revenue anywhere.
  it('recognises the retained amount as PLATFORM revenue on a partial refund', async () => {
    const paidPayment = {
      ...mockPayment,
      status: 'paid',
      amount: 1000.0,
      providerTransactionId: 'mock_tx_ledger_456',
    };
    mockFindPaymentByBookingId.mockResolvedValueOnce(paidPayment);

    // 80% refund (late client cancellation) — 20% (200 EGP) is retained by the platform,
    // with no stylistPayoutOverrideAmount, so all of it is platformFeeAmount.
    await paymentService.processRefund({
      bookingId,
      refundPercentage: 80,
      reason: 'Late client cancellation',
    });

    expect(mockPostEntry).toHaveBeenCalledTimes(4);

    expect(mockPostEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        entryType: 'PLATFORM_FEE',
        accountType: 'ESCROW',
        direction: 'DEBIT',
        amountMinor: 20000, // 200 EGP retained
      })
    );

    expect(mockPostEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        entryType: 'PLATFORM_FEE',
        accountType: 'PLATFORM',
        direction: 'CREDIT',
        amountMinor: 20000,
      })
    );
  });

  it('does NOT post a platform-fee entry when nothing is retained (a full refund)', async () => {
    const paidPayment = {
      ...mockPayment,
      status: 'paid',
      amount: 1000.0,
      providerTransactionId: 'mock_tx_ledger_789',
    };
    mockFindPaymentByBookingId.mockResolvedValueOnce(paidPayment);

    await paymentService.processRefund({ bookingId, refundPercentage: 100, reason: 'Stylist cancelled' });

    // Only the two ESCROW_RELEASE / REFUND entries — no PLATFORM_FEE pair, since
    // platformFeeAmount is 0 when 100% is refunded and nothing is retained.
    expect(mockPostEntry).toHaveBeenCalledTimes(2);
    expect(mockPostEntry).not.toHaveBeenCalledWith(
      expect.objectContaining({ entryType: 'PLATFORM_FEE' })
    );
  });
});
