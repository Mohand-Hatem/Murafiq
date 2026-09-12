import '../../src/common/globals.js';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

const fakeSession = {
  withTransaction: jest.fn(async (cb) => cb()),
  endSession: jest.fn(async () => {}),
};

const mockFindByBookingId = jest.fn();
const mockFindByTransactionId = jest.fn();
const mockFindById = jest.fn();
const mockBookingFindById = jest.fn();
const mockUserFindById = jest.fn();
let lastTransitionResult = null;
const mockTransitionStatus = jest.fn().mockImplementation((id, _fromStatus, data) => {
  lastTransitionResult = { _id: id, ...(lastTransitionResult || {}), ...data };
  return Promise.resolve(lastTransitionResult);
});
const mockUpdateById = jest.fn().mockImplementation((id, data) =>
  Promise.resolve({ ...(lastTransitionResult || {}), ...data })
);
const mockProviderRefund = jest.fn();
const mockProviderHandleCallback = jest.fn();
// getProvider() must return the SAME object reference on every call, matching the real
// factory's contract that callers can rely on the provider instance's methods -- a naive
// `() => ({...})` mock would hand payment.service.js a fresh, unconfigured object every
// time it calls getProvider() internally, silently ignoring whatever the test configured.
const mockProviderInstance = { refund: mockProviderRefund, handleCallback: mockProviderHandleCallback };
const mockPostEntry = jest.fn().mockResolvedValue({});

jest.unstable_mockModule('../../src/modules/payments/payment.repository.js', () => ({
  default: {
    findByBookingId: mockFindByBookingId,
    findByTransactionId: mockFindByTransactionId,
    findById: mockFindById,
    transitionStatus: mockTransitionStatus,
    updateById: mockUpdateById,
  },
  findByBookingId: mockFindByBookingId,
  findByTransactionId: mockFindByTransactionId,
  findById: mockFindById,
  transitionStatus: mockTransitionStatus,
  updateById: mockUpdateById,
}));

jest.unstable_mockModule('../../src/modules/bookings/booking.repository.js', () => ({
  default: { findById: mockBookingFindById },
  findById: mockBookingFindById,
}));

jest.unstable_mockModule('../../src/modules/users/user.repository.js', () => ({
  default: { findById: mockUserFindById },
  findById: mockUserFindById,
}));

jest.unstable_mockModule('../../src/modules/payments/providers/provider.factory.js', () => ({
  getProvider: () => mockProviderInstance,
  default: { getProvider: () => mockProviderInstance },
}));

jest.unstable_mockModule('../../src/modules/ledger/ledger.service.js', () => ({
  default: {
    postEntry: mockPostEntry,
    postDoubleEntry: mockPostEntry,
    egpToPiastres: (egp) => Math.round(egp * 100),
    piastresToEgp: (p) => Math.round(p) / 100,
  },
  postEntry: mockPostEntry,
  postDoubleEntry: mockPostEntry,
  egpToPiastres: (egp) => Math.round(egp * 100),
  piastresToEgp: (p) => Math.round(p) / 100,
}));

jest.unstable_mockModule('../../src/modules/coupons/coupon.service.js', () => ({
  default: {},
}));

const paymentService = (await import('../../src/modules/payments/payment.service.js')).default;

const bookingId = '60f719b8f1a2c81234567888';
const paymentId = '60f719b8f1a2c81234567877';

/**
 * Regression tests for docs/AUDIT_2026_09_FULL_SYSTEM.md findings X17 and X19 —
 * specifically the two branches Round 2's initial pass left covered only by inspection:
 * the provider-call-throws revert path, and the webhook amount-mismatch rejection.
 */
describe('processRefund — reverts to paid when the provider call fails (X17)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fakeSession.withTransaction.mockImplementation(async (cb) => cb());
    fakeSession.endSession.mockResolvedValue();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(fakeSession);
    lastTransitionResult = null;
  });

  it('reverts the payment to paid and records refundError when provider.refund() throws', async () => {
    mockFindByBookingId.mockResolvedValue({
      _id: paymentId,
      status: 'paid',
      amount: 1000,
      providerTransactionId: 'tx_will_fail',
      bookingId,
      clientId: 'client-1',
    });
    mockBookingFindById.mockResolvedValue({ _id: bookingId, payoutStatus: 'unpaid' });
    mockProviderRefund.mockRejectedValue(new Error('Provider network timeout'));

    await expect(
      paymentService.processRefund({ bookingId, refundPercentage: 100, reason: 'Test' })
    ).rejects.toThrow('Provider network timeout');

    // First transitionStatus call: claim into REFUNDING. Second (via updateById in the
    // catch branch): revert to 'paid' with the failure recorded.
    expect(mockTransitionStatus).toHaveBeenCalledWith(
      paymentId,
      'paid',
      expect.objectContaining({ status: 'refunding' })
    );
    expect(mockTransitionStatus).toHaveBeenCalledWith(
      paymentId,
      'refunding',
      expect.objectContaining({
        status: 'paid',
        refundError: 'Provider network timeout',
      })
    );
    // The refund never resolved to a terminal status, and no ledger entries were posted
    // for money that never actually moved.
    expect(mockPostEntry).not.toHaveBeenCalled();
  });
});

describe('handleWebhook — rejects a captured-amount mismatch before marking anything paid (X19)', () => {
  let handleWebhook;

  beforeEach(async () => {
    jest.clearAllMocks();
    fakeSession.withTransaction.mockImplementation(async (cb) => cb());
    fakeSession.endSession.mockResolvedValue();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(fakeSession);
    lastTransitionResult = null;
    const service = await import('../../src/modules/payments/payment.service.js');
    handleWebhook = service.handleWebhook;
  });

  it('rejects the webhook when the provider-reported amount does not match the payment', async () => {
    mockFindByBookingId.mockResolvedValue({
      _id: paymentId,
      status: 'pending',
      amount: 1000, // expects 100000 piastres
      bookingId,
      clientId: 'client-1',
    });
    mockProviderHandleCallback.mockResolvedValue({
      success: true,
      status: 'paid',
      transactionId: 'tx_mismatch',
      bookingId,
      amountCents: 50000, // provider only captured half
    });

    await expect(handleWebhook({}, {})).rejects.toThrow(/[Aa]mount mismatch/);

    // The payment must never have been advanced to 'paid' on a mismatched capture.
    expect(mockTransitionStatus).not.toHaveBeenCalledWith(
      paymentId,
      expect.anything(),
      expect.objectContaining({ status: 'paid' })
    );
    expect(mockPostEntry).not.toHaveBeenCalled();
  });

  it('still succeeds when the provider-reported amount matches exactly', async () => {
    mockFindByBookingId.mockResolvedValue({
      _id: paymentId,
      status: 'pending',
      amount: 1000,
      bookingId,
      clientId: 'client-1',
    });
    mockProviderHandleCallback.mockResolvedValue({
      success: true,
      status: 'paid',
      transactionId: 'tx_match',
      bookingId,
      amountCents: 100000,
    });

    const result = await handleWebhook({}, {});
    expect(result.status).toBe('paid');
  });

  it('still succeeds when the provider does not report an amount at all (legacy/mock callbacks)', async () => {
    mockFindByBookingId.mockResolvedValue({
      _id: paymentId,
      status: 'pending',
      amount: 1000,
      bookingId,
      clientId: 'client-1',
    });
    mockProviderHandleCallback.mockResolvedValue({
      success: true,
      status: 'paid',
      transactionId: 'tx_no_amount',
      bookingId,
      amountCents: null,
    });

    const result = await handleWebhook({}, {});
    expect(result.status).toBe('paid');
  });
});
