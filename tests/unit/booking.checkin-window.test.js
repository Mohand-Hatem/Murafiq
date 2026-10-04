import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import '../../src/common/globals.js';
import bookingService, {
  getAppointmentDateTime,
  getAppointmentEndDateTime,
} from '../../src/modules/bookings/booking.service.js';
import bookingRepository from '../../src/modules/bookings/booking.repository.js';
import paymentRepository from '../../src/modules/payments/payment.repository.js';
import getBusinessDayRange from '../../src/common/utils/businessDay.util.js';

describe('Booking Check-in Window and Appointment End Calculation (Step 1)', () => {
  const clientId = '60f719b8f1a2c81234567891';
  const stylistId = '60f719b8f1a2c81234567892';
  const bookingId = '60f719b8f1a2c81234567893';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getAppointmentEndDateTime', () => {
    it('calculates end time from scheduledDate and scheduledEndMinute in Cairo timezone', () => {
      const scheduledDate = new Date('2026-10-15T12:00:00.000Z');
      const booking = {
        scheduledDate,
        scheduledStartMinute: 600, // 10:00 Cairo
        scheduledEndMinute: 720, // 12:00 Cairo
      };

      const startAt = getAppointmentDateTime(booking);
      const endAt = getAppointmentEndDateTime(booking);

      expect(endAt.getTime() - startAt.getTime()).toBe(120 * 60 * 1000);
      const { startOfDay } = getBusinessDayRange(scheduledDate, 'Africa/Cairo');
      expect(endAt.getTime()).toBe(startOfDay.getTime() + 720 * 60 * 1000);
    });

    it('falls back to scheduledStartMinute + duration when scheduledEndMinute is not provided', () => {
      const scheduledDate = new Date('2026-10-15T12:00:00.000Z');
      const booking = {
        scheduledDate,
        scheduledStartMinute: 600,
        duration: 90,
      };

      const startAt = getAppointmentDateTime(booking);
      const endAt = getAppointmentEndDateTime(booking);

      expect(endAt.getTime() - startAt.getTime()).toBe(90 * 60 * 1000);
    });

    it('falls back to duration 60 when both scheduledEndMinute and duration are missing', () => {
      const scheduledDate = new Date('2026-10-15T12:00:00.000Z');
      const booking = {
        scheduledDate,
        scheduledStartMinute: 600,
      };

      const startAt = getAppointmentDateTime(booking);
      const endAt = getAppointmentEndDateTime(booking);

      expect(endAt.getTime() - startAt.getTime()).toBe(60 * 60 * 1000);
    });

    it('correctly handles midnight-crossing appointments (e.g. 23:00 to 01:00 next day)', () => {
      const scheduledDate = new Date('2026-10-15T12:00:00.000Z');
      const booking = {
        scheduledDate,
        scheduledStartMinute: 1380, // 23:00 Cairo
        scheduledEndMinute: 1500, // 01:00 next day Cairo (+25h from midnight)
      };

      const startAt = getAppointmentDateTime(booking);
      const endAt = getAppointmentEndDateTime(booking);

      expect(endAt.getTime() - startAt.getTime()).toBe(120 * 60 * 1000);
      const { startOfDay } = getBusinessDayRange(scheduledDate, 'Africa/Cairo');
      expect(startAt.getTime()).toBe(startOfDay.getTime() + 1380 * 60 * 1000);
      expect(endAt.getTime()).toBe(startOfDay.getTime() + 1500 * 60 * 1000);
    });
  });

  describe('checkIn temporal validation window [start - 30m, end]', () => {
    const fixedNow = new Date('2026-10-15T10:00:00.000Z');

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(fixedNow);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('rejects check-in before scheduledStart - 30 minutes', async () => {
      // Cairo midnight for fixedNow
      const { startOfDay } = getBusinessDayRange(fixedNow, 'Africa/Cairo');
      const nowCairoMinutes = Math.floor((fixedNow.getTime() - startOfDay.getTime()) / (60 * 1000));

      // Session starts 31 minutes in the future -> outside the 30-minute window
      const scheduledStartMinute = nowCairoMinutes + 31;
      const scheduledEndMinute = scheduledStartMinute + 60;

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
        _id: bookingId,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        status: 'confirmed',
        scheduledDate: fixedNow,
        scheduledStartMinute,
        scheduledEndMinute,
      });
      jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue({ status: 'paid' });

      await expect(
        bookingService.checkIn({ _id: clientId, role: 'client' }, bookingId, {})
      ).rejects.toThrow(/Check-in is not permitted until 30 minutes before/i);
    });

    it('allows check-in at exactly scheduledStart - 30 minutes', async () => {
      const { startOfDay } = getBusinessDayRange(fixedNow, 'Africa/Cairo');
      const nowCairoMinutes = Math.floor((fixedNow.getTime() - startOfDay.getTime()) / (60 * 1000));

      // Session starts in exactly 30 minutes -> exactly on the boundary
      const scheduledStartMinute = nowCairoMinutes + 30;
      const scheduledEndMinute = scheduledStartMinute + 60;

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
        _id: bookingId,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        status: 'confirmed',
        scheduledDate: fixedNow,
        scheduledStartMinute,
        scheduledEndMinute,
      });
      jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue({ status: 'paid' });
      jest.spyOn(bookingRepository, 'transitionStatus').mockResolvedValue({
        _id: bookingId,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        status: 'in-progress',
        clientCheckInAt: fixedNow,
      });

      const result = await bookingService.checkIn({ _id: clientId, role: 'client' }, bookingId, {});
      expect(result).toBeDefined();
      expect(bookingRepository.transitionStatus).toHaveBeenCalledWith(
        bookingId,
        ['confirmed', 'in-progress'],
        expect.objectContaining({
          status: 'in-progress',
          clientCheckInAt: fixedNow,
          checkInAt: fixedNow,
        })
      );
    });

    it('allows check-in during the active session', async () => {
      const { startOfDay } = getBusinessDayRange(fixedNow, 'Africa/Cairo');
      const nowCairoMinutes = Math.floor((fixedNow.getTime() - startOfDay.getTime()) / (60 * 1000));

      // Session started 15 minutes ago, ends in 45 minutes
      const scheduledStartMinute = nowCairoMinutes - 15;
      const scheduledEndMinute = nowCairoMinutes + 45;

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
        _id: bookingId,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        status: 'confirmed',
        scheduledDate: fixedNow,
        scheduledStartMinute,
        scheduledEndMinute,
      });
      jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue({ status: 'paid' });
      jest.spyOn(bookingRepository, 'transitionStatus').mockResolvedValue({
        _id: bookingId,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        status: 'in-progress',
        stylistCheckInAt: fixedNow,
      });

      const result = await bookingService.checkIn({ _id: stylistId, role: 'stylist' }, bookingId, {});
      expect(result).toBeDefined();
    });

    it('allows check-in at exactly scheduledEnd', async () => {
      const { startOfDay } = getBusinessDayRange(fixedNow, 'Africa/Cairo');
      const nowCairoMinutes = Math.floor((fixedNow.getTime() - startOfDay.getTime()) / (60 * 1000));

      // Session ends right now
      const scheduledStartMinute = nowCairoMinutes - 60;
      const scheduledEndMinute = nowCairoMinutes;

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
        _id: bookingId,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        status: 'confirmed',
        scheduledDate: fixedNow,
        scheduledStartMinute,
        scheduledEndMinute,
      });
      jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue({ status: 'paid' });
      jest.spyOn(bookingRepository, 'transitionStatus').mockResolvedValue({
        _id: bookingId,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        status: 'in-progress',
      });

      const result = await bookingService.checkIn({ _id: clientId, role: 'client' }, bookingId, {});
      expect(result).toBeDefined();
    });

    it('rejects check-in after scheduledEnd has passed', async () => {
      const { startOfDay } = getBusinessDayRange(fixedNow, 'Africa/Cairo');
      const nowCairoMinutes = Math.floor((fixedNow.getTime() - startOfDay.getTime()) / (60 * 1000));

      // Session ended 1 minute ago
      const scheduledStartMinute = nowCairoMinutes - 61;
      const scheduledEndMinute = nowCairoMinutes - 1;

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
        _id: bookingId,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        status: 'confirmed',
        scheduledDate: fixedNow,
        scheduledStartMinute,
        scheduledEndMinute,
      });
      jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue({ status: 'paid' });

      await expect(
        bookingService.checkIn({ _id: clientId, role: 'client' }, bookingId, {})
      ).rejects.toThrow(/Check-in is closed because the scheduled session time has passed/i);
    });
  });

  describe('Timestamp preservation on repeat or subsequent check-ins', () => {
    const originalCheckInAt = new Date('2026-10-15T09:45:00.000Z');
    const secondCallTime = new Date('2026-10-15T10:00:00.000Z');

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(secondCallTime);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('preserves existing clientCheckInAt and checkInAt if client checks in again', async () => {
      const { startOfDay } = getBusinessDayRange(secondCallTime, 'Africa/Cairo');
      const nowCairoMinutes = Math.floor((secondCallTime.getTime() - startOfDay.getTime()) / (60 * 1000));

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
        _id: bookingId,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        status: 'in-progress',
        scheduledDate: secondCallTime,
        scheduledStartMinute: nowCairoMinutes - 15,
        scheduledEndMinute: nowCairoMinutes + 45,
        checkInAt: originalCheckInAt,
        clientCheckInAt: originalCheckInAt,
      });
      jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue({ status: 'paid' });
      jest.spyOn(bookingRepository, 'transitionStatus').mockResolvedValue({
        _id: bookingId,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        status: 'in-progress',
        clientCheckInAt: originalCheckInAt,
        checkInAt: originalCheckInAt,
      });

      await bookingService.checkIn({ _id: clientId, role: 'client' }, bookingId, {});

      expect(bookingRepository.transitionStatus).toHaveBeenCalledWith(
        bookingId,
        ['confirmed', 'in-progress'],
        expect.objectContaining({
          clientCheckInAt: originalCheckInAt,
          checkInAt: originalCheckInAt,
        })
      );
    });

    it('preserves checkInAt when stylist checks in after client already checked in', async () => {
      const { startOfDay } = getBusinessDayRange(secondCallTime, 'Africa/Cairo');
      const nowCairoMinutes = Math.floor((secondCallTime.getTime() - startOfDay.getTime()) / (60 * 1000));

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
        _id: bookingId,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        status: 'in-progress',
        scheduledDate: secondCallTime,
        scheduledStartMinute: nowCairoMinutes - 15,
        scheduledEndMinute: nowCairoMinutes + 45,
        checkInAt: originalCheckInAt,
        clientCheckInAt: originalCheckInAt,
        stylistCheckInAt: null,
      });
      jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue({ status: 'paid' });
      jest.spyOn(bookingRepository, 'transitionStatus').mockResolvedValue({
        _id: bookingId,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        status: 'in-progress',
        clientCheckInAt: originalCheckInAt,
        stylistCheckInAt: secondCallTime,
        checkInAt: originalCheckInAt,
      });

      await bookingService.checkIn({ _id: stylistId, role: 'stylist' }, bookingId, {});

      expect(bookingRepository.transitionStatus).toHaveBeenCalledWith(
        bookingId,
        ['confirmed', 'in-progress'],
        expect.objectContaining({
          stylistCheckInAt: secondCallTime,
          checkInAt: originalCheckInAt, // Preserved!
        })
      );
    });
  });
});
