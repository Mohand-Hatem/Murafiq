import crypto from 'crypto';
import withTransaction from '../../common/transaction.util.js';
import bookingRepository from './booking.repository.js';
import scheduleRepository from './schedule.repository.js';
import requestRepository from '../requests/request.repository.js';
import offerRepository from '../offers/offer.repository.js';
import paymentRepository from '../payments/payment.repository.js';
import paymentService, { round2 } from '../payments/payment.service.js';
import penaltyRepository from '../penalties/penalty.repository.js';
import couponService from '../coupons/coupon.service.js';
import ledgerService, { egpToPiastres } from '../ledger/ledger.service.js';
import chatService from '../chat/chat.service.js';
import moderationService from '../moderation/moderation.service.js';
import reliabilityService from '../stylists/reliability.service.js';
import { toPublicBookingDto } from './booking.dto.js';
import { timeToMinutes } from '../../common/utils/timeUtils.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import ApiError from '../../common/utils/ApiError.js';
import { assertBookingParticipant } from '../../common/authz/assertParticipant.js';
import { computeSettlement } from '../../common/settlement.js';
import {
  BOOKING_STATUS,
  PAYMENT_STATUS,
  PAYOUT_STATUS,
  CANCELLATION_POLICY,
  SYSTEM_NO_SHOW_POLICY,
  OFFER_STATUS,
  BOOKING_TERMINAL_STATUSES,
  CHECK_IN_POLICY,
} from '../../common/constants/statuses.constant.js';
import getBusinessDayRange from '../../common/utils/businessDay.util.js';
import env from '../../config/env.config.js';
import logger from '../../config/logger.config.js';

export const createBookingFromOffer = async (
  offerId,
  session = null,
  { bookingMode = 'standard' } = {}
) => {
  const offer = await offerRepository.findById(offerId, session);
  if (!offer) {
    throw new ApiError(404, 'Offer not found');
  }

  if (offer.status !== OFFER_STATUS.PENDING) {
    throw new ApiError(400, `Cannot accept offer in '${offer.status}' status`);
  }

  const requestDoc = await requestRepository.findById(offer.requestId, session);
  if (!requestDoc) {
    throw new ApiError(404, 'Associated request not found');
  }

  // Layer 1: Atomic CAS lock on the parent Request
  const lockedRequest = await requestRepository.lockAndAccept(requestDoc._id, session);
  if (!lockedRequest) {
    throw new ApiError(409, 'This request has already been accepted via another offer.');
  }

  // Calculate start and end minute offsets
  const startMinute = timeToMinutes(requestDoc.time || '10:00');
  const endMinute = startMinute + (offer.duration || 60);

  const requestDate = requestDoc.date || new Date();

  // Double-booking guard check
  const overlap = await scheduleRepository.findOverlap(
    offer.stylistId._id || offer.stylistId,
    requestDate,
    startMinute,
    endMinute,
    session
  );

  if (overlap) {
    throw new ApiError(409, 'This time slot is already booked for this stylist');
  }

  const isDemo = bookingMode === 'demo';

  // Create booking with duplicate-offer / duplicate-request protection
  let bookingDoc;
  try {
    bookingDoc = await bookingRepository.create(
      {
        requestId: requestDoc._id,
        offerId: offer._id,
        clientId: offer.clientId._id || offer.clientId,
        stylistId: offer.stylistId._id || offer.stylistId,
        scheduledDate: requestDate,
        scheduledStartMinute: startMinute,
        scheduledEndMinute: endMinute,
        meetingLocation: requestDoc.meetingLocation || undefined,
        price: offer.price,
        duration: offer.duration,
        status: 'confirmed',
        bookingMode,
        payoutStatus: isDemo ? PAYOUT_STATUS.NOT_OWED : PAYOUT_STATUS.UNPAID,
      },
      session
    );
  } catch (err) {
    if (err.code === 11000) {
      if (err.keyPattern?.requestId) {
        throw new ApiError(409, 'A booking has already been created for this request.');
      }
      throw new ApiError(409, 'This offer has already been booked');
    }
    throw err;
  }

  // Block the stylist's schedule with uniqueness guarantee
  try {
    await scheduleRepository.create(
      {
        stylistId: offer.stylistId._id || offer.stylistId,
        bookingId: bookingDoc._id,
        date: requestDate,
        startMinute,
        endMinute,
      },
      session
    );
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, 'This time slot is already booked for this stylist');
    }
    throw err;
  }

  // Create pending payment record (V1 online payments only; skipped for demo COD)
  if (!isDemo) {
    const platformFeePercentage = env.PLATFORM_FEE_PERCENTAGE || 15;
    const platformFeeAmount = round2(offer.price * (platformFeePercentage / 100));
    const stylistPayoutAmount = round2(offer.price - platformFeeAmount);

    await paymentRepository.create(
      {
        bookingId: bookingDoc._id,
        clientId: offer.clientId._id || offer.clientId,
        currency: 'EGP',
        amount: offer.price,
        platformFeePercentage,
        platformFeeAmount,
        stylistPayoutAmount,
        status: PAYMENT_STATUS.PENDING,
        provider: env.PAYMENT_PROVIDER || 'mock',
      },
      session
    );
  }

  // Update winning Offer status to 'accepted'
  await offerRepository.updateById(offer._id, { status: OFFER_STATUS.ACCEPTED }, session);

  // Close all competing sibling offers. They become CLOSED, not REJECTED: the client
  // never looked at them and declined — someone else simply won. Different signal.
  const siblingOffers = await offerRepository.findSiblingPendingOffers(
    requestDoc._id,
    offer._id,
    session
  );
  if (siblingOffers && siblingOffers.length > 0) {
    await offerRepository.rejectSiblingOffers(requestDoc._id, offer._id, session);
  }

  return bookingDoc;
};

export const getMine = async (clientId, queryString) => {
  const { items, meta } = await bookingRepository.findMine(clientId, queryString);
  return {
    items: items.map(toPublicBookingDto),
    meta,
  };
};

export const getStylistBookings = async (stylistId, queryString) => {
  const { items, meta } = await bookingRepository.findStylistBookings(stylistId, queryString);
  return {
    items: items.map(toPublicBookingDto),
    meta,
  };
};

export const getById = async (user, bookingId) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  assertBookingParticipant(user, booking, { allowAdmin: true });

  return toPublicBookingDto(booking, user);
};

export const checkIn = async (user, bookingId, locationData = {}) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  const { clientId, isClient } = assertBookingParticipant(user, booking, { allowAdmin: false });

  if (booking.status !== 'confirmed' && booking.status !== 'in-progress') {
    throw new ApiError(400, `Cannot check-in to a booking in '${booking.status}' status`);
  }

  // Payment Gate: Booking must be paid before check-in is permitted (bypassed for demo COD bookings)
  if (booking.bookingMode !== 'demo') {
    const payment = await paymentRepository.findByBookingId(bookingId);
    if (!payment || payment.status !== PAYMENT_STATUS.PAID) {
      throw new ApiError(400, 'Payment must be completed before check-in');
    }
  }

  // Temporal window validation: Check-in opens 30 minutes before start and closes at end
  const now = new Date();
  if (booking.scheduledDate || booking.date) {
    const appointmentStart = getAppointmentDateTime(booking);
    const appointmentEnd = getAppointmentEndDateTime(booking);
    const earlyWindowMinutes = CHECK_IN_POLICY?.EARLY_WINDOW_MINUTES ?? 30;
    const earlyWindowMs = earlyWindowMinutes * 60 * 1000;
    const earliestAllowed = new Date(appointmentStart.getTime() - earlyWindowMs);

    if (now < earliestAllowed) {
      throw new ApiError(
        400,
        `Check-in is not permitted until ${earlyWindowMinutes} minutes before the scheduled start time.`
      );
    }

    if (now > appointmentEnd) {
      throw new ApiError(
        400,
        'Check-in is closed because the scheduled session time has passed.'
      );
    }
  }

  const existingPartyCheckIn = isClient ? booking.clientCheckInAt : booking.stylistCheckInAt;
  const updateData = {
    checkInAt: booking.checkInAt || now, // legacy: still read by reliability + the DTO
    [isClient ? 'clientCheckInAt' : 'stylistCheckInAt']: existingPartyCheckIn || now,
    status: 'in-progress',
  };

  if (locationData.lat !== undefined && locationData.lng !== undefined) {
    updateData.checkInLocation = { lat: locationData.lat, lng: locationData.lng };
  }

  // Generate 4-digit Cash OTP for demo bookings upon entering in-progress
  if (booking.bookingMode === 'demo' && !booking.cashOtpHash) {
    const rawOtp = crypto.randomInt(1000, 10000).toString();
    const otpHash = crypto.createHash('sha256').update(rawOtp).digest('hex');
    updateData.cashOtpHash = otpHash;
    updateData.cashOtpPlain = rawOtp;
  }

  const updated = await bookingRepository.transitionStatus(
    bookingId,
    [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.IN_PROGRESS],
    updateData
  );

  if (!updated) {
    throw new ApiError(400, 'Cannot check-in: this booking is no longer in a check-in-able status');
  }

  eventBus.emit(EVENTS.CHECK_IN_COMPLETED, {
    bookingId: updated._id.toString(),
    clientId,
  });

  return toPublicBookingDto(updated, user);
};

export const confirmCompletion = async (user, bookingId) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  const { isClient } = assertBookingParticipant(user, booking, { allowAdmin: false });

  if (booking.status !== 'in-progress') {
    throw new ApiError(
      400,
      `Cannot confirm completion of a booking in '${booking.status}' status. Session must be in-progress.`
    );
  }

  // Demo Cash Gate: Booking must have verified Cash OTP before completion is permitted
  if (booking.bookingMode === 'demo' && !booking.cashCollectedAt) {
    throw new ApiError(400, 'Cash payment must be verified before completing the session.');
  }

  // Atomic and race-free: see setCompletionConfirmation's comment in
  // booking.repository.js. The returned document is never the stale `booking` read
  // above -- it's the freshly-written state, which is what lets the very next check
  // see the OTHER party's confirmation even if they wrote it a moment ago.
  const confirmationField = isClient ? 'clientConfirmedAt' : 'stylistConfirmedAt';
  let updated = await bookingRepository.setCompletionConfirmation(bookingId, confirmationField);
  if (!updated) {
    // The booking moved on (cancelled/disputed/already completed) between the read
    // above and this write -- a genuine race, surfaced rather than silently no-op'd.
    throw new ApiError(
      400,
      'Cannot confirm completion: booking is no longer in-progress'
    );
  }

  if (updated.clientConfirmedAt && updated.stylistConfirmedAt) {
    // Second CAS: only the request that actually observes both fields set attempts
    // this, and the { status: 'in-progress' } filter means only one concurrent
    // attempt can ever succeed -- so SESSION_COMPLETED is emitted exactly once.
    const promoted = await bookingRepository.promoteToCompleted(bookingId);
    if (promoted) {
      updated = promoted;
      // stylistId is required here -- stylist.listener.js destructures it to trigger
      // reliability recalculation on session completion. Previously omitted, so a
      // stylist's score was never recalculated when a session actually completed.
      eventBus.emit(EVENTS.SESSION_COMPLETED, {
        bookingId: updated._id.toString(),
        stylistId: (updated.stylistId._id || updated.stylistId).toString(),
      });
    }
  }

  return toPublicBookingDto(updated, user);
};

export const verifyCashOtp = async (user, bookingId, { otp } = {}) => {
  if (!otp || typeof otp !== 'string' || !/^\d{4}$/.test(otp)) {
    throw new ApiError(400, 'OTP must be exactly 4 digits');
  }

  const booking = await bookingRepository.findByIdWithCashOtp(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  const { isClient, clientId, stylistId } = assertBookingParticipant(user, booking, { allowAdmin: false });
  if (!isClient) {
    throw new ApiError(403, 'Only the client can verify the Cash OTP');
  }

  if (booking.bookingMode !== 'demo') {
    throw new ApiError(400, 'Cash OTP verification is only applicable for demo bookings');
  }

  if (booking.status !== BOOKING_STATUS.IN_PROGRESS && booking.status !== 'in-progress') {
    throw new ApiError(
      400,
      `Cannot verify cash OTP for a booking in '${booking.status}' status. Session must be in-progress.`
    );
  }

  if (booking.cashCollectedAt) {
    throw new ApiError(400, 'Cash payment has already been verified for this booking');
  }

  if (!booking.cashOtpHash) {
    throw new ApiError(400, 'No Cash OTP has been generated for this booking');
  }

  const submittedHash = crypto.createHash('sha256').update(otp).digest('hex');
  const hashBuffer = Buffer.from(submittedHash, 'hex');
  const storedBuffer = Buffer.from(booking.cashOtpHash, 'hex');

  if (hashBuffer.length !== storedBuffer.length || !crypto.timingSafeEqual(hashBuffer, storedBuffer)) {
    throw new ApiError(400, 'Invalid Cash OTP');
  }

  const now = new Date();
  const updated = await bookingRepository.setCashCollected(bookingId, now);
  if (!updated) {
    throw new ApiError(409, 'Failed to record cash payment: booking state changed concurrently');
  }

  eventBus.emit(EVENTS.CASH_PAYMENT_VERIFIED, {
    bookingId: updated._id.toString(),
    clientId: clientId.toString(),
    stylistId: stylistId.toString(),
    amount: updated.price,
  });

  return toPublicBookingDto(updated, user);
};

const DISPUTE_WINDOW_HOURS = 48;

export const fileDispute = async (user, bookingId, disputeData) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  assertBookingParticipant(user, booking, { allowAdmin: true });

  if (booking.status === 'disputed') {
    throw new ApiError(409, 'Booking is already disputed');
  }

  // A dispute this booking already went through arbitration for can never be re-opened.
  // Without this, resolving a dispute back to 'completed' (payout_stylist/dismissed/
  // split/partial_refund) let either party immediately re-file, and if the SECOND
  // resolution also tried to refund, processRefund() rejected it outright (the Payment
  // was already 'partially_refunded'/'refunded' from the first round) -- leaving the
  // booking permanently stuck in 'disputed' with no admin path out. See
  // docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X7.
  if (booking.disputeResolution?.resolvedAt) {
    throw new ApiError(
      409,
      'This booking has already been through dispute arbitration and cannot be disputed again.'
    );
  }

  if (booking.status !== 'completed' && booking.status !== 'in-progress') {
    throw new ApiError(400, `Cannot dispute a booking in '${booking.status}' status`);
  }

  if (booking.status === 'completed') {
    // completedAt is set exactly once when status first becomes 'completed' — do not fall back
    // to updatedAt, which drifts on unrelated writes (see booking.model.js comment).
    const completedAt = booking.completedAt || booking.updatedAt || booking.createdAt;
    const elapsedMs = Date.now() - new Date(completedAt).getTime();
    if (elapsedMs > DISPUTE_WINDOW_HOURS * 3600 * 1000) {
      throw new ApiError(
        400,
        `Dispute filing window expired: disputes must be opened within ${DISPUTE_WINDOW_HOURS} hours of completion`
      );
    }
  }

  const updated = await bookingRepository.transitionStatus(
    bookingId,
    [BOOKING_STATUS.COMPLETED, BOOKING_STATUS.IN_PROGRESS],
    {
      status: 'disputed',
      disputeDetails: {
        raisedBy: user._id || user.id,
        reason: disputeData.reason,
        type: disputeData.type || 'general',
        raisedAt: new Date(),
        evidence: disputeData.evidence || [],
      },
    }
  );

  if (!updated) {
    throw new ApiError(409, 'Cannot file dispute: booking is no longer disputable');
  }

  // Re-open chat so parties can communicate during dispute
  try {
    await chatService.openConversation(bookingId);
  } catch (err) {
    logger.warn('Failed to open chat conversation on dispute filing', {
      bookingId: booking._id.toString(),
      error: err.message,
    });
  }

  eventBus.emit(EVENTS.DISPUTE_RAISED, {
    bookingId: updated._id.toString(),
    raisedBy: user._id || user.id,
    reason: disputeData.reason,
    type: disputeData.type || 'general',
  });

  eventBus.emit(EVENTS.SESSION_DISPUTED, {
    bookingId: updated._id.toString(),
    reason: disputeData.reason,
    type: disputeData.type || 'general',
  });

  return toPublicBookingDto(updated);
};

export const addDisputeEvidence = async (user, bookingId, { text, images = [] }) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  if (booking.status !== 'disputed') {
    throw new ApiError(400, 'Cannot submit evidence: booking is not in disputed status');
  }

  const { userId } = assertBookingParticipant(user, booking, { allowAdmin: true });

  if (text) {
    await moderationService.scanAndEnforce(userId, 'MESSAGE', text, { bookingId });
  }

  const evidenceEntry = {
    submittedBy: userId,
    text: text ? text.trim() : undefined,
    images: Array.isArray(images) ? images : [],
    submittedAt: new Date(),
  };

  const updated = await bookingRepository.transitionStatus(bookingId, [BOOKING_STATUS.DISPUTED], {
    $push: { 'disputeDetails.evidence': evidenceEntry },
  });

  if (!updated) {
    throw new ApiError(400, 'Cannot submit evidence: booking is not in disputed status');
  }

  return toPublicBookingDto(updated);
};

export const getDisputeDetails = async (user, bookingId) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  assertBookingParticipant(user, booking, { allowAdmin: true });

  return {
    bookingId: booking._id,
    status: booking.status,
    disputeDetails: booking.disputeDetails || null,
    disputeResolution: booking.disputeResolution || null,
  };
};

export const getDisputedBookings = async (queryString = {}) => {
  return bookingRepository.findDisputedBookings(queryString);
};

export const resolveDispute = async (
  adminUserId,
  bookingId,
  { outcome, refundPercentage = 0, resolutionNotes }
) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  if (booking.status !== 'disputed') {
    throw new ApiError(
      409,
      `Cannot resolve dispute: booking status is '${booking.status}' (not 'disputed')`
    );
  }

  let finalRefundPercentage = 0;
  let targetStatus = 'completed';

  if (outcome === 'refund_full' || outcome === 'cancelled') {
    targetStatus = 'cancelled';
    finalRefundPercentage = 100;
  } else if (outcome === 'payout_stylist' || outcome === 'dismissed') {
    targetStatus = 'completed';
    finalRefundPercentage = 0;
  } else if (outcome === 'split' || outcome === 'partial_refund') {
    targetStatus = 'completed';
    finalRefundPercentage = Math.max(1, Math.min(99, refundPercentage || 50));
  } else if (outcome === 'completed') {
    targetStatus = 'completed';
    finalRefundPercentage = refundPercentage;
  }

  // If refund is required, execute via paymentService (skipped for demo COD bookings)
  if (booking.bookingMode !== 'demo' && finalRefundPercentage > 0) {
    let stylistPayoutOverrideAmount = 0;
    if (finalRefundPercentage < 100) {
      const payment = await paymentRepository.findByBookingId(bookingId);
      if (payment) {
        const settlement = computeSettlement({
          price: payment.amount,
          event: 'DISPUTE',
          actor: 'admin',
          refundPercentage: finalRefundPercentage,
          platformFeePercentage: payment.platformFeePercentage || env.PLATFORM_FEE_PERCENTAGE || 15,
        });
        stylistPayoutOverrideAmount = settlement.stylistCompensationAmount;
      }
    }

    await paymentService.processRefund({
      bookingId,
      refundPercentage: finalRefundPercentage,
      reason: resolutionNotes || `Dispute arbitration resolution: ${outcome}`,
      stylistPayoutOverrideAmount,
    });
  }

  const updated = await bookingRepository.transitionStatus(
    bookingId,
    [BOOKING_STATUS.DISPUTED],
    {
      status: targetStatus,
      // Only set completedAt if this booking has never completed before (it can reach
      // 'completed' via dispute resolution having been filed from 'in-progress', i.e. it
      // never went through mutual confirmation). If it already has one, preserve it --
      // rewriting it to `new Date()` on every resolution used to restart the 48h
      // dispute-filing window each time, which combined with no reopen guard is what made
      // disputes re-openable indefinitely. See docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X7.
      ...(targetStatus === 'completed' && !booking.completedAt ? { completedAt: new Date() } : {}),
      disputeResolution: {
        outcome,
        refundPercentage: finalRefundPercentage,
        resolutionNotes,
        resolvedBy: adminUserId,
        resolvedAt: new Date(),
      },
    }
  );

  if (!updated) {
    throw new ApiError(409, 'Cannot resolve dispute: booking is no longer in disputed status');
  }

  // Lock conversation after dispute resolution
  try {
    await chatService.lockConversation(bookingId);
  } catch (_err) {
    // Non-fatal
  }

  // Trigger reliability score recalculation for stylist
  const stylistUserId = (booking.stylistId._id || booking.stylistId).toString();
  try {
    await reliabilityService.updateStylistReliability(stylistUserId);
  } catch (_relErr) {
    // Non-fatal
  }

  eventBus.emit(EVENTS.DISPUTE_RESOLVED, {
    bookingId: updated._id.toString(),
    outcome,
    refundPercentage: finalRefundPercentage,
    resolvedBy: adminUserId,
    resolutionNotes,
  });

  if (targetStatus === 'completed') {
    // Same payload contract as the confirmCompletion emit above -- stylist.listener.js
    // destructures stylistId. reliabilityService is also called directly a few lines up
    // in this function, so this particular path isn't silently broken by the omission,
    // but the emitted event should still carry a correct, complete payload for any other
    // listener that reacts to session completion.
    eventBus.emit(EVENTS.SESSION_COMPLETED, {
      bookingId: updated._id.toString(),
      stylistId: stylistUserId,
    });
  }

  return toPublicBookingDto(updated);
};

export const getAppointmentDateTime = (booking) => {
  const { startOfDay } = getBusinessDayRange(booking.scheduledDate || booking.date, 'Africa/Cairo');
  const startMinute =
    booking.scheduledStartMinute !== undefined && booking.scheduledStartMinute !== null
      ? booking.scheduledStartMinute
      : timeToMinutes(booking.time || '10:00');
  return new Date(startOfDay.getTime() + startMinute * 60 * 1000);
};

export const getAppointmentEndDateTime = (booking) => {
  const { startOfDay } = getBusinessDayRange(booking.scheduledDate || booking.date, 'Africa/Cairo');
  const startMinute =
    booking.scheduledStartMinute !== undefined && booking.scheduledStartMinute !== null
      ? booking.scheduledStartMinute
      : timeToMinutes(booking.time || '10:00');
  const endMinute =
    booking.scheduledEndMinute !== undefined && booking.scheduledEndMinute !== null
      ? booking.scheduledEndMinute
      : startMinute + (booking.duration || 60);
  return new Date(startOfDay.getTime() + endMinute * 60 * 1000);
};

export const CHECKIN_SPLIT_AT = process.env.CHECKIN_SPLIT_AT
  ? new Date(process.env.CHECKIN_SPLIT_AT)
  : new Date('2026-09-11T00:00:00.000Z');

/**
 * Evaluates whether a given party's check-in timestamp is valid:
 * Must fall strictly inside [scheduledStart - 30 minutes, scheduledEnd].
 * Missing, null, or invalid dates return false.
 *
 * @param {Object} booking
 * @param {'client'|'stylist'} partyRole
 * @param {Date|string|null} [checkInDate] optional override timestamp
 * @returns {boolean}
 */
export const isAttendanceValid = (booking, partyRole, checkInDate = null) => {
  if (!booking) return false;

  const rawTimestamp =
    checkInDate ||
    (partyRole === 'client' ? booking.clientCheckInAt : booking.stylistCheckInAt);

  if (!rawTimestamp) {
    // Legacy fallback only for pre-split bookings
    const isLegacy = booking.createdAt && new Date(booking.createdAt) < CHECKIN_SPLIT_AT;
    if (isLegacy && booking.checkInAt) {
      return isAttendanceValid(booking, partyRole, booking.checkInAt);
    }
    return false;
  }

  const checkInTime = new Date(rawTimestamp).getTime();
  if (Number.isNaN(checkInTime)) return false;

  const appointmentStart = getAppointmentDateTime(booking).getTime();
  const appointmentEnd = getAppointmentEndDateTime(booking).getTime();
  const earlyWindowMs = (CHECK_IN_POLICY?.EARLY_WINDOW_MINUTES ?? 30) * 60 * 1000;
  const earliestAllowed = appointmentStart - earlyWindowMs;

  return checkInTime >= earliestAllowed && checkInTime <= appointmentEnd;
};

/**
 * Cancellation pricing. The four-branch matrix now lives in ONE place
 * (src/common/settlement.js) shared with the no-show and dispute paths -- see the plan
 * §D.5 BK3. This wrapper survives because it owns the hours-until-session derivation from
 * the booking document, which is booking-specific and not settlement arithmetic.
 */
export const calculateCancellationOutcome = (booking, cancelledByRole, now = new Date()) => {
  const appointment = getAppointmentDateTime(booking);
  const hoursUntilSession = (appointment.getTime() - now.getTime()) / (1000 * 60 * 60);
  return computeSettlement({
    price: booking.price || 0,
    event: 'CANCELLATION',
    actor: cancelledByRole,
    hoursUntilSession,
  });
};

export const getCancellationQuote = async (user, bookingId) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  const { isClient, isStylist, isAdmin } = assertBookingParticipant(user, booking, {
    allowAdmin: true,
  });

  let cancelledByRole;
  if (isClient) {
    cancelledByRole = 'client';
  } else if (isStylist) {
    cancelledByRole = 'stylist';
  } else if (isAdmin) {
    cancelledByRole = 'client';
  }

  const outcome = calculateCancellationOutcome(booking, cancelledByRole, new Date());
  return {
    bookingId: booking._id,
    cancelledByRole,
    ...outcome,
  };
};

export const cancelBooking = async (user, bookingId, cancelData = {}) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  const { userId, isClient, isStylist, isAdmin } = assertBookingParticipant(user, booking, { allowAdmin: true });

  let cancelledBy;
  if (isClient) {
    cancelledBy = 'client';
  } else if (isStylist) {
    cancelledBy = 'stylist';
  } else if (isAdmin) {
    cancelledBy = 'admin';
  }

  if (BOOKING_TERMINAL_STATUSES.includes(booking.status)) {
    throw new ApiError(400, `Cannot cancel a booking in '${booking.status}' status`);
  }

  if (booking.status === 'disputed') {
    throw new ApiError(
      400,
      `Cannot cancel a booking in '${booking.status}' status. Disputed bookings must be resolved via admin arbitration.`
    );
  }

  // A session already checked into ('in-progress') has money-relevant facts on the ground
  // that plain cancellation pricing (hours-until-appointment) cannot see -- the work may
  // already be happening or done. Without this guard a client could let the stylist
  // complete the session, then cancel instead of confirming completion, collecting an 80%
  // refund while the stylist is paid nothing for work actually performed -- and the
  // stylist's only other recourse (fileDispute) requires 'in-progress' or 'completed',
  // never 'cancelled', so once cancelled there was no way back. See
  // docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X10. The correct paths from here are mutual
  // completion, a dispute, or (after the grace window) a no-show report.
  if (booking.status === 'in-progress') {
    throw new ApiError(
      400,
      "Cannot cancel a session already in progress. Confirm completion, file a dispute, or (after the check-in grace period) report a no-show instead."
    );
  }

  if (booking.status !== 'confirmed') {
    throw new ApiError(400, `Cannot cancel a booking in '${booking.status}' status`);
  }

  // calculateCancellationOutcome only special-cases 'client' -- everything else falls
  // through to the stylist-penalty branch. An admin cancelling a booking is neither party's
  // fault, so it must be priced on the (no-penalty) client branch, exactly like
  // getCancellationQuote already does -- otherwise an admin cancellation silently assesses
  // a penalty debt against an innocent stylist, and the quote a client/admin sees before
  // cancelling disagrees with what actually happens when they do.
  const outcomeRole = cancelledBy === 'admin' ? 'client' : cancelledBy;
  const outcome = calculateCancellationOutcome(booking, outcomeRole, new Date());

  const updated = await withTransaction(async (session) => {
    // The in-transaction CAS fromStates: ['confirmed'] replaces the re-read.
    // Preserved for system-coherence: BOOKING_TERMINAL_STATUSES.includes(currentBooking.status)
    const res = await bookingRepository.transitionStatus(
      bookingId,
      [BOOKING_STATUS.CONFIRMED],
      {
        status: 'cancelled',
        cancelledBy,
        cancellationReason: cancelData.reason || undefined,
        cancelledAt: new Date(),
      },
      session
    );

    if (!res) {
      throw new ApiError(409, 'Cannot cancel: booking is no longer cancellable');
    }

    await scheduleRepository.deleteByBookingId(bookingId, session);

    // Stylist cancellation accrues a penalty debt — 3% early, 20% late.
    // In demo, zero platform penalties and zero ledger entries are posted.
    if (booking.bookingMode !== 'demo' && outcome.penaltyAmount > 0) {
      const isEarlyCancel = outcome.tier === 'EARLY_STYLIST_CANCEL';
      const penaltyPct = isEarlyCancel
        ? CANCELLATION_POLICY.EARLY_STYLIST_PENALTY_PERCENTAGE
        : CANCELLATION_POLICY.LATE_STYLIST_PENALTY_PERCENTAGE;

      await penaltyRepository.create(
        {
          stylistId: booking.stylistId._id || booking.stylistId,
          bookingId: booking._id,
          reasonType: isEarlyCancel ? 'EARLY_CANCEL' : 'LATE_CANCEL',
          assessedMinor: egpToPiastres(outcome.penaltyAmount),
          status: 'OUTSTANDING',
        },
        session
      );

      // Paired: the platform recognises this as revenue from the moment the penalty is
      // assessed (accrual basis), not only if/when it's later collected via a payout
      // deduction. In-transaction dual-write ensures atomicity (Task S4.1, B6).
      await ledgerService.postDoubleEntry(
        {
          idempotencyKey: `penalty:${isEarlyCancel ? 'early' : 'late'}_cancel:stylist:${bookingId}`,
          entryType: 'PENALTY_ASSESSMENT',
          accountType: 'STYLIST',
          accountId: (booking.stylistId._id || booking.stylistId).toString(),
          amountMinor: egpToPiastres(outcome.penaltyAmount),
          bookingId,
          correlationId: `booking_${bookingId}`,
          notes: `Stylist cancellation penalty (${penaltyPct}%) for booking #${bookingId}`,
        },
        {
          idempotencyKey: `penalty:${isEarlyCancel ? 'early' : 'late'}_cancel:platform:${bookingId}`,
          entryType: 'PENALTY_ASSESSMENT',
          accountType: 'PLATFORM',
          amountMinor: egpToPiastres(outcome.penaltyAmount),
          bookingId,
          correlationId: `booking_${bookingId}`,
          notes: `Stylist cancellation penalty (${penaltyPct}%) recognised against booking #${bookingId}`,
        },
        session
      );
    }

    return res;
  });

  // If payment was paid, execute refund logic based on cancellation outcome (skipped for demo COD bookings)
  if (booking.bookingMode !== 'demo') {
    const payment = await paymentRepository.findByBookingId(bookingId);
    if (payment && payment.status === PAYMENT_STATUS.PAID) {
      try {
        await paymentService.processRefund({
          bookingId,
          refundPercentage: outcome.refundPercentage,
          reason: cancelData.reason || `Booking cancelled by ${cancelledBy} (${outcome.tier})`,
        });
      } catch (refundErr) {
        await paymentRepository.updateById(payment._id, {
          refundError: refundErr.message,
          refundFailedAt: new Date(),
        });
        logger.error(`Refund failed after cancellation for booking ${bookingId}: ${refundErr.message}`);
      }
    }
  }

  // Late stylist cancellation compensation coupon (Task S3.5, S-3 / BK5)
  if (outcome.couponEligible) {
    const clientId = (booking.clientId?._id || booking.clientId).toString();
    try {
      await couponService.issueCoupon({
        recipientId: clientId,
        sourceBookingId: bookingId.toString(),
        issuedReason: 'LATE_STYLIST_CANCELLATION',
      });
    } catch (couponErr) {
      logger.error(
        `[Cancellation] Coupon issuance failed for booking ${bookingId}: ${couponErr.message}`
      );
    }
  }

  const stylistUserId = updated.stylistId?._id
    ? updated.stylistId._id.toString()
    : updated.stylistId?.toString();
  // The financial terms travel with the event so the audit log records WHAT was decided,
  // not just that a cancellation happened. Without these an auditor can see that a booking
  // was cancelled but not which refund tier applied or what penalty was assessed.
  eventBus.emit(EVENTS.BOOKING_CANCELLED, {
    bookingId: updated._id.toString(),
    cancelledBy,
    cancelledByUserId: userId,
    stylistId: stylistUserId,
    refundPercentage: outcome.refundPercentage,
    penaltyAmount: outcome.penaltyAmount,
    tier: outcome.tier,
  });

  return toPublicBookingDto(updated);
};

/**
 * Resolves an abandoned confirmed booking where the session end has passed and
 * neither party checked in within the valid attendance window.
 *
 * Invariants:
 * - 100% client refund (for non-demo paid bookings).
 * - 0 stylist penalty.
 * - 0 goodwill coupon.
 * - payoutStatus set to not_owed (after refund).
 * - Terminal status: 'cancelled', cancelledBy: 'system'.
 * - ScheduleBlock released.
 * - Chat locked.
 * - Emits EVENTS.BOOKING_CANCELLED with tier: 'SYSTEM_ABANDONED_CANCEL'.
 *
 * @param {string|mongoose.Types.ObjectId} bookingId
 * @param {Object} [opts]
 * @param {string} [opts.reason]
 * @returns {Promise<Object>} Public booking DTO
 */
export const resolveAbandonedConfirmedBooking = async (
  bookingId,
  { reason = '', now = new Date() } = {}
) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  // Idempotent: If already in a terminal status, return without repeating financial actions
  if (BOOKING_TERMINAL_STATUSES.includes(booking.status)) {
    return toPublicBookingDto(booking);
  }

  if (booking.status !== 'confirmed' && booking.status !== 'in-progress') {
    throw new ApiError(400, `Cannot auto-cancel booking in '${booking.status}' status`);
  }

  // Attendance check: Must NOT have valid attendance
  if (isAttendanceValid(booking, 'client') || isAttendanceValid(booking, 'stylist')) {
    throw new ApiError(
      400,
      'Cannot auto-cancel booking as abandoned: one or more participants checked in'
    );
  }

  // Session must have ended
  const appointmentEnd = getAppointmentEndDateTime(booking);
  if (now < appointmentEnd) {
    throw new ApiError(400, 'Cannot resolve abandoned booking before scheduled session end');
  }

  // Atomic CAS transition: ['confirmed', 'in-progress'] -> 'cancelled'
  const updated = await withTransaction(async (session) => {
    const res = await bookingRepository.transitionStatus(
      bookingId,
      [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.IN_PROGRESS],
      {
        status: 'cancelled',
        cancelledBy: 'system',
        cancellationReason: reason || 'System-cancelled: session expired with no participant check-in',
        cancelledAt: new Date(),
      },
      session
    );

    if (!res) return null;
    await scheduleRepository.deleteByBookingId(bookingId, session);
    return res;
  });

  if (!updated) {
    // CAS lost to concurrent operation; return current state
    const current = await bookingRepository.findById(bookingId);
    return toPublicBookingDto(current);
  }

  // If payment was paid, execute 100% refund (skipped for demo bookings)
  if (booking.bookingMode !== 'demo') {
    const payment = await paymentRepository.findByBookingId(bookingId);
    if (payment && payment.status === PAYMENT_STATUS.PAID) {
      try {
        await paymentService.processRefund({
          bookingId,
          refundPercentage: 100,
          reason: reason || 'System-cancelled: abandoned confirmed booking (no check-in)',
          idempotencyKey: `refund-abandoned-${bookingId}`,
        });
      } catch (refundErr) {
        await paymentRepository.updateById(payment._id, {
          refundError: refundErr.message,
          refundFailedAt: new Date(),
        });
        logger.error(`Refund failed after system cancellation for booking ${bookingId}: ${refundErr.message}`);
      }
    }
  }

  // Now that refund is complete, set payoutStatus to not_owed
  await bookingRepository.updateById(bookingId, {
    payoutStatus: PAYOUT_STATUS.NOT_OWED,
  });

  // Lock chat conversation
  try {
    await chatService.lockConversation(bookingId);
  } catch (_err) {
    // Non-fatal
  }

  const stylistUserId = updated.stylistId?._id
    ? updated.stylistId._id.toString()
    : updated.stylistId?.toString();

  eventBus.emit(EVENTS.BOOKING_CANCELLED, {
    bookingId: updated._id.toString(),
    cancelledBy: 'system',
    cancelledByUserId: null,
    stylistId: stylistUserId,
    refundPercentage: 100,
    penaltyAmount: 0,
    tier: 'SYSTEM_ABANDONED_CANCEL',
  });

  const refreshed = await bookingRepository.findById(bookingId);
  return toPublicBookingDto(refreshed);
};

export const resolveStaleZeroAttendanceBooking = resolveAbandonedConfirmedBooking;

/**
 * Auto-completes a stale in-progress booking where both participants have verified attendance.
 *
 * @param {string|mongoose.Types.ObjectId} bookingId
 * @returns {Promise<Object>} Public booking DTO
 */
export const autoCompleteStaleBooking = async (bookingId) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  // Idempotent return if already completed and finalized.
  // If completed but NOT finalized (crash occurred post-CAS), resume post-completion side effects!
  if (booking.status === 'completed' && booking.completionFinalizedAt) {
    return toPublicBookingDto(booking);
  }

  let updated = booking;

  if (booking.status !== 'completed') {
    if (booking.status !== 'in-progress') {
      throw new ApiError(
        400,
        `Cannot auto-complete booking in '${booking.status}' status. Session must be in-progress.`
      );
    }

    // Attendance check: Both parties must have valid attendance
    if (!isAttendanceValid(booking, 'client') || !isAttendanceValid(booking, 'stylist')) {
      throw new ApiError(
        400,
        'Cannot auto-complete booking: both client and stylist must have valid attendance'
      );
    }

    // Atomic CAS promotion: 'in-progress' -> 'completed'
    updated = await bookingRepository.promoteToCompleted(bookingId);
    if (!updated) {
      // CAS lost to concurrent operation; return current state
      const current = await bookingRepository.findById(bookingId);
      return toPublicBookingDto(current);
    }
  }

  // Lock chat conversation
  try {
    await chatService.lockConversation(bookingId);
  } catch (_err) {
    // Non-fatal
  }

  const stylistUserId = updated.stylistId?._id
    ? updated.stylistId._id.toString()
    : updated.stylistId?.toString();

  eventBus.emit(EVENTS.SESSION_COMPLETED, {
    bookingId: updated._id.toString(),
    stylistId: stylistUserId,
    isSystemCompleted: true,
  });

  // Stamp completionFinalizedAt so subsequent sweeps or calls safely short-circuit
  const finalized = await bookingRepository.updateById(bookingId, {
    completionFinalizedAt: new Date(),
  });

  return toPublicBookingDto(finalized?.status ? finalized : { ...updated, completionFinalizedAt: new Date() });
};

/**
 * Processes an individual stale booking candidate evaluated against the authoritative 24h threshold.
 * Classifies attendance via isAttendanceValid() into one of 4 outcomes:
 * 1. Both valid attendance -> auto-complete (SESSION_COMPLETED)
 * 2. Client valid only -> system stylist no-show (Option B: 100% refund, 0 penalty, 0 coupon)
 * 3. Stylist valid only -> system client no-show (Option A: 60% refund, 20% stylist, 20% platform)
 * 4. Zero valid attendance -> system auto-cancel (100% refund, 0 penalty, 0 coupon)
 *
 * @param {Object} booking
 * @param {Date} [now=new Date()]
 * @returns {Promise<{ action: string, bookingId: any }>}
 */
export const processStaleBooking = async (booking, now = new Date()) => {
  if (!booking) return null;

  // Strict 24h stale check
  const appointmentEnd = getAppointmentEndDateTime(booking);
  const staleThreshold = new Date(appointmentEnd.getTime() + 24 * 60 * 60 * 1000);
  if (now < staleThreshold) {
    return { action: 'skipped_not_stale', bookingId: booking._id };
  }

  // Idempotent: Ignore terminal statuses
  if (BOOKING_TERMINAL_STATUSES.includes(booking.status)) {
    return { action: 'skipped_terminal', bookingId: booking._id };
  }

  const clientValid = isAttendanceValid(booking, 'client');
  const stylistValid = isAttendanceValid(booking, 'stylist');

  // Classification:
  // 1. Both valid attendance -> auto-complete
  if (clientValid && stylistValid) {
    if (booking.status === 'in-progress') {
      await autoCompleteStaleBooking(booking._id);
      return { action: 'auto_completed', bookingId: booking._id };
    }
    await autoCompleteStaleBooking(booking._id);
    return { action: 'auto_completed', bookingId: booking._id };
  }

  // 2. Client valid only -> system stylist no-show (Option B)
  if (clientValid && !stylistValid) {
    const noShowModule = await import('./no-show.service.js');
    const noShowSvc = noShowModule.default || noShowModule;
    await noShowSvc.resolveSystemNoShow({
      bookingId: booking._id,
      accusedRole: 'stylist',
      reason: 'Stale session: stylist absent, client attended',
    });
    return { action: 'system_no_show_stylist', bookingId: booking._id };
  }

  // 3. Stylist valid only -> system client no-show (Option A)
  if (!clientValid && stylistValid) {
    const noShowModule = await import('./no-show.service.js');
    const noShowSvc = noShowModule.default || noShowModule;
    await noShowSvc.resolveSystemNoShow({
      bookingId: booking._id,
      accusedRole: 'client',
      reason: 'Stale session: client absent, stylist attended',
    });
    return { action: 'system_no_show_client', bookingId: booking._id };
  }

  // 4. Zero valid attendance -> system auto-cancel + 100% refund
  await resolveAbandonedConfirmedBooking(booking._id, {
    reason: 'Stale session: zero attendance recorded',
    now,
  });
  return { action: 'auto_cancelled_zero_attendance', bookingId: booking._id };
};

/**
 * Recovers an unfinalized external refund for a system-cancelled or system-no-show booking.
 *
 * @param {Object} booking
 * @returns {Promise<{ status: string, bookingId: any }>}
 */
export const recoverStaleRefund = async (booking) => {
  if (!booking) return null;

  // 0. Handle unfinalized system completions (crash recovery for auto-completion side effects)
  if (booking.status === 'completed' || booking.status === BOOKING_STATUS.COMPLETED) {
    await autoCompleteStaleBooking(booking._id);
    return { status: 'completion_finalized', bookingId: booking._id };
  }

  // 1. Demo bookings: no external money to refund
  if (booking.bookingMode === 'demo') {
    if (booking.payoutStatus !== PAYOUT_STATUS.NOT_OWED && booking.status === 'cancelled') {
      await bookingRepository.updateById(booking._id, { payoutStatus: PAYOUT_STATUS.NOT_OWED });
    }
    if (booking.noShowDetails?.isSystemDetected && !booking.noShowDetails?.settlementCompletedAt) {
      await bookingRepository.stampSettlementCompleted(booking._id);
    }
    return { status: 'finalized_demo', bookingId: booking._id };
  }

  const payment = await paymentRepository.findByBookingId(booking._id);
  if (!payment) {
    logger.warn(`[Refund Recovery] No payment found for booking ${booking._id}`);
    if (booking.status === 'cancelled') {
      await bookingRepository.updateById(booking._id, { payoutStatus: PAYOUT_STATUS.NOT_OWED });
    }
    if (booking.noShowDetails?.isSystemDetected && !booking.noShowDetails?.settlementCompletedAt) {
      await bookingRepository.stampSettlementCompleted(booking._id);
    }
    return { status: 'no_payment', bookingId: booking._id };
  }

  // 2. Already refunded: gateway refund already succeeded
  if (
    payment.status === PAYMENT_STATUS.REFUNDED ||
    payment.status === PAYMENT_STATUS.PARTIALLY_REFUNDED
  ) {
    const isClientNoShow =
      booking.status === BOOKING_STATUS.NO_SHOW_CLIENT ||
      booking.status === 'no-show-client' ||
      booking.noShowDetails?.reportedAgainst === 'client';

    // Option A: Stylist compensation (20%) remains owed to the stylist, so payoutStatus MUST remain 'unpaid'.
    // Option B / Zero-attendance cancellation: No stylist compensation owed, so payoutStatus is 'not_owed'.
    const targetPayoutStatus = isClientNoShow ? PAYOUT_STATUS.UNPAID : PAYOUT_STATUS.NOT_OWED;

    await bookingRepository.updateById(booking._id, {
      payoutStatus: targetPayoutStatus,
    });
    if (booking.noShowDetails?.isSystemDetected && !booking.noShowDetails?.settlementCompletedAt) {
      await bookingRepository.stampSettlementCompleted(booking._id);
    }
    return {
      status: 'finalized_already_refunded',
      bookingId: booking._id,
      payoutStatus: targetPayoutStatus,
    };
  }

  // 3. Ambiguous REFUNDING status: requires manual reconciliation, do NOT auto-retry
  if (payment.status === PAYMENT_STATUS.REFUNDING) {
    logger.error(
      `[Refund Recovery] Payment ${payment._id} for booking ${booking._id} stuck in REFUNDING; manual reconciliation required.`
    );
    await bookingRepository.recordPostSettlementError(
      booking._id,
      'refund_recovery',
      'Payment stuck in REFUNDING - manual reconciliation required'
    );
    return { status: 'ambiguous_refunding', bookingId: booking._id };
  }

  // 4. PAID status: retry external refund with deterministic idempotency key
  if (payment.status === PAYMENT_STATUS.PAID) {
    let refundPercentage = 100;
    let stylistPayoutOverrideAmount = 0;
    let idempotencyKey = `refund-abandoned-${booking._id}`;

    if (booking.status === 'cancelled') {
      refundPercentage = 100;
      stylistPayoutOverrideAmount = 0;
      idempotencyKey = `refund-abandoned-${booking._id}`;
    } else if (booking.status === 'no-show-stylist' || booking.status === BOOKING_STATUS.NO_SHOW_STYLIST) {
      refundPercentage = 100;
      stylistPayoutOverrideAmount = 0;
      idempotencyKey = `refund-noshow-system-${booking._id}`;
    } else if (booking.status === 'no-show-client' || booking.status === BOOKING_STATUS.NO_SHOW_CLIENT) {
      const policy = SYSTEM_NO_SHOW_POLICY.CLIENT;
      refundPercentage = policy.CLIENT_REFUND_PERCENTAGE;
      const settlement = computeSettlement({
        price: payment.amount,
        event: 'SYSTEM_NO_SHOW',
        actor: 'client',
      });
      stylistPayoutOverrideAmount = settlement.stylistCompensationAmount;
      idempotencyKey = `refund-noshow-system-${booking._id}`;
    }

    try {
      await paymentService.processRefund({
        bookingId: booking._id,
        refundPercentage,
        stylistPayoutOverrideAmount,
        idempotencyKey,
        reason: 'Refund recovery sweep retry',
      });

      const isClientNoShow =
        booking.status === BOOKING_STATUS.NO_SHOW_CLIENT ||
        booking.status === 'no-show-client' ||
        booking.noShowDetails?.reportedAgainst === 'client';
      await bookingRepository.updateById(booking._id, {
        payoutStatus: isClientNoShow ? PAYOUT_STATUS.UNPAID : PAYOUT_STATUS.NOT_OWED,
      });

      if (booking.noShowDetails?.isSystemDetected && !booking.noShowDetails?.settlementCompletedAt) {
        await bookingRepository.stampSettlementCompleted(booking._id);
      }

      // Ensure schedule deleted and chat locked
      try {
        await scheduleRepository.deleteByBookingId(booking._id);
      } catch (_e) {
        /* non-fatal */
      }
      try {
        await chatService.lockConversation(booking._id);
      } catch (_e) {
        /* non-fatal */
      }

      return { status: 'refund_recovered', bookingId: booking._id };
    } catch (err) {
      logger.error(
        `[Refund Recovery] Refund retry failed for booking ${booking._id}: ${err.message}`
      );
      return { status: 'recovery_failed', bookingId: booking._id, error: err.message };
    }
  }

  return { status: 'skipped_not_paid', bookingId: booking._id };
};

export default {
  createBookingFromOffer,
  getMine,
  getStylistBookings,
  getById,
  checkIn,
  verifyCashOtp,
  confirmCompletion,
  fileDispute,
  addDisputeEvidence,
  getDisputeDetails,
  getDisputedBookings,
  resolveDispute,
  getCancellationQuote,
  cancelBooking,
  getAppointmentDateTime,
  getAppointmentEndDateTime,
  isAttendanceValid,
  resolveAbandonedConfirmedBooking,
  resolveStaleZeroAttendanceBooking,
  autoCompleteStaleBooking,
  processStaleBooking,
  recoverStaleRefund,
};
