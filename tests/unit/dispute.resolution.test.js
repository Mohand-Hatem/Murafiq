import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import bookingService from '../../src/modules/bookings/booking.service.js';
import bookingRepository from '../../src/modules/bookings/booking.repository.js';
import paymentRepository from '../../src/modules/payments/payment.repository.js';
import paymentService from '../../src/modules/payments/payment.service.js';

describe('Dispute Resolution & Filing Window Unit Tests', () => {
  const adminId = '60f719b8f1a2c81234567890';
  const clientId = '60f719b8f1a2c81234567891';
  const stylistId = '60f719b8f1a2c81234567892';
  const bookingId = '60f719b8f1a2c81234567893';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fileDispute', () => {
    it('rejects dispute on a booking completed more than 48 hours ago', async () => {
      const oldDate = new Date(Date.now() - 50 * 3600 * 1000); // 50 hours ago
      jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
        _id: bookingId,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        status: 'completed',
        updatedAt: oldDate,
        createdAt: oldDate,
      });

      await expect(
        bookingService.fileDispute({ _id: clientId, role: 'client' }, bookingId, {
          reason: 'Late dispute',
        })
      ).rejects.toThrow(/Dispute filing window expired/i);
    });

    it('allows dispute within 48 hours of completion', async () => {
      const recentDate = new Date(Date.now() - 5 * 3600 * 1000); // 5 hours ago
      jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
        _id: bookingId,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        status: 'completed',
        updatedAt: recentDate,
        createdAt: recentDate,
      });

      jest.spyOn(bookingRepository, 'transitionStatus').mockResolvedValue({
        _id: bookingId,
        status: 'disputed',
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
      });

      const result = await bookingService.fileDispute(
        { _id: clientId, role: 'client' },
        bookingId,
        { reason: 'Did not match brief' }
      );

      expect(result.status).toBe('disputed');
    });
  });

  describe('cancelBooking block on disputed bookings', () => {
    it('throws 400 when attempting to cancel a disputed booking', async () => {
      jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
        _id: bookingId,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        status: 'disputed',
      });

      await expect(
        bookingService.cancelBooking({ _id: adminId, role: 'admin' }, bookingId, {})
      ).rejects.toThrow(/Cannot cancel a booking in 'disputed' status/i);
    });
  });

  describe('resolveDispute', () => {
    it('resolves dispute as cancelled with full refund', async () => {
      jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
        _id: bookingId,
        status: 'disputed',
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
      });

      jest.spyOn(paymentService, 'processRefund').mockResolvedValue({});
      jest.spyOn(bookingRepository, 'updateById').mockResolvedValue({
        _id: bookingId,
        status: 'cancelled',
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
      });

      const res = await bookingService.resolveDispute(adminId, bookingId, {
        outcome: 'cancelled',
        refundPercentage: 100,
        resolutionNotes: 'Stylist no-show confirmed',
      });

      expect(res.status).toBe('cancelled');
      // A 100% refund leaves nothing retained, so no stylist share applies and
      // paymentRepository.findByBookingId (only needed to compute a partial split) is
      // never called.
      expect(paymentService.processRefund).toHaveBeenCalledWith({
        bookingId,
        refundPercentage: 100,
        reason: 'Stylist no-show confirmed',
        stylistPayoutOverrideAmount: 0,
      });
    });

    it('resolves dispute as completed with partial refund, preserving the stylist fee-split share of the retained amount', async () => {
      jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
        _id: bookingId,
        status: 'disputed',
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
      });

      // MONEY_AND_LEDGER.md Section 4.2's own worked example: 1000 EGP payment, 25%
      // refunded -> 750 EGP retained, stylist keeps 85% of that (750 * 0.85 = 637.50).
      jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue({
        amount: 1000,
        platformFeePercentage: 15,
      });
      jest.spyOn(paymentService, 'processRefund').mockResolvedValue({});
      jest.spyOn(bookingRepository, 'updateById').mockResolvedValue({
        _id: bookingId,
        status: 'completed',
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
      });

      const res = await bookingService.resolveDispute(adminId, bookingId, {
        outcome: 'completed',
        refundPercentage: 25,
        resolutionNotes: 'Session shortened by 30 mins',
      });

      expect(res.status).toBe('completed');
      expect(paymentService.processRefund).toHaveBeenCalledWith({
        bookingId,
        refundPercentage: 25,
        reason: 'Session shortened by 30 mins',
        stylistPayoutOverrideAmount: 637.5,
      });
    });

    // Regression test for docs/AUDIT_2026_09_FULL_SYSTEM.md finding X7: resolving a
    // dispute back to 'completed' used to rewrite completedAt to `new Date()` on every
    // resolution, restarting the 48h dispute-filing window and allowing an already-
    // resolved dispute to be re-filed indefinitely.
    it('does not overwrite an existing completedAt when resolving a dispute', async () => {
      const originalCompletedAt = new Date(Date.now() - 10 * 3600 * 1000);
      jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
        _id: bookingId,
        status: 'disputed',
        completedAt: originalCompletedAt,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
      });
      jest.spyOn(bookingRepository, 'updateById').mockResolvedValue({
        _id: bookingId,
        status: 'completed',
        completedAt: originalCompletedAt,
      });

      await bookingService.resolveDispute(adminId, bookingId, {
        outcome: 'dismissed',
        resolutionNotes: 'No violation found',
      });

      const updateCall = bookingRepository.updateById.mock.calls[0][1];
      expect(updateCall.completedAt).toBeUndefined();
    });
  });

  describe('fileDispute — reopen guard (X7)', () => {
    it('refuses to dispute a booking that has already been through arbitration', async () => {
      jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
        _id: bookingId,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        status: 'completed',
        completedAt: new Date(),
        disputeResolution: {
          outcome: 'dismissed',
          resolvedBy: adminId,
          resolvedAt: new Date(Date.now() - 3600 * 1000),
        },
      });

      await expect(
        bookingService.fileDispute({ _id: clientId, role: 'client' }, bookingId, {
          reason: 'Trying again',
        })
      ).rejects.toThrow(/already been through dispute arbitration/i);
    });
  });
});
