import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../../src/common/globals.js';

const mockBookingFindById = jest.fn();
const mockBookingUpdateById = jest.fn();
const mockBookingTransitionStatus = jest.fn((id, from, patch, session) =>
  session ? mockBookingUpdateById(id, patch, session) : mockBookingUpdateById(id, patch)
);
const mockBookingSettleNoShow = jest.fn();
const mockReleaseSettlementResumeClaim = jest.fn();
const mockRecordPostSettlementError = jest.fn();
const mockStampSettlementCompleted = jest.fn();
const mockClaimSettlementResume = jest.fn();
const mockMarkSettlementExhausted = jest.fn();
const mockResetSettlementExhaustion = jest.fn();
const mockFindUnfinishedNoShowSettlements = jest.fn();
const mockFindExhaustedNoShowSettlements = jest.fn();

const mockScheduleDelete = jest.fn();
const mockPaymentFindByBookingId = jest.fn();
const mockPaymentProcessRefund = jest.fn();
const mockPenaltyCreate = jest.fn();
const mockCouponIssue = jest.fn();
const mockLedgerPostEntry = jest.fn();
const mockLedgerPostDoubleEntry = jest.fn().mockResolvedValue([{}, {}]);
const mockReliabilityUpdate = jest.fn();
const mockChatLock = jest.fn();

jest.unstable_mockModule('../../src/common/transaction.util.js', () => ({
  default: async (fn) => fn({}),
  withTransaction: async (fn) => fn({}),
}));

jest.unstable_mockModule('../../src/modules/bookings/booking.repository.js', () => ({
  default: {
    findById: mockBookingFindById,
    updateById: mockBookingUpdateById,
    transitionStatus: mockBookingTransitionStatus,
    settleNoShow: mockBookingSettleNoShow,
    releaseSettlementResumeClaim: mockReleaseSettlementResumeClaim,
    recordPostSettlementError: mockRecordPostSettlementError,
    stampSettlementCompleted: mockStampSettlementCompleted,
    claimSettlementResume: mockClaimSettlementResume,
    markSettlementExhausted: mockMarkSettlementExhausted,
    resetSettlementExhaustion: mockResetSettlementExhaustion,
    findUnfinishedNoShowSettlements: mockFindUnfinishedNoShowSettlements,
    findExhaustedNoShowSettlements: mockFindExhaustedNoShowSettlements,
  },
  findById: mockBookingFindById,
  updateById: mockBookingUpdateById,
  transitionStatus: mockBookingTransitionStatus,
  settleNoShow: mockBookingSettleNoShow,
  releaseSettlementResumeClaim: mockReleaseSettlementResumeClaim,
  recordPostSettlementError: mockRecordPostSettlementError,
  stampSettlementCompleted: mockStampSettlementCompleted,
  claimSettlementResume: mockClaimSettlementResume,
  markSettlementExhausted: mockMarkSettlementExhausted,
  resetSettlementExhaustion: mockResetSettlementExhaustion,
  findUnfinishedNoShowSettlements: mockFindUnfinishedNoShowSettlements,
  findExhaustedNoShowSettlements: mockFindExhaustedNoShowSettlements,
}));

jest.unstable_mockModule('../../src/modules/bookings/schedule.repository.js', () => ({
  default: {
    deleteByBookingId: mockScheduleDelete,
  },
  deleteByBookingId: mockScheduleDelete,
}));

jest.unstable_mockModule('../../src/modules/payments/payment.repository.js', () => ({
  default: {
    findByBookingId: mockPaymentFindByBookingId,
    updateById: jest.fn(),
  },
  findByBookingId: mockPaymentFindByBookingId,
  updateById: jest.fn(),
}));

jest.unstable_mockModule('../../src/modules/payments/payment.service.js', () => ({
  default: {
    processRefund: mockPaymentProcessRefund,
  },
  processRefund: mockPaymentProcessRefund,
  round2: (val) => Math.round(val * 100) / 100,
}));

jest.unstable_mockModule('../../src/modules/penalties/penalty.repository.js', () => ({
  default: {
    create: mockPenaltyCreate,
  },
  create: mockPenaltyCreate,
}));

jest.unstable_mockModule('../../src/modules/coupons/coupon.service.js', () => ({
  default: {
    issueCoupon: mockCouponIssue,
  },
  issueCoupon: mockCouponIssue,
}));

jest.unstable_mockModule('../../src/modules/ledger/ledger.service.js', () => ({
  default: {
    postEntry: mockLedgerPostEntry,
    postDoubleEntry: mockLedgerPostDoubleEntry,
  },
  postEntry: mockLedgerPostEntry,
  postDoubleEntry: mockLedgerPostDoubleEntry,
  egpToPiastres: (egp) => Math.round(egp * 100),
  piastresToEgp: (piastres) => Math.round(piastres) / 100,
}));

jest.unstable_mockModule('../../src/modules/stylists/reliability.service.js', () => ({
  default: {
    updateStylistReliability: mockReliabilityUpdate,
  },
  updateStylistReliability: mockReliabilityUpdate,
}));

jest.unstable_mockModule('../../src/modules/chat/chat.service.js', () => ({
  default: {
    lockConversation: mockChatLock,
  },
  lockConversation: mockChatLock,
}));

const {
  resolveNoShow,
  respondToNoShow,
  fileNoShow,
  resumeUnfinishedNoShowSettlements,
  retryExhaustedNoShowSettlement,
} = await import('../../src/modules/bookings/no-show.service.js');

// Regression suite for audit finding C-4: processRefund unconditionally zeroed
// stylistPayoutAmount on every refund, so a client no-show -- where
// NO_SHOW_POLICY.CLIENT entitles the stylist to a 20% share for having travelled and
// lost the slot -- silently paid the stylist nothing instead.
describe('No-Show Settlement — Stylist Compensation (Unit)', () => {
  const clientId = '60f719b8f1a2c81234567891';
  const stylistId = '60f719b8f1a2c81234567890';
  const bookingId = '60f719b8f1a2c81234567888';

  const mockClientNoShowBooking = {
    _id: bookingId,
    clientId: { _id: clientId, toString: () => clientId },
    stylistId: { _id: stylistId, toString: () => stylistId },
    price: 1000,
    status: 'confirmed',
    noShowDetails: {
      reportedAt: new Date(),
      reportedAgainst: 'client',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // The CAS "claim" step (X9): resolves truthy by default so every existing test's
    // resolveNoShow() call proceeds exactly as it did before that guard was added.
    mockBookingSettleNoShow.mockResolvedValue({
      ...mockClientNoShowBooking,
      status: 'no-show-client',
    });
  });

  it('preserves the stylist 20% share when the client no-shows, computed from the amount actually paid', async () => {
    mockBookingFindById.mockResolvedValue(mockClientNoShowBooking);
    mockBookingUpdateById.mockResolvedValueOnce({
      ...mockClientNoShowBooking,
      status: 'no-show-client',
    });
    // amount 900 (a coupon was applied pre-payment) -- the override must be computed
    // against what was actually collected, not the original booking.price of 1000.
    mockPaymentFindByBookingId.mockResolvedValueOnce({
      _id: 'pay-1',
      status: 'paid',
      amount: 900,
    });

    await resolveNoShow(bookingId, { confirmedBy: stylistId });

    expect(mockPaymentProcessRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId,
        refundPercentage: 60, // NO_SHOW_POLICY.CLIENT.CLIENT_REFUND_PERCENTAGE
        stylistPayoutOverrideAmount: 180, // 900 * 20%
      })
    );

    // Client no-show never counts against the stylist who turned up.
    expect(mockReliabilityUpdate).not.toHaveBeenCalled();
    // NO_SHOW_POLICY.CLIENT.STYLIST_PENALTY_PERCENTAGE is 0 -- no penalty on the stylist.
    expect(mockPenaltyCreate).not.toHaveBeenCalled();
    // NO_SHOW_POLICY.CLIENT.ISSUES_COUPON is false.
    expect(mockCouponIssue).not.toHaveBeenCalled();
  });

  it('sets payoutStatus to unpaid so the compensation can actually reach a future payout batch', async () => {
    mockBookingFindById.mockResolvedValue(mockClientNoShowBooking);
    mockBookingUpdateById.mockResolvedValueOnce({
      ...mockClientNoShowBooking,
      status: 'no-show-client',
    });
    mockPaymentFindByBookingId.mockResolvedValueOnce({ _id: 'pay-1', status: 'paid', amount: 1000 });

    await resolveNoShow(bookingId, { confirmedBy: stylistId });

    expect(mockBookingUpdateById).toHaveBeenCalledWith(
      bookingId,
      expect.objectContaining({ payoutStatus: 'unpaid' }),
      expect.anything()
    );
  });
});

describe('respondToNoShow — contest CAS race', () => {
  const clientId = '60f719b8f1a2c81234567891';
  const stylistId = '60f719b8f1a2c81234567890';
  const bookingId = '60f719b8f1a2c81234567888';

  it('refuses to contest if booking is no longer contestable after the read (CAS race)', async () => {
    const booking = {
      _id: bookingId,
      clientId: { _id: clientId },
      stylistId: { _id: stylistId },
      status: 'confirmed',
      noShowDetails: {
        reportedAt: new Date(),
        reportedAgainst: 'stylist',
      },
    };
    mockBookingFindById.mockResolvedValueOnce(booking);
    mockBookingTransitionStatus.mockResolvedValueOnce(null);

    await expect(
      respondToNoShow({ _id: stylistId, role: 'stylist' }, bookingId, {
        contest: true,
        message: 'I was there',
      })
    ).rejects.toThrow(/no longer contestable/i);
  });

  it('refuses to accept if booking is no longer in valid status after read (CAS race)', async () => {
    const booking = {
      _id: bookingId,
      clientId: { _id: clientId },
      stylistId: { _id: stylistId },
      status: 'confirmed',
      noShowDetails: {
        reportedAt: new Date(),
        reportedAgainst: 'stylist',
      },
    };
    mockBookingFindById.mockResolvedValueOnce(booking);
    mockBookingTransitionStatus.mockResolvedValueOnce(null);

    await expect(
      respondToNoShow({ _id: stylistId, role: 'stylist' }, bookingId, {
        contest: false,
        message: 'My mistake',
      })
    ).rejects.toThrow(/no longer in a valid status/i);
  });
});

describe('fileNoShow — CAS race', () => {
  const clientId = '60f719b8f1a2c81234567891';
  const stylistId = '60f719b8f1a2c81234567890';
  const bookingId = '60f719b8f1a2c81234567888';

  it('refuses to file no-show if booking left reportable status after read (CAS race)', async () => {
    const scheduledDate = new Date(Date.now() - 2 * 3600 * 1000);
    const booking = {
      _id: bookingId,
      clientId: { _id: clientId },
      stylistId: { _id: stylistId },
      status: 'in-progress',
      checkInAt: new Date(Date.now() - 90 * 60 * 1000),
      scheduledDate,
      scheduledStartMinute: 0,
      noShowDetails: {},
    };
    mockBookingFindById.mockResolvedValueOnce(booking);
    mockBookingTransitionStatus.mockResolvedValueOnce(null);

    await expect(
      fileNoShow({ _id: clientId, role: 'client' }, bookingId, {})
    ).rejects.toThrow(/no longer in a reportable status/i);
  });
});

describe('resolveNoShow — S3.2 & S3.2a Ordering, Atomicity & Resumption', () => {
  const clientId = '60f719b8f1a2c81234567891';
  const stylistId = '60f719b8f1a2c81234567890';
  const bookingId = '60f719b8f1a2c81234567888';

  const baseBooking = {
    _id: bookingId,
    clientId: { _id: clientId, toString: () => clientId },
    stylistId: { _id: stylistId, toString: () => stylistId },
    price: 1000,
    status: 'confirmed',
    noShowDetails: {
      reportedAt: new Date(),
      reportedAgainst: 'stylist',
      confirmedBy: clientId,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('NS1: does NOT delete schedule block if CAS claim fails', async () => {
    mockBookingFindById.mockResolvedValueOnce(baseBooking);
    mockBookingSettleNoShow.mockResolvedValueOnce(null); // CAS loses
    mockBookingFindById.mockResolvedValueOnce({ ...baseBooking, status: 'completed' });

    const result = await resolveNoShow(bookingId, { confirmedBy: clientId });

    expect(mockScheduleDelete).not.toHaveBeenCalled();
    expect(mockPaymentProcessRefund).not.toHaveBeenCalled();
    expect(mockStampSettlementCompleted).not.toHaveBeenCalled();
    expect(result.status).toBe('completed');
  });

  it('NS2: refund failure aborts settlement and does NOT write payoutStatus', async () => {
    mockBookingFindById.mockResolvedValue(baseBooking);
    mockBookingSettleNoShow.mockResolvedValueOnce({ ...baseBooking, status: 'no-show-stylist' });
    mockPaymentFindByBookingId.mockResolvedValueOnce({ _id: 'pay-1', status: 'paid', amount: 1000 });
    mockPaymentProcessRefund.mockRejectedValueOnce(new Error('Gateway timeout'));

    await expect(
      resolveNoShow(bookingId, { confirmedBy: clientId })
    ).rejects.toThrow('Gateway timeout');

    expect(mockBookingUpdateById).not.toHaveBeenCalledWith(
      bookingId,
      expect.objectContaining({ payoutStatus: expect.anything() }),
      expect.anything()
    );
    expect(mockStampSettlementCompleted).not.toHaveBeenCalled();
    expect(mockReleaseSettlementResumeClaim).toHaveBeenCalledWith(bookingId);
  });

  it('Halts with 409 when payment is stuck in REFUNDING', async () => {
    mockBookingFindById.mockResolvedValue(baseBooking);
    mockBookingSettleNoShow.mockResolvedValueOnce({ ...baseBooking, status: 'no-show-stylist' });
    mockPaymentFindByBookingId.mockResolvedValueOnce({ _id: 'pay-1', status: 'refunding', amount: 1000 });

    await expect(
      resolveNoShow(bookingId, { confirmedBy: clientId })
    ).rejects.toThrow(/Refund state is ambiguous/i);

    expect(mockPaymentProcessRefund).not.toHaveBeenCalled();
    expect(mockRecordPostSettlementError).toHaveBeenCalledWith(
      bookingId,
      'refund',
      expect.stringContaining('Payment stuck in REFUNDING')
    );
    expect(mockReleaseSettlementResumeClaim).toHaveBeenCalledWith(bookingId);
  });

  it('Resumes already refunded payment by skipping provider refund and completing remaining steps', async () => {
    const resumedBooking = {
      ...baseBooking,
      status: 'no-show-stylist',
      noShowDetails: {
        ...baseBooking.noShowDetails,
        settlementCompletedAt: null, // crash window after refund!
      },
    };
    mockBookingFindById.mockResolvedValue(resumedBooking);
    mockPaymentFindByBookingId.mockResolvedValueOnce({
      _id: 'pay-1',
      status: 'refunded',
      amount: 1000,
    });
    mockBookingUpdateById.mockResolvedValueOnce({ ...resumedBooking, payoutStatus: 'paid' });

    await resolveNoShow(bookingId, { confirmedBy: clientId });

    // Skipped provider refund
    expect(mockPaymentProcessRefund).not.toHaveBeenCalled();
    // Step C executed
    expect(mockPenaltyCreate).toHaveBeenCalled();
    expect(mockLedgerPostDoubleEntry).toHaveBeenCalled();
    // Step D executed
    expect(mockScheduleDelete).toHaveBeenCalled();
    expect(mockCouponIssue).toHaveBeenCalled();
    // Step E stamped
    expect(mockStampSettlementCompleted).toHaveBeenCalledWith(bookingId);
  });

  it('retryExhaustedNoShowSettlement: rejects non-admin and retries exhausted settlement for admin', async () => {
    const exhaustedBooking = {
      ...baseBooking,
      status: 'no-show-stylist',
      noShowDetails: {
        ...baseBooking.noShowDetails,
        settlementExhausted: true,
      },
    };

    // Non-admin rejected
    await expect(
      retryExhaustedNoShowSettlement({ _id: clientId, role: 'client' }, bookingId)
    ).rejects.toThrow(/Only admins can retry/i);

    // Admin succeeds
    mockBookingFindById.mockResolvedValue(exhaustedBooking);
    mockBookingSettleNoShow.mockResolvedValueOnce({ ...exhaustedBooking, status: 'no-show-stylist' });
    mockPaymentFindByBookingId.mockResolvedValue({ _id: 'pay-1', status: 'refunded', amount: 1000 });

    await retryExhaustedNoShowSettlement({ _id: 'admin-1', role: 'admin' }, bookingId);

    expect(mockResetSettlementExhaustion).toHaveBeenCalledWith(bookingId);
  });

  it('resumeUnfinishedNoShowSettlements: sweeps and claims unfinished bookings, marking exhausted on max attempts', async () => {
    const unfinishedBooking = {
      ...baseBooking,
      status: 'no-show-stylist',
      noShowDetails: {
        ...baseBooking.noShowDetails,
        settlementAttempts: 4,
      },
    };
    mockFindUnfinishedNoShowSettlements.mockResolvedValueOnce([unfinishedBooking]);
    mockClaimSettlementResume.mockResolvedValueOnce(unfinishedBooking);
    mockBookingFindById.mockResolvedValue(unfinishedBooking);
    mockPaymentFindByBookingId.mockResolvedValue({ _id: 'pay-1', status: 'refunded', amount: 1000 });
    // Crash during resolution
    mockBookingUpdateById.mockRejectedValueOnce(new Error('Persistent failure'));

    const result = await resumeUnfinishedNoShowSettlements(5, 50);

    expect(result.scanned).toBe(1);
    expect(result.resolved).toBe(0);
    expect(mockReleaseSettlementResumeClaim).toHaveBeenCalledWith(bookingId);
    expect(mockMarkSettlementExhausted).toHaveBeenCalledWith(bookingId, 'Persistent failure');
  });
});

