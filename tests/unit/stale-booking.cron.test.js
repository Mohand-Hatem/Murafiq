import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import mongoose from 'mongoose';
import '../../src/common/globals.js';
import eventBus from '../../src/common/events/event-bus.js';
import { EVENTS } from '../../src/common/constants/events.constant.js';
import {
  BOOKING_STATUS,
  PAYMENT_STATUS,
  PAYOUT_STATUS,
} from '../../src/common/constants/statuses.constant.js';
import bookingRepository from '../../src/modules/bookings/booking.repository.js';
import scheduleRepository from '../../src/modules/bookings/schedule.repository.js';
import paymentRepository from '../../src/modules/payments/payment.repository.js';
import paymentService from '../../src/modules/payments/payment.service.js';
import chatService from '../../src/modules/chat/chat.service.js';
import getBusinessDayRange from '../../src/common/utils/businessDay.util.js';
import bookingService, {
  autoCompleteStaleBooking,
  processStaleBooking,
  recoverStaleRefund,
  resolveAbandonedConfirmedBooking,
} from '../../src/modules/bookings/booking.service.js';
import noShowService from '../../src/modules/bookings/no-show.service.js';
import {
  sweepStaleBookings,
  sweepStaleRefundRecovery,
} from '../../src/jobs/stale-booking.cron.js';

describe('Step 3: Stale Booking Sweep & Refund Recovery', () => {
  const clientId = '60f719b8f1a2c81234567891';
  const stylistId = '60f719b8f1a2c81234567892';
  const bookingId = '60f719b8f1a2c81234567893';
  const paymentId = '60f719b8f1a2c81234567895';

  const scheduledDate = new Date('2026-10-15T12:00:00.000Z');
  const { startOfDay } = getBusinessDayRange(scheduledDate, 'Africa/Cairo');

  // Session: 10:00 Cairo (+600m) to 12:00 Cairo (+720m)
  const startMs = startOfDay.getTime() + 600 * 60 * 1000;
  const endMs = startOfDay.getTime() + 720 * 60 * 1000;
  const validCheckInMs = startMs + 15 * 60 * 1000; // 10:15 Cairo

  // Stale threshold is scheduledEnd + 24 hours:
  const staleThresholdMs = endMs + 24 * 60 * 60 * 1000;

  const fakeSession = {
    withTransaction: jest.fn(async (cb) => cb()),
    endSession: jest.fn(async () => {}),
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(staleThresholdMs + 3600 * 1000));

    fakeSession.withTransaction.mockImplementation(async (cb) => cb());
    fakeSession.endSession.mockResolvedValue();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(fakeSession);

    // Default safe mocks to prevent Mongoose buffering timeouts
    jest.spyOn(bookingRepository, 'findById').mockImplementation(async (id) => ({
      _id: id || bookingId,
      status: BOOKING_STATUS.IN_PROGRESS,
      scheduledDate,
      scheduledStartMinute: 600,
      scheduledEndMinute: 720,
      duration: 120,
      price: 500,
      bookingMode: 'standard',
      payoutStatus: PAYOUT_STATUS.UNPAID,
      clientId: { _id: clientId, name: 'Client' },
      stylistId: { _id: stylistId, name: 'Stylist' },
    }));

    jest.spyOn(bookingRepository, 'promoteToCompleted').mockImplementation(async (id) => ({
      _id: id || bookingId,
      status: BOOKING_STATUS.COMPLETED,
      completedAt: new Date(),
      clientId: { _id: clientId },
      stylistId: { _id: stylistId },
    }));

    jest.spyOn(bookingRepository, 'transitionStatus').mockImplementation(async (id, from, patch) => ({
      _id: id || bookingId,
      status: patch.status || BOOKING_STATUS.CANCELLED,
      cancelledBy: patch.cancelledBy || 'system',
      clientId: { _id: clientId },
      stylistId: { _id: stylistId },
    }));

    jest.spyOn(bookingRepository, 'settleNoShow').mockImplementation(async (id, patch) => ({
      _id: id || bookingId,
      status: patch.status || BOOKING_STATUS.NO_SHOW_STYLIST,
      clientId: { _id: clientId },
      stylistId: { _id: stylistId },
    }));

    jest.spyOn(bookingRepository, 'updateById').mockResolvedValue({});
    jest.spyOn(bookingRepository, 'stampSettlementCompleted').mockResolvedValue({});
    jest.spyOn(bookingRepository, 'recordPostSettlementError').mockResolvedValue({});
    jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue({
      _id: paymentId,
      bookingId,
      status: PAYMENT_STATUS.PAID,
      amount: 500,
    });
    jest.spyOn(paymentService, 'processRefund').mockResolvedValue({ status: PAYMENT_STATUS.REFUNDED });
    jest.spyOn(scheduleRepository, 'deleteByBookingId').mockResolvedValue({});
    jest.spyOn(chatService, 'lockConversation').mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. autoCompleteStaleBooking()
  // =========================================================================
  describe('autoCompleteStaleBooking', () => {
    it('promotes in-progress booking to completed when both parties have valid attendance', async () => {
      const booking = {
        _id: bookingId,
        status: BOOKING_STATUS.IN_PROGRESS,
        scheduledDate,
        scheduledStartMinute: 600,
        scheduledEndMinute: 720,
        duration: 120,
        clientCheckInAt: new Date(validCheckInMs),
        stylistCheckInAt: new Date(validCheckInMs),
        clientId: { _id: clientId, name: 'Client' },
        stylistId: { _id: stylistId, name: 'Stylist' },
      };

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(booking);
      const emitSpy = jest.spyOn(eventBus, 'emit');

      const result = await autoCompleteStaleBooking(bookingId);

      expect(bookingRepository.promoteToCompleted).toHaveBeenCalledWith(bookingId);
      expect(chatService.lockConversation).toHaveBeenCalledWith(bookingId);
      expect(emitSpy).toHaveBeenCalledWith(
        EVENTS.SESSION_COMPLETED,
        expect.objectContaining({
          bookingId,
          stylistId,
          isSystemCompleted: true,
        })
      );
      expect(result.status).toBe(BOOKING_STATUS.COMPLETED);
    });

    it('rejects auto-completion if stylist check-in is missing/invalid', async () => {
      const booking = {
        _id: bookingId,
        status: BOOKING_STATUS.IN_PROGRESS,
        scheduledDate,
        scheduledStartMinute: 600,
        scheduledEndMinute: 720,
        duration: 120,
        clientCheckInAt: new Date(validCheckInMs),
        stylistCheckInAt: null, // missing
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
      };

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(booking);
      const promoteSpy = jest.spyOn(bookingRepository, 'promoteToCompleted');

      await expect(autoCompleteStaleBooking(bookingId)).rejects.toThrow(
        /both client and stylist must have valid attendance/
      );
      expect(promoteSpy).not.toHaveBeenCalled();
    });

    it('returns immediately if booking is already completed and finalized (idempotency)', async () => {
      const booking = {
        _id: bookingId,
        status: BOOKING_STATUS.COMPLETED,
        completionFinalizedAt: new Date(),
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
      };

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(booking);
      const promoteSpy = jest.spyOn(bookingRepository, 'promoteToCompleted');
      const emitSpy = jest.spyOn(eventBus, 'emit');

      const result = await autoCompleteStaleBooking(bookingId);
      expect(result.status).toBe(BOOKING_STATUS.COMPLETED);
      expect(promoteSpy).not.toHaveBeenCalled();
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('resumes post-completion side effects if booking was completed but crashed before finalization', async () => {
      const booking = {
        _id: bookingId,
        status: BOOKING_STATUS.COMPLETED,
        completedAt: new Date(),
        completionFinalizedAt: null, // Crashed before finalization!
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
      };

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(booking);
      const promoteSpy = jest.spyOn(bookingRepository, 'promoteToCompleted');
      const emitSpy = jest.spyOn(eventBus, 'emit');

      const result = await autoCompleteStaleBooking(bookingId);

      expect(promoteSpy).not.toHaveBeenCalled(); // Already completed, CAS skipped
      expect(chatService.lockConversation).toHaveBeenCalledWith(bookingId);
      expect(emitSpy).toHaveBeenCalledWith(
        EVENTS.SESSION_COMPLETED,
        expect.objectContaining({
          bookingId,
          stylistId,
          isSystemCompleted: true,
        })
      );
      expect(bookingRepository.updateById).toHaveBeenCalledWith(bookingId, {
        completionFinalizedAt: expect.any(Date),
      });
      expect(result.status).toBe(BOOKING_STATUS.COMPLETED);
    });
  });

  // =========================================================================
  // 2. resolveAbandonedConfirmedBooking (supporting in-progress zero attendance)
  // =========================================================================
  describe('resolveAbandonedConfirmedBooking for in-progress bookings', () => {
    it('successfully auto-cancels in-progress booking when both parties have zero valid attendance', async () => {
      const booking = {
        _id: bookingId,
        status: BOOKING_STATUS.IN_PROGRESS,
        scheduledDate,
        scheduledStartMinute: 600,
        scheduledEndMinute: 720,
        duration: 120,
        clientCheckInAt: null,
        stylistCheckInAt: null,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
        bookingMode: 'standard',
      };

      jest
        .spyOn(bookingRepository, 'findById')
        .mockResolvedValueOnce(booking)
        .mockResolvedValueOnce({ ...booking, status: BOOKING_STATUS.CANCELLED, cancelledBy: 'system' });
      const emitSpy = jest.spyOn(eventBus, 'emit');

      const result = await resolveAbandonedConfirmedBooking(bookingId, {
        reason: 'Zero attendance in-progress stale session',
      });

      expect(bookingRepository.transitionStatus).toHaveBeenCalledWith(
        bookingId,
        ['confirmed', 'in-progress'],
        expect.objectContaining({
          status: 'cancelled',
          cancelledBy: 'system',
        }),
        expect.anything()
      );
      expect(paymentService.processRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId,
          refundPercentage: 100,
          idempotencyKey: `refund-abandoned-${bookingId}`,
        })
      );
      expect(bookingRepository.updateById).toHaveBeenCalledWith(bookingId, {
        payoutStatus: PAYOUT_STATUS.NOT_OWED,
      });
      expect(emitSpy).toHaveBeenCalledWith(
        EVENTS.BOOKING_CANCELLED,
        expect.objectContaining({
          bookingId,
          cancelledBy: 'system',
          refundPercentage: 100,
          penaltyAmount: 0,
        })
      );
      expect(result.status).toBe(BOOKING_STATUS.CANCELLED);
    });
  });

  // =========================================================================
  // 3. processStaleBooking() Classification & 24h Threshold
  // =========================================================================
  describe('processStaleBooking', () => {
    it('skips booking when now is before scheduledEnd + 24 hours (strict threshold)', async () => {
      const booking = {
        _id: bookingId,
        status: BOOKING_STATUS.IN_PROGRESS,
        scheduledDate,
        scheduledStartMinute: 600,
        scheduledEndMinute: 720,
        duration: 120,
      };

      // 1 millisecond before stale threshold
      const nowJustBefore = new Date(staleThresholdMs - 1);
      const result = await processStaleBooking(booking, nowJustBefore);

      expect(result).toEqual({ action: 'skipped_not_stale', bookingId });
    });

    it('classifies both valid attendance -> auto_completed', async () => {
      const booking = {
        _id: bookingId,
        status: BOOKING_STATUS.IN_PROGRESS,
        scheduledDate,
        scheduledStartMinute: 600,
        scheduledEndMinute: 720,
        duration: 120,
        clientCheckInAt: new Date(validCheckInMs),
        stylistCheckInAt: new Date(validCheckInMs),
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
      };

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(booking);

      const nowAfterStale = new Date(staleThresholdMs + 1000);
      const result = await processStaleBooking(booking, nowAfterStale);

      expect(result).toEqual({ action: 'auto_completed', bookingId });
    });

    it('classifies client valid only -> system stylist no-show (Option B: 100% refund, 0 penalty)', async () => {
      const booking = {
        _id: bookingId,
        status: BOOKING_STATUS.IN_PROGRESS,
        scheduledDate,
        scheduledStartMinute: 600,
        scheduledEndMinute: 720,
        duration: 120,
        clientCheckInAt: new Date(validCheckInMs),
        stylistCheckInAt: null, // absent
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
      };

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(booking);
      jest.spyOn(noShowService, 'resolveSystemNoShow').mockResolvedValue({
        _id: bookingId,
        status: BOOKING_STATUS.NO_SHOW_STYLIST,
      });

      const nowAfterStale = new Date(staleThresholdMs + 1000);
      const result = await processStaleBooking(booking, nowAfterStale);

      expect(result).toEqual({ action: 'system_no_show_stylist', bookingId });
      expect(noShowService.resolveSystemNoShow).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId,
          accusedRole: 'stylist',
        })
      );
    });

    it('classifies stylist valid only -> system client no-show (Option A: 60% refund, 20% stylist comp)', async () => {
      const booking = {
        _id: bookingId,
        status: BOOKING_STATUS.IN_PROGRESS,
        scheduledDate,
        scheduledStartMinute: 600,
        scheduledEndMinute: 720,
        duration: 120,
        clientCheckInAt: null, // absent
        stylistCheckInAt: new Date(validCheckInMs),
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
      };

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(booking);
      jest.spyOn(noShowService, 'resolveSystemNoShow').mockResolvedValue({
        _id: bookingId,
        status: BOOKING_STATUS.NO_SHOW_CLIENT,
      });

      const nowAfterStale = new Date(staleThresholdMs + 1000);
      const result = await processStaleBooking(booking, nowAfterStale);

      expect(result).toEqual({ action: 'system_no_show_client', bookingId });
      expect(noShowService.resolveSystemNoShow).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId,
          accusedRole: 'client',
        })
      );
    });

    it('classifies zero valid attendance -> auto_cancelled_zero_attendance (100% refund)', async () => {
      const booking = {
        _id: bookingId,
        status: BOOKING_STATUS.CONFIRMED,
        scheduledDate,
        scheduledStartMinute: 600,
        scheduledEndMinute: 720,
        duration: 120,
        clientCheckInAt: null,
        stylistCheckInAt: null,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
      };

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(booking);

      const nowAfterStale = new Date(staleThresholdMs + 1000);
      const result = await processStaleBooking(booking, nowAfterStale);

      expect(result).toEqual({ action: 'auto_cancelled_zero_attendance', bookingId });
    });
  });

  // =========================================================================
  // 4. recoverStaleRefund()
  // =========================================================================
  describe('recoverStaleRefund', () => {
    it('retries external refund for system-cancelled booking whose payment is PAID', async () => {
      const booking = {
        _id: bookingId,
        status: BOOKING_STATUS.CANCELLED,
        cancelledBy: 'system',
        payoutStatus: PAYOUT_STATUS.UNPAID,
        bookingMode: 'standard',
      };

      jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue({
        _id: paymentId,
        status: PAYMENT_STATUS.PAID,
        amount: 500,
      });

      const result = await recoverStaleRefund(booking);

      expect(paymentService.processRefund).toHaveBeenCalledWith({
        bookingId,
        refundPercentage: 100,
        stylistPayoutOverrideAmount: 0,
        idempotencyKey: `refund-abandoned-${bookingId}`,
        reason: 'Refund recovery sweep retry',
      });
      expect(bookingRepository.updateById).toHaveBeenCalledWith(bookingId, {
        payoutStatus: PAYOUT_STATUS.NOT_OWED,
      });
      expect(result).toEqual({ status: 'refund_recovered', bookingId });
    });

    it('retries external refund for system client no-show (Option A) with 60% refund and 20% stylist comp', async () => {
      const booking = {
        _id: bookingId,
        status: BOOKING_STATUS.NO_SHOW_CLIENT,
        payoutStatus: PAYOUT_STATUS.UNPAID,
        bookingMode: 'standard',
        noShowDetails: { isSystemDetected: true, settlementCompletedAt: null },
      };

      jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue({
        _id: paymentId,
        status: PAYMENT_STATUS.PAID,
        amount: 1000,
      });

      const result = await recoverStaleRefund(booking);

      expect(paymentService.processRefund).toHaveBeenCalledWith({
        bookingId,
        refundPercentage: 60,
        stylistPayoutOverrideAmount: 200, // 20% of 1000
        idempotencyKey: `refund-noshow-system-${bookingId}`,
        reason: 'Refund recovery sweep retry',
      });
      expect(bookingRepository.updateById).toHaveBeenCalledWith(bookingId, {
        payoutStatus: PAYOUT_STATUS.UNPAID, // Stylist is owed their 20% compensation
      });
      expect(bookingRepository.stampSettlementCompleted).toHaveBeenCalledWith(bookingId);
      expect(result).toEqual({ status: 'refund_recovered', bookingId });
    });

    it('finalizes booking cleanly when payment is already refunded, skipping provider call', async () => {
      const booking = {
        _id: bookingId,
        status: BOOKING_STATUS.CANCELLED,
        cancelledBy: 'system',
        payoutStatus: PAYOUT_STATUS.UNPAID,
        bookingMode: 'standard',
      };

      jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue({
        _id: paymentId,
        status: PAYMENT_STATUS.REFUNDED,
        amount: 500,
      });
      const refundSpy = jest.spyOn(paymentService, 'processRefund');

      const result = await recoverStaleRefund(booking);

      expect(refundSpy).not.toHaveBeenCalled();
      expect(bookingRepository.updateById).toHaveBeenCalledWith(bookingId, {
        payoutStatus: PAYOUT_STATUS.NOT_OWED,
      });
      expect(result).toEqual({
        status: 'finalized_already_refunded',
        bookingId,
        payoutStatus: PAYOUT_STATUS.NOT_OWED,
      });
    });

    it('preserves payoutStatus as unpaid for Option A client no-show when payment was already refunded', async () => {
      const booking = {
        _id: bookingId,
        status: BOOKING_STATUS.NO_SHOW_CLIENT,
        payoutStatus: PAYOUT_STATUS.UNPAID,
        bookingMode: 'standard',
        noShowDetails: { isSystemDetected: true, reportedAgainst: 'client', settlementCompletedAt: null },
      };

      jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue({
        _id: paymentId,
        status: PAYMENT_STATUS.PARTIALLY_REFUNDED,
        amount: 1000,
      });
      const refundSpy = jest.spyOn(paymentService, 'processRefund');

      const result = await recoverStaleRefund(booking);

      expect(refundSpy).not.toHaveBeenCalled();
      expect(bookingRepository.updateById).toHaveBeenCalledWith(bookingId, {
        payoutStatus: PAYOUT_STATUS.UNPAID, // Stylist compensation remains owed!
      });
      expect(bookingRepository.stampSettlementCompleted).toHaveBeenCalledWith(bookingId);
      expect(result).toEqual({
        status: 'finalized_already_refunded',
        bookingId,
        payoutStatus: PAYOUT_STATUS.UNPAID,
      });
    });

    it('recovers unfinalized completed booking by finalizing side effects', async () => {
      const booking = {
        _id: bookingId,
        status: BOOKING_STATUS.COMPLETED,
        completedAt: new Date(),
        completionFinalizedAt: null,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
      };

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(booking);
      const emitSpy = jest.spyOn(eventBus, 'emit');

      const result = await recoverStaleRefund(booking);

      expect(chatService.lockConversation).toHaveBeenCalledWith(bookingId);
      expect(emitSpy).toHaveBeenCalledWith(
        EVENTS.SESSION_COMPLETED,
        expect.objectContaining({ bookingId, stylistId, isSystemCompleted: true })
      );
      expect(bookingRepository.updateById).toHaveBeenCalledWith(bookingId, {
        completionFinalizedAt: expect.any(Date),
      });
      expect(result).toEqual({ status: 'completion_finalized', bookingId });
    });

    it('refuses auto-retry and records error when payment is stuck in REFUNDING (ambiguous state)', async () => {
      const booking = {
        _id: bookingId,
        status: BOOKING_STATUS.CANCELLED,
        cancelledBy: 'system',
        payoutStatus: PAYOUT_STATUS.UNPAID,
        bookingMode: 'standard',
      };

      jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue({
        _id: paymentId,
        status: PAYMENT_STATUS.REFUNDING,
        amount: 500,
      });
      const refundSpy = jest.spyOn(paymentService, 'processRefund');

      const result = await recoverStaleRefund(booking);

      expect(refundSpy).not.toHaveBeenCalled();
      expect(bookingRepository.recordPostSettlementError).toHaveBeenCalledWith(
        bookingId,
        'refund_recovery',
        expect.stringContaining('manual reconciliation required')
      );
      expect(result).toEqual({ status: 'ambiguous_refunding', bookingId });
    });
  });

  // =========================================================================
  // 5. sweepStaleBookings & sweepStaleRefundRecovery (Batching & Error Isolation)
  // =========================================================================
  describe('sweepStaleBookings and sweepStaleRefundRecovery execution', () => {
    it('isolates errors so a failure on booking A does not prevent booking B from resolving', async () => {
      const bookingA = { _id: '60f719b8f1a2c8123456789a' };
      const bookingB = { _id: '60f719b8f1a2c8123456789b' };

      jest
        .spyOn(bookingRepository, 'findStaleBookingCandidates')
        .mockResolvedValue([bookingA, bookingB]);

      jest
        .spyOn(bookingService, 'processStaleBooking')
        .mockRejectedValueOnce(new Error('Gateway timeout on A'))
        .mockResolvedValueOnce({ action: 'auto_completed', bookingId: bookingB._id });

      const sweepResult = await sweepStaleBookings(new Date());

      expect(sweepResult.scanned).toBe(2);
      expect(sweepResult.resolved).toBe(1);
      expect(sweepResult.actions).toEqual({ auto_completed: 1 });
    });

    it('isolates errors during refund recovery sweep', async () => {
      const bookingA = { _id: '60f719b8f1a2c8123456789a' };
      const bookingB = { _id: '60f719b8f1a2c8123456789b' };

      jest
        .spyOn(bookingRepository, 'findPendingRefundRecoveryCandidates')
        .mockResolvedValue([bookingA, bookingB]);

      jest
        .spyOn(bookingService, 'recoverStaleRefund')
        .mockRejectedValueOnce(new Error('DB failure on A'))
        .mockResolvedValueOnce({ status: 'refund_recovered', bookingId: bookingB._id });

      const sweepResult = await sweepStaleRefundRecovery();

      expect(sweepResult.scanned).toBe(2);
      expect(sweepResult.recovered).toBe(1);
    });
  });
});
