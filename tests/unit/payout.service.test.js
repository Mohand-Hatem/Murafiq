import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import payoutService from '../../src/modules/payouts/payout.service.js';
import payoutRepository from '../../src/modules/payouts/payout.repository.js';
import stylistRepository from '../../src/modules/stylists/stylist.repository.js';
import penaltyRepository from '../../src/modules/penalties/penalty.repository.js';

describe('Payout Service Unit Tests', () => {
  const adminId = '60f719b8f1a2c81234567890';
  const stylistId = '60f719b8f1a2c81234567891';
  const payoutId = '60f719b8f1a2c81234567892';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Stylist Payout Account Management', () => {
    it('returns 404 if stylist profile does not exist', async () => {
      jest.spyOn(stylistRepository, 'findByUserId').mockResolvedValue(null);

      await expect(payoutService.getPayoutAccount('unknown')).rejects.toThrow(
        /Stylist profile not found/i
      );
    });

    it('updates payout account on stylist profile', async () => {
      jest.spyOn(stylistRepository, 'findByUserId').mockResolvedValue({ _id: 'p1' });
      jest.spyOn(stylistRepository, 'updateByUserId').mockResolvedValue({
        payoutAccount: { method: 'vodafone_cash', walletPhone: '01012345678' },
      });

      const res = await payoutService.updatePayoutAccount(stylistId, {
        method: 'vodafone_cash',
        walletPhone: '01012345678',
      });

      expect(res.method).toBe('vodafone_cash');
      expect(res.walletPhone).toBe('01012345678');
    });
  });

  describe('State Machine & Double Payout Guards', () => {
    it('rejects markProcessing on a non-pending payout with 409', async () => {
      jest.spyOn(payoutRepository, 'findById').mockResolvedValue({
        _id: payoutId,
        status: 'paid',
      });

      await expect(payoutService.markProcessing(payoutId, adminId)).rejects.toThrow(
        /Cannot mark processing/i
      );
    });

    it('rejects markPaid on an already paid payout with 409', async () => {
      jest.spyOn(payoutRepository, 'findById').mockResolvedValue({
        _id: payoutId,
        status: 'paid',
      });

      await expect(
        payoutService.markPaid(payoutId, adminId, { reference: 'TX123' })
      ).rejects.toThrow(/already marked as paid/i);
    });

    it('rejects markFailed on an already paid payout with 409', async () => {
      jest.spyOn(payoutRepository, 'findById').mockResolvedValue({
        _id: payoutId,
        status: 'paid',
      });

      await expect(
        payoutService.markFailed(payoutId, adminId, { failureReason: 'Rejected' })
      ).rejects.toThrow(/Cannot mark as failed/i);
    });
  });

  describe('Pending Balances Summary Batched Query (PERF-02)', () => {
    it('returns empty array when no pending summaries exist', async () => {
      jest.spyOn(payoutRepository, 'getPendingBalancesSummary').mockResolvedValue([]);
      const findProfilesSpy = jest.spyOn(stylistRepository, 'findByUserIds');
      const findPenaltiesSpy = jest.spyOn(penaltyRepository, 'findOutstandingByStylistIds');

      const result = await payoutService.getPendingBalancesSummary();
      expect(result).toEqual([]);
      expect(findProfilesSpy).not.toHaveBeenCalled();
      expect(findPenaltiesSpy).not.toHaveBeenCalled();
    });

    it('batches stylist profiles and penalties in 2 queries instead of 2N', async () => {
      const s1 = '60f719b8f1a2c81234567891';
      const s2 = '60f719b8f1a2c81234567892';

      jest.spyOn(payoutRepository, 'getPendingBalancesSummary').mockResolvedValue([
        { stylistId: s1, count: 2, totalAmount: 1000 },
        { stylistId: s2, count: 1, totalAmount: 500 },
      ]);

      const mockProfiles = [
        { userId: { _id: s1 }, payoutAccount: { method: 'bank_transfer', iban: 'EG123' } },
        { userId: { _id: s2 }, payoutAccount: { method: 'vodafone_cash', walletPhone: '01011111111' } },
      ];
      const mockPenalties = [
        { stylistId: s1, assessedMinor: 10000, settledMinor: 0 }, // 100 EGP
      ];

      const findProfilesSpy = jest.spyOn(stylistRepository, 'findByUserIds').mockResolvedValue(mockProfiles);
      const findPenaltiesSpy = jest.spyOn(penaltyRepository, 'findOutstandingByStylistIds').mockResolvedValue(mockPenalties);
      const findOneProfileSpy = jest.spyOn(stylistRepository, 'findByUserId');
      const findOnePenaltySpy = jest.spyOn(penaltyRepository, 'findOutstandingByStylistId');

      const result = await payoutService.getPendingBalancesSummary(48);

      expect(findProfilesSpy).toHaveBeenCalledTimes(1);
      expect(findProfilesSpy).toHaveBeenCalledWith([s1, s2]);
      expect(findPenaltiesSpy).toHaveBeenCalledTimes(1);
      expect(findPenaltiesSpy).toHaveBeenCalledWith([s1, s2]);

      // Verify N+1 methods were NEVER called
      expect(findOneProfileSpy).not.toHaveBeenCalled();
      expect(findOnePenaltySpy).not.toHaveBeenCalled();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        stylistId: s1,
        eligibleBookingsCount: 2,
        grossAmount: 1000,
        totalEligibleAmount: 1000,
        outstandingPenaltyAmount: 100,
        netAmount: 900,
        payoutAccount: { method: 'bank_transfer', iban: 'EG123' },
      });
      expect(result[1]).toEqual({
        stylistId: s2,
        eligibleBookingsCount: 1,
        grossAmount: 500,
        totalEligibleAmount: 500,
        outstandingPenaltyAmount: 0,
        netAmount: 500,
        payoutAccount: { method: 'vodafone_cash', walletPhone: '01011111111' },
      });
    });
  });
});
