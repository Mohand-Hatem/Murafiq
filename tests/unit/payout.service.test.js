import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import payoutService from '../../src/modules/payouts/payout.service.js';
import payoutRepository from '../../src/modules/payouts/payout.repository.js';
import stylistRepository from '../../src/modules/stylists/stylist.repository.js';

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
});
