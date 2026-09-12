import '../../src/common/globals.js';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import * as bookingController from '../../src/modules/bookings/booking.controller.js';
import bookingService from '../../src/modules/bookings/booking.service.js';

describe('Booking Controller (Unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveDispute argument order (Task S-13)', () => {
    it('calls bookingService.resolveDispute with (adminId, bookingId, body)', async () => {
      const spy = jest.spyOn(bookingService, 'resolveDispute').mockResolvedValue({
        _id: 'bkg_123',
        status: 'completed',
      });

      const req = {
        user: { _id: 'admin_user_999' },
        params: { id: 'bkg_123' },
        body: {
          outcome: 'completed',
          refundPercentage: 0,
          resolutionNotes: 'Approved by admin',
        },
      };

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };

      await bookingController.resolveDispute(req, res, () => {});

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        'admin_user_999',
        'bkg_123',
        expect.objectContaining({
          outcome: 'completed',
          refundPercentage: 0,
          resolutionNotes: 'Approved by admin',
        })
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          message: 'Dispute resolved successfully',
        })
      );
    });

    it('falls back to req.user.id if _id is not present', async () => {
      const spy = jest.spyOn(bookingService, 'resolveDispute').mockResolvedValue({
        _id: 'bkg_456',
        status: 'cancelled',
      });

      const req = {
        user: { id: 'admin_id_888' },
        params: { id: 'bkg_456' },
        body: {
          outcome: 'cancelled',
          refundPercentage: 100,
        },
      };

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };

      await bookingController.resolveDispute(req, res, () => {});

      expect(spy).toHaveBeenCalledWith(
        'admin_id_888',
        'bkg_456',
        expect.objectContaining({
          outcome: 'cancelled',
          refundPercentage: 100,
        })
      );
    });
  });
});
