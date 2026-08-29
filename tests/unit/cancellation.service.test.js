import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockBookingFindById = jest.fn();
const mockBookingUpdateById = jest.fn();
const mockScheduleDelete = jest.fn();
const mockPaymentFindByBookingId = jest.fn();
const mockPaymentProcessRefund = jest.fn();
const mockPenaltyCreate = jest.fn();
const mockLedgerPostEntry = jest.fn();

jest.unstable_mockModule('../../src/modules/bookings/booking.repository.js', () => ({
  default: {
    findById: mockBookingFindById,
    updateById: mockBookingUpdateById,
  },
  findById: mockBookingFindById,
  updateById: mockBookingUpdateById,
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

jest.unstable_mockModule('../../src/modules/ledger/ledger.service.js', () => ({
  default: {
    postEntry: mockLedgerPostEntry,
  },
  postEntry: mockLedgerPostEntry,
  egpToPiastres: (egp) => Math.round(egp * 100),
  piastresToEgp: (piastres) => Math.round(piastres) / 100,
}));

const { calculateCancellationOutcome, getCancellationQuote, cancelBooking } =
  await import('../../src/modules/bookings/booking.service.js');

describe('Cancellation & Refund Revision Engine (Unit)', () => {
  const clientId = '60f719b8f1a2c81234567891';
  const stylistId = '60f719b8f1a2c81234567890';
  const bookingId = '60f719b8f1a2c81234567888';

  const mockClientUser = { _id: clientId, id: clientId, role: 'client' };
  const mockStylistUser = { _id: stylistId, id: stylistId, role: 'stylist' };

  const futureDate = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h from now
  const soonDate = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6h from now

  const mockEarlyBooking = {
    _id: bookingId,
    clientId: { _id: clientId, toString: () => clientId },
    stylistId: { _id: stylistId, toString: () => stylistId },
    scheduledDate: futureDate,
    scheduledStartMinute: 600, // 10:00 AM
    price: 1000,
    status: 'confirmed',
    toObject: function () {
      return this;
    },
  };

  const mockLateBooking = {
    _id: bookingId,
    clientId: { _id: clientId, toString: () => clientId },
    stylistId: { _id: stylistId, toString: () => stylistId },
    scheduledDate: soonDate,
    scheduledStartMinute: 600,
    price: 1000,
    status: 'confirmed',
    toObject: function () {
      return this;
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateCancellationOutcome', () => {
    it('applies 97% refund and 3% platform fee for client early cancel (>=24h)', () => {
      const outcome = calculateCancellationOutcome(mockEarlyBooking, 'client');

      expect(outcome.isEarly).toBe(true);
      expect(outcome.refundPercentage).toBe(97);
      expect(outcome.refundAmount).toBe(970);
      expect(outcome.platformFeeAmount).toBe(30);
      expect(outcome.stylistCompensationAmount).toBe(0);
      expect(outcome.penaltyAmount).toBe(0);
      expect(outcome.tier).toBe('EARLY_CLIENT_CANCEL');
    });

    it('applies 80% refund and 20% platform fee for client late cancel (<24h), with nothing to the stylist', () => {
      const outcome = calculateCancellationOutcome(mockLateBooking, 'client');

      expect(outcome.isEarly).toBe(false);
      expect(outcome.refundPercentage).toBe(80);
      expect(outcome.refundAmount).toBe(800);
      // The stylist receives nothing on a client cancellation: they have not yet
      // travelled, so there is no loss for the no-show policy's compensation to cover.
      expect(outcome.stylistCompensationAmount).toBe(0);
      expect(outcome.platformFeeAmount).toBe(200);
      expect(outcome.penaltyAmount).toBe(0);
      expect(outcome.tier).toBe('LATE_CLIENT_CANCEL');
    });

    it('applies 100% refund and a 3% penalty for stylist early cancel (>=24h)', () => {
      const outcome = calculateCancellationOutcome(mockEarlyBooking, 'stylist');

      expect(outcome.isEarly).toBe(true);
      expect(outcome.refundPercentage).toBe(100);
      expect(outcome.refundAmount).toBe(1000);
      // Cancelling with notice still costs the stylist 3% — see §H.
      expect(outcome.penaltyAmount).toBe(30);
      expect(outcome.couponEligible).toBe(false);
      expect(outcome.tier).toBe('EARLY_STYLIST_CANCEL');
    });

    it('applies 100% refund, 20% penalty, and coupon eligibility for stylist late cancel (<24h)', () => {
      const outcome = calculateCancellationOutcome(mockLateBooking, 'stylist');

      expect(outcome.isEarly).toBe(false);
      expect(outcome.refundPercentage).toBe(100);
      expect(outcome.refundAmount).toBe(1000);
      expect(outcome.penaltyAmount).toBe(200); // 20% of 1000
      expect(outcome.couponEligible).toBe(true);
      expect(outcome.tier).toBe('LATE_STYLIST_CANCEL');
    });
  });

  describe('getCancellationQuote', () => {
    it('returns calculated quote for authenticated client', async () => {
      mockBookingFindById.mockResolvedValueOnce(mockEarlyBooking);

      const quote = await getCancellationQuote(mockClientUser, bookingId);

      expect(quote.bookingId).toBe(bookingId);
      expect(quote.cancelledByRole).toBe('client');
      expect(quote.refundPercentage).toBe(97);
      expect(quote.refundAmount).toBe(970);
    });

    it('returns calculated quote for authenticated stylist', async () => {
      mockBookingFindById.mockResolvedValueOnce(mockLateBooking);

      const quote = await getCancellationQuote(mockStylistUser, bookingId);

      expect(quote.bookingId).toBe(bookingId);
      expect(quote.cancelledByRole).toBe('stylist');
      expect(quote.penaltyAmount).toBe(200);
      expect(quote.couponEligible).toBe(true);
    });
  });

  describe('cancelBooking with Debt & Ledger', () => {
    it('creates penalty record and posts ledger debt when stylist cancels late', async () => {
      mockBookingFindById.mockResolvedValue(mockLateBooking);
      mockBookingUpdateById.mockResolvedValueOnce({
        ...mockLateBooking,
        status: 'cancelled',
        cancelledBy: 'stylist',
      });
      mockPaymentFindByBookingId.mockResolvedValueOnce({
        _id: 'pay-1',
        status: 'paid',
        amount: 1000,
      });

      const result = await cancelBooking(bookingId, mockStylistUser, {
        reason: 'Stylist emergency',
      });

      expect(mockPenaltyCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          stylistId,
          bookingId,
          reasonType: 'LATE_CANCEL',
          assessedMinor: 20000, // 200 EGP = 20,000 piastres
          status: 'OUTSTANDING',
        }),
        null
      );

      expect(mockLedgerPostEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          entryType: 'PENALTY_ASSESSMENT',
          accountType: 'STYLIST',
          direction: 'DEBIT',
          amountMinor: 20000,
        })
      );

      expect(result).toBeDefined();
    });
  });
});
