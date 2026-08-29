import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import bookingService from '../../src/modules/bookings/booking.service.js';
import bookingRepository from '../../src/modules/bookings/booking.repository.js';
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

      jest.spyOn(bookingRepository, 'updateById').mockResolvedValue({
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
      expect(paymentService.processRefund).toHaveBeenCalledWith({
        bookingId,
        refundPercentage: 100,
        reason: 'Stylist no-show confirmed',
      });
    });

    it('resolves dispute as completed with partial refund', async () => {
      jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
        _id: bookingId,
        status: 'disputed',
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
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
      });
    });
  });
});
