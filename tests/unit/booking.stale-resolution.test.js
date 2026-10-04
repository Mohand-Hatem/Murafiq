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
import penaltyRepository from '../../src/modules/penalties/penalty.repository.js';
import couponService from '../../src/modules/coupons/coupon.service.js';
import chatService from '../../src/modules/chat/chat.service.js';
import getBusinessDayRange from '../../src/common/utils/businessDay.util.js';
import {
  isAttendanceValid,
  resolveAbandonedConfirmedBooking,
} from '../../src/modules/bookings/booking.service.js';
import { resolveSystemNoShow } from '../../src/modules/bookings/no-show.service.js';

describe('Domain Stale-Booking and System No-Show Resolution Logic (Step 2)', () => {
  const clientId = '60f719b8f1a2c81234567891';
  const stylistId = '60f719b8f1a2c81234567892';
  const bookingId = '60f719b8f1a2c81234567893';
  const paymentId = '60f719b8f1a2c81234567895';

  const fakeSession = {
    withTransaction: jest.fn(async (cb) => cb()),
    endSession: jest.fn(async () => {}),
  };

  beforeEach(() => {
    fakeSession.withTransaction.mockImplementation(async (cb) => cb());
    fakeSession.endSession.mockResolvedValue();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(fakeSession);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // 1. isAttendanceValid()
  // =========================================================================
  describe('isAttendanceValid', () => {
    const scheduledDate = new Date('2026-10-15T12:00:00.000Z');
    const { startOfDay } = getBusinessDayRange(scheduledDate, 'Africa/Cairo');

    // Start: 10:00 Cairo (+600m), End: 12:00 Cairo (+720m)
    const startMs = startOfDay.getTime() + 600 * 60 * 1000;
    const endMs = startOfDay.getTime() + 720 * 60 * 1000;
    const earlyAllowedMs = startMs - 30 * 60 * 1000; // 09:30 Cairo

    const baseBooking = {
      _id: bookingId,
      scheduledDate,
      scheduledStartMinute: 600,
      scheduledEndMinute: 720,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    };

    it('returns true when check-in is exactly at start - 30 minutes', () => {
      const booking = { ...baseBooking, clientCheckInAt: new Date(earlyAllowedMs) };
      expect(isAttendanceValid(booking, 'client')).toBe(true);
    });

    it('returns true when check-in is during the active session', () => {
      const booking = { ...baseBooking, clientCheckInAt: new Date(startMs + 15 * 60 * 1000) };
      expect(isAttendanceValid(booking, 'client')).toBe(true);
    });

    it('returns true when check-in is exactly at scheduledEnd', () => {
      const booking = { ...baseBooking, stylistCheckInAt: new Date(endMs) };
      expect(isAttendanceValid(booking, 'stylist')).toBe(true);
    });

    it('returns false when check-in is before start - 30 minutes', () => {
      const booking = { ...baseBooking, clientCheckInAt: new Date(earlyAllowedMs - 1000) };
      expect(isAttendanceValid(booking, 'client')).toBe(false);
    });

    it('returns false when check-in is after scheduledEnd', () => {
      const booking = { ...baseBooking, stylistCheckInAt: new Date(endMs + 1000) };
      expect(isAttendanceValid(booking, 'stylist')).toBe(false);
    });

    it('returns false when timestamp is null or undefined', () => {
      const booking = { ...baseBooking, clientCheckInAt: null, stylistCheckInAt: undefined };
      expect(isAttendanceValid(booking, 'client')).toBe(false);
      expect(isAttendanceValid(booking, 'stylist')).toBe(false);
    });

    it('returns false when timestamp is invalid date', () => {
      const booking = { ...baseBooking, clientCheckInAt: 'invalid-date-string' };
      expect(isAttendanceValid(booking, 'client')).toBe(false);
    });

    it('falls back to checkInAt for legacy pre-split bookings', () => {
      const legacyBooking = {
        ...baseBooking,
        createdAt: new Date('2026-09-01T00:00:00.000Z'), // Before split
        checkInAt: new Date(startMs),
        clientCheckInAt: null,
      };
      expect(isAttendanceValid(legacyBooking, 'client')).toBe(true);
    });

    it('does not fall back to checkInAt for post-split bookings if party timestamp is missing', () => {
      const modernBooking = {
        ...baseBooking,
        createdAt: new Date('2026-09-20T00:00:00.000Z'), // After split
        checkInAt: new Date(startMs),
        clientCheckInAt: null,
      };
      expect(isAttendanceValid(modernBooking, 'client')).toBe(false);
    });
  });

  // =========================================================================
  // 2. System-generated stylist no-show (Option B)
  // =========================================================================
  describe('System-generated stylist no-show (Option B)', () => {
    it('executes 100% client refund, 0 stylist penalty, 0 coupon, and marks system detected', async () => {
      const bookingDoc = {
        _id: bookingId,
        status: BOOKING_STATUS.IN_PROGRESS,
        clientId: { _id: clientId, name: 'Client' },
        stylistId: { _id: stylistId, name: 'Stylist' },
        price: 1000,
        bookingMode: 'standard',
        payoutStatus: PAYOUT_STATUS.UNPAID,
      };

      const paymentDoc = {
        _id: paymentId,
        bookingId,
        amount: 1000,
        status: PAYMENT_STATUS.PAID,
      };

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(bookingDoc);
      jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue(paymentDoc);
      jest.spyOn(bookingRepository, 'settleNoShow').mockResolvedValue({
        ...bookingDoc,
        status: BOOKING_STATUS.NO_SHOW_STYLIST,
        noShowDetails: { isSystemDetected: true },
      });
      jest.spyOn(paymentService, 'processRefund').mockResolvedValue({ status: PAYMENT_STATUS.REFUNDED });
      jest.spyOn(bookingRepository, 'updateById').mockResolvedValue({});
      jest.spyOn(scheduleRepository, 'deleteByBookingId').mockResolvedValue({});
      jest.spyOn(chatService, 'lockConversation').mockResolvedValue({});
      jest.spyOn(bookingRepository, 'stampSettlementCompleted').mockResolvedValue({});

      const penaltyCreateSpy = jest.spyOn(penaltyRepository, 'create');
      const couponSpy = jest.spyOn(couponService, 'issueCoupon');

      const eventPayloads = [];
      eventBus.on(EVENTS.NO_SHOW_RESOLVED, (p) => eventPayloads.push(p));

      const result = await resolveSystemNoShow({
        bookingId,
        accusedRole: 'stylist',
        reason: 'Automated sweep: stylist failed to check in',
      });

      expect(result).toBeDefined();

      // 1. Assert atomic CAS claim
      expect(bookingRepository.settleNoShow).toHaveBeenCalledWith(
        bookingId,
        expect.objectContaining({
          status: BOOKING_STATUS.NO_SHOW_STYLIST,
          'noShowDetails.isSystemDetected': true,
          'noShowDetails.reportedAgainst': 'stylist',
        })
      );

      // 2. Assert 100% client refund
      expect(paymentService.processRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId,
          refundPercentage: 100,
          stylistPayoutOverrideAmount: 0,
          idempotencyKey: `refund-noshow-system-${bookingId}`,
        })
      );

      // 3. Assert payoutStatus updated to not_owed
      expect(bookingRepository.updateById).toHaveBeenCalledWith(
        bookingId,
        { payoutStatus: PAYOUT_STATUS.NOT_OWED },
        expect.anything()
      );

      // 4. Assert Option B invariants: ZERO penalties, ZERO coupons
      expect(penaltyCreateSpy).not.toHaveBeenCalled();
      expect(couponSpy).not.toHaveBeenCalled();

      // 5. Assert schedule freed and chat locked
      expect(scheduleRepository.deleteByBookingId).toHaveBeenCalledWith(bookingId);
      expect(chatService.lockConversation).toHaveBeenCalledWith(bookingId);

      // 6. Assert completion marker stamped
      expect(bookingRepository.stampSettlementCompleted).toHaveBeenCalledWith(bookingId);

      // 7. Assert event emitted with isSystemDetected: true
      const resolvedEv = eventPayloads.find((p) => p.bookingId === bookingId.toString());
      expect(resolvedEv).toBeDefined();
      expect(resolvedEv.against).toBe('stylist');
      expect(resolvedEv.clientRefundPercentage).toBe(100);
      expect(resolvedEv.stylistPercentage).toBe(0);
      expect(resolvedEv.isSystemDetected).toBe(true);
    });
  });

  // =========================================================================
  // 3. System-generated client no-show (Option A)
  // =========================================================================
  describe('System-generated client no-show (Option A)', () => {
    it('executes 60% client refund, 20% stylist compensation, 20% platform fee, and marks system detected', async () => {
      const bookingDoc = {
        _id: bookingId,
        status: BOOKING_STATUS.IN_PROGRESS,
        clientId: { _id: clientId, name: 'Client' },
        stylistId: { _id: stylistId, name: 'Stylist' },
        price: 1000,
        bookingMode: 'standard',
        payoutStatus: PAYOUT_STATUS.UNPAID,
      };

      const paymentDoc = {
        _id: paymentId,
        bookingId,
        amount: 1000,
        status: PAYMENT_STATUS.PAID,
      };

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(bookingDoc);
      jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue(paymentDoc);
      jest.spyOn(bookingRepository, 'settleNoShow').mockResolvedValue({
        ...bookingDoc,
        status: BOOKING_STATUS.NO_SHOW_CLIENT,
        noShowDetails: { isSystemDetected: true },
      });
      jest.spyOn(paymentService, 'processRefund').mockResolvedValue({ status: PAYMENT_STATUS.PARTIALLY_REFUNDED });
      jest.spyOn(bookingRepository, 'updateById').mockResolvedValue({});
      jest.spyOn(scheduleRepository, 'deleteByBookingId').mockResolvedValue({});
      jest.spyOn(chatService, 'lockConversation').mockResolvedValue({});
      jest.spyOn(bookingRepository, 'stampSettlementCompleted').mockResolvedValue({});

      const penaltyCreateSpy = jest.spyOn(penaltyRepository, 'create');
      const couponSpy = jest.spyOn(couponService, 'issueCoupon');

      const eventPayloads = [];
      eventBus.on(EVENTS.NO_SHOW_RESOLVED, (p) => eventPayloads.push(p));

      const result = await resolveSystemNoShow({
        bookingId,
        accusedRole: 'client',
        reason: 'Automated sweep: client failed to check in',
      });

      expect(result).toBeDefined();

      // 1. Assert atomic CAS claim
      expect(bookingRepository.settleNoShow).toHaveBeenCalledWith(
        bookingId,
        expect.objectContaining({
          status: BOOKING_STATUS.NO_SHOW_CLIENT,
          'noShowDetails.isSystemDetected': true,
          'noShowDetails.reportedAgainst': 'client',
        })
      );

      // 2. Assert 60% refund with 200 EGP (20%) stylist compensation override
      expect(paymentService.processRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId,
          refundPercentage: 60,
          stylistPayoutOverrideAmount: 200,
          idempotencyKey: `refund-noshow-system-${bookingId}`,
        })
      );

      // 3. Assert payoutStatus remains UNPAID (stylist is owed compensation)
      expect(bookingRepository.updateById).toHaveBeenCalledWith(
        bookingId,
        { payoutStatus: PAYOUT_STATUS.UNPAID },
        expect.anything()
      );

      // 4. Assert zero penalties and zero coupons
      expect(penaltyCreateSpy).not.toHaveBeenCalled();
      expect(couponSpy).not.toHaveBeenCalled();

      // 5. Assert event emitted with 60/20/20 and isSystemDetected: true
      const resolvedEv = eventPayloads.find((p) => p.bookingId === bookingId.toString());
      expect(resolvedEv).toBeDefined();
      expect(resolvedEv.against).toBe('client');
      expect(resolvedEv.clientRefundPercentage).toBe(60);
      expect(resolvedEv.stylistPercentage).toBe(20);
      expect(resolvedEv.platformPercentage).toBe(20);
      expect(resolvedEv.isSystemDetected).toBe(true);
    });
  });

  // =========================================================================
  // 4. Confirmed abandoned booking resolution
  // =========================================================================
  describe('resolveAbandonedConfirmedBooking', () => {
    const scheduledDate = new Date('2026-10-15T12:00:00.000Z');
    const { startOfDay } = getBusinessDayRange(scheduledDate, 'Africa/Cairo');

    // Appointment: 10:00 - 11:00 Cairo (+600m to +660m)
    const endMs = startOfDay.getTime() + 660 * 60 * 1000;

    beforeEach(() => {
      jest.useFakeTimers();
      // Set current time to 1 hour after session end
      jest.setSystemTime(new Date(endMs + 3600 * 1000));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('cancels abandoned confirmed booking with 100% refund, no penalty, and system marker', async () => {
      const bookingDoc = {
        _id: bookingId,
        status: 'confirmed',
        scheduledDate,
        scheduledStartMinute: 600,
        scheduledEndMinute: 660,
        clientCheckInAt: null,
        stylistCheckInAt: null,
        price: 500,
        bookingMode: 'standard',
        payoutStatus: PAYOUT_STATUS.UNPAID,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
      };

      const paymentDoc = {
        _id: paymentId,
        bookingId,
        amount: 500,
        status: PAYMENT_STATUS.PAID,
      };

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(bookingDoc);
      jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue(paymentDoc);
      jest.spyOn(bookingRepository, 'transitionStatus').mockResolvedValue({
        ...bookingDoc,
        status: 'cancelled',
        cancelledBy: 'system',
      });
      jest.spyOn(scheduleRepository, 'deleteByBookingId').mockResolvedValue({});
      jest.spyOn(paymentService, 'processRefund').mockResolvedValue({ status: PAYMENT_STATUS.REFUNDED });
      jest.spyOn(bookingRepository, 'updateById').mockResolvedValue({});
      jest.spyOn(chatService, 'lockConversation').mockResolvedValue({});

      const eventPayloads = [];
      eventBus.on(EVENTS.BOOKING_CANCELLED, (p) => eventPayloads.push(p));

      const result = await resolveAbandonedConfirmedBooking(bookingId, {
        reason: 'Abandoned session expired',
      });

      expect(result).toBeDefined();

      // CAS transition to cancelled with cancelledBy: system
      expect(bookingRepository.transitionStatus).toHaveBeenCalledWith(
        bookingId,
        ['confirmed', 'in-progress'],
        expect.objectContaining({
          status: 'cancelled',
          cancelledBy: 'system',
        }),
        expect.anything()
      );

      // Schedule delete inside transaction
      expect(scheduleRepository.deleteByBookingId).toHaveBeenCalledWith(bookingId, expect.anything());

      // 100% refund processed
      expect(paymentService.processRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId,
          refundPercentage: 100,
          idempotencyKey: `refund-abandoned-${bookingId}`,
        })
      );

      // payoutStatus updated to not_owed
      expect(bookingRepository.updateById).toHaveBeenCalledWith(bookingId, {
        payoutStatus: PAYOUT_STATUS.NOT_OWED,
      });

      // Chat locked
      expect(chatService.lockConversation).toHaveBeenCalledWith(bookingId);

      // Event emitted
      const cancelEv = eventPayloads.find((p) => p.bookingId === bookingId.toString());
      expect(cancelEv).toBeDefined();
      expect(cancelEv.cancelledBy).toBe('system');
      expect(cancelEv.tier).toBe('SYSTEM_ABANDONED_CANCEL');
      expect(cancelEv.refundPercentage).toBe(100);
      expect(cancelEv.penaltyAmount).toBe(0);
    });

    it('rejects with 400 if a participant checked in', async () => {
      const bookingDoc = {
        _id: bookingId,
        status: 'confirmed',
        scheduledDate,
        scheduledStartMinute: 600,
        scheduledEndMinute: 660,
        clientCheckInAt: new Date(endMs - 15 * 60 * 1000), // Valid checkin!
        stylistCheckInAt: null,
      };

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(bookingDoc);

      await expect(resolveAbandonedConfirmedBooking(bookingId)).rejects.toThrow(
        /one or more participants checked in/i
      );
    });

    it('rejects with 400 if scheduled session has not ended yet', async () => {
      // Set current time to BEFORE session end
      jest.setSystemTime(new Date(endMs - 10 * 60 * 1000));

      const bookingDoc = {
        _id: bookingId,
        status: 'confirmed',
        scheduledDate,
        scheduledStartMinute: 600,
        scheduledEndMinute: 660,
        clientCheckInAt: null,
        stylistCheckInAt: null,
      };

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(bookingDoc);

      await expect(resolveAbandonedConfirmedBooking(bookingId)).rejects.toThrow(
        /before scheduled session end/i
      );
    });
  });

  // =========================================================================
  // 5. Idempotency and concurrency protection
  // =========================================================================
  describe('Idempotency & Concurrency Protection', () => {
    it('resolveSystemNoShow returns early without side-effects if already settled', async () => {
      const settledBooking = {
        _id: bookingId,
        status: BOOKING_STATUS.NO_SHOW_STYLIST,
        noShowDetails: {
          settlementCompletedAt: new Date(),
        },
      };

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(settledBooking);
      const refundSpy = jest.spyOn(paymentService, 'processRefund');
      const casSpy = jest.spyOn(bookingRepository, 'settleNoShow');

      const res = await resolveSystemNoShow({ bookingId, accusedRole: 'stylist' });
      expect(res).toBeDefined();
      expect(casSpy).not.toHaveBeenCalled();
      expect(refundSpy).not.toHaveBeenCalled();
    });

    it('resolveAbandonedConfirmedBooking returns early if booking is already terminal', async () => {
      const cancelledBooking = {
        _id: bookingId,
        status: 'cancelled',
        cancelledBy: 'system',
      };

      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(cancelledBooking);
      const refundSpy = jest.spyOn(paymentService, 'processRefund');
      const casSpy = jest.spyOn(bookingRepository, 'transitionStatus');

      const res = await resolveAbandonedConfirmedBooking(bookingId);
      expect(res).toBeDefined();
      expect(casSpy).not.toHaveBeenCalled();
      expect(refundSpy).not.toHaveBeenCalled();
    });

    it('resolveSystemNoShow handles CAS race (claimed returns null) gracefully', async () => {
      const inProgressBooking = {
        _id: bookingId,
        status: BOOKING_STATUS.IN_PROGRESS,
        clientId: { _id: clientId },
        stylistId: { _id: stylistId },
      };

      jest.spyOn(bookingRepository, 'findById')
        .mockResolvedValueOnce(inProgressBooking)
        .mockResolvedValueOnce({ ...inProgressBooking, status: 'completed' });
      jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue({ amount: 1000 });
      // CAS returns null (lost race)
      jest.spyOn(bookingRepository, 'settleNoShow').mockResolvedValue(null);
      const refundSpy = jest.spyOn(paymentService, 'processRefund');

      const res = await resolveSystemNoShow({ bookingId, accusedRole: 'stylist' });
      expect(res).toBeDefined();
      expect(refundSpy).not.toHaveBeenCalled();
    });
  });
});
