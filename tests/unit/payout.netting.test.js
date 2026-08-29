import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockPayoutCreate = jest.fn();
const mockGetEligibleBookings = jest.fn();
const mockFindOutstandingPenalties = jest.fn();
const mockSettlePenalty = jest.fn();
const mockStylistFindByUserId = jest.fn();
const mockBookingUpdateManyPayoutStatus = jest.fn();
const mockLedgerPostEntry = jest.fn();

jest.unstable_mockModule('../../src/modules/payouts/payout.repository.js', () => ({
  default: {
    create: mockPayoutCreate,
    getEligibleBookingsForStylist: mockGetEligibleBookings,
    getPendingBalancesSummary: jest.fn(),
    findStylistPayouts: jest.fn(),
    findAllPayouts: jest.fn(),
  },
  create: mockPayoutCreate,
  getEligibleBookingsForStylist: mockGetEligibleBookings,
}));

jest.unstable_mockModule('../../src/modules/penalties/penalty.repository.js', () => ({
  default: {
    findOutstandingByStylistId: mockFindOutstandingPenalties,
    settlePenalty: mockSettlePenalty,
  },
  findOutstandingByStylistId: mockFindOutstandingPenalties,
  settlePenalty: mockSettlePenalty,
}));

jest.unstable_mockModule('../../src/modules/stylists/stylist.repository.js', () => ({
  default: {
    findByUserId: mockStylistFindByUserId,
  },
  findByUserId: mockStylistFindByUserId,
}));

jest.unstable_mockModule('../../src/modules/bookings/booking.repository.js', () => ({
  default: {
    updateManyPayoutStatus: mockBookingUpdateManyPayoutStatus,
    findById: jest.fn(),
  },
  updateManyPayoutStatus: mockBookingUpdateManyPayoutStatus,
}));

jest.unstable_mockModule('../../src/modules/ledger/ledger.service.js', () => ({
  default: {
    postEntry: mockLedgerPostEntry,
    egpToPiastres: (egp) => Math.round(egp * 100),
    piastresToEgp: (piastres) => Math.round(piastres) / 100,
  },
  postEntry: mockLedgerPostEntry,
  egpToPiastres: (egp) => Math.round(egp * 100),
  piastresToEgp: (piastres) => Math.round(piastres) / 100,
}));

const { payoutService } = await import('../../src/modules/payouts/payout.service.js');

describe('Payout Debt Netting Engine (Unit)', () => {
  const adminUserId = '60f719b8f1a2c81234567899';
  const stylistId = '60f719b8f1a2c81234567890';

  beforeEach(() => {
    jest.clearAllMocks();
    mockStylistFindByUserId.mockResolvedValue({
      _id: 'stylist-profile-1',
      userId: stylistId,
      payoutAccount: { method: 'vodafone_cash', walletPhone: '01012345678' },
    });
  });

  it('nets penalty debt from gross earnings when gross > debt', async () => {
    // Gross payout: 1000 EGP (100,000 piastres)
    mockGetEligibleBookings.mockResolvedValueOnce({
      bookings: [{ _id: 'b1' }, { _id: 'b2' }],
      totalPayoutAmount: 1000,
    });

    // Outstanding penalty: 200 EGP (20,000 piastres)
    const mockPenalty = {
      _id: 'p1',
      assessedMinor: 20000,
      settledMinor: 0,
      reasonType: 'LATE_CANCEL',
    };
    mockFindOutstandingPenalties.mockResolvedValueOnce([mockPenalty]);

    mockPayoutCreate.mockImplementationOnce((data) => Promise.resolve({ _id: 'payout-1', ...data }));

    const created = await payoutService.createBatchPayouts(adminUserId, {
      stylistIds: [stylistId],
    });

    expect(created).toHaveLength(1);
    expect(mockSettlePenalty).toHaveBeenCalledWith('p1', 20000, null);
    expect(mockPayoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 800, // 1000 - 200 = 800 EGP net
        grossAmount: 1000,
        deductions: [
          {
            penaltyId: 'p1',
            amountMinor: 20000,
            reasonType: 'LATE_CANCEL',
          },
        ],
      }),
      null
    );
  });

  it('partially settles debt when debt > gross, reducing net payout to 0', async () => {
    // Gross payout: 300 EGP (30,000 piastres)
    mockGetEligibleBookings.mockResolvedValueOnce({
      bookings: [{ _id: 'b1' }],
      totalPayoutAmount: 300,
    });

    // Outstanding penalty: 500 EGP (50,000 piastres)
    const mockPenalty = {
      _id: 'p1',
      assessedMinor: 50000,
      settledMinor: 0,
      reasonType: 'LATE_CANCEL',
    };
    mockFindOutstandingPenalties.mockResolvedValueOnce([mockPenalty]);

    mockPayoutCreate.mockImplementationOnce((data) => Promise.resolve({ _id: 'payout-2', ...data }));

    const created = await payoutService.createBatchPayouts(adminUserId, {
      stylistIds: [stylistId],
    });

    expect(created).toHaveLength(1);
    expect(mockSettlePenalty).toHaveBeenCalledWith('p1', 30000, null); // settles 300 EGP
    expect(mockPayoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 0, // 300 - 300 = 0 EGP net
        grossAmount: 300,
      }),
      null
    );
  });
});
