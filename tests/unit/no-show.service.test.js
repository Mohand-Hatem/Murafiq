import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../../src/common/globals.js';

const mockBookingFindById = jest.fn();
const mockBookingUpdateById = jest.fn();
const mockBookingTransitionStatus = jest.fn((id, from, patch, session) =>
  session ? mockBookingUpdateById(id, patch, session) : mockBookingUpdateById(id, patch)
);
const mockBookingSettleNoShow = jest.fn();
const mockScheduleDelete = jest.fn();
const mockPaymentFindByBookingId = jest.fn();
const mockPaymentProcessRefund = jest.fn();
const mockPenaltyCreate = jest.fn();
const mockCouponIssue = jest.fn();
const mockLedgerPostEntry = jest.fn();
const mockLedgerPostDoubleEntry = jest.fn().mockResolvedValue([{}, {}]);
const mockReliabilityUpdate = jest.fn();
const mockChatLock = jest.fn();

jest.unstable_mockModule('../../src/modules/bookings/booking.repository.js', () => ({
  default: {
    findById: mockBookingFindById,
    updateById: mockBookingUpdateById,
    transitionStatus: mockBookingTransitionStatus,
    settleNoShow: mockBookingSettleNoShow,
  },
  findById: mockBookingFindById,
  updateById: mockBookingUpdateById,
  transitionStatus: mockBookingTransitionStatus,
  settleNoShow: mockBookingSettleNoShow,
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

const { resolveNoShow, respondToNoShow } = await import('../../src/modules/bookings/no-show.service.js');

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
      expect.objectContaining({ payoutStatus: 'unpaid' })
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
});
