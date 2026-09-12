import mongoose from 'mongoose';
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
  PAYMENT_STATUS,
  CANCELLATION_POLICY,
  OFFER_STATUS,
  BOOKING_TERMINAL_STATUSES,
} from '../../common/constants/statuses.constant.js';
import getBusinessDayRange from '../../common/utils/businessDay.util.js';
import env from '../../config/env.config.js';
import logger from '../../config/logger.config.js';

export const createBookingFromOffer = async (offerId, session = null) => {
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

  // Create pending payment record
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

  // Initialize closed chat room (unlocked upon payment)
  try {
    await chatService.createConversation(bookingDoc._id, [
      offer.clientId._id || offer.clientId,
      offer.stylistId._id || offer.stylistId,
    ]);
  } catch (_err) {
    // Non-fatal in dev/test environments if Firebase is not configured
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

  return toPublicBookingDto(booking);
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

  // Payment Gate: Booking must be paid before check-in is permitted
  const payment = await paymentRepository.findByBookingId(bookingId);
  if (!payment || payment.status !== PAYMENT_STATUS.PAID) {
    throw new ApiError(400, 'Payment must be completed before check-in');
  }

  const updateData = {
    checkInAt: new Date(), // legacy: still read by reliability + the DTO
    [isClient ? 'clientCheckInAt' : 'stylistCheckInAt']: new Date(),
    status: 'in-progress',
  };

  if (locationData.lat !== undefined && locationData.lng !== undefined) {
    updateData.checkInLocation = { lat: locationData.lat, lng: locationData.lng };
  }

  const updated = await bookingRepository.transitionStatus(
    bookingId,
    ['confirmed', 'in-progress'],
    updateData
  );

  if (!updated) {
    throw new ApiError(400, 'Cannot check-in: this booking is no longer in a check-in-able status');
  }

  eventBus.emit(EVENTS.CHECK_IN_COMPLETED, {
    bookingId: updated._id.toString(),
    clientId,
  });

  return toPublicBookingDto(updated);
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

  return toPublicBookingDto(updated);
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
  // docs/AUDIT_2026_09_FULL_SYSTEM.md finding X7.
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
    ['completed', 'in-progress'],
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
  } catch (_err) {
    // Non-fatal
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

  const updated = await bookingRepository.transitionStatus(bookingId, ['disputed'], {
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

  // If refund is required, execute via paymentService. On a genuine split/partial outcome
  // the stylist keeps their normal fee-split share of whatever is NOT refunded to the
  // client (MONEY_AND_LEDGER.md Section 4.2, e.g. 750 EGP retained * 0.85 = 637.50 EGP to
  // the stylist) -- arbitration should not silently zero out a stylist's earnings on
  // whatever portion of the booking the admin decided they keep.
  if (finalRefundPercentage > 0) {
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
    ['disputed'],
    {
      status: targetStatus,
      // Only set completedAt if this booking has never completed before (it can reach
      // 'completed' via dispute resolution having been filed from 'in-progress', i.e. it
      // never went through mutual confirmation). If it already has one, preserve it --
      // rewriting it to `new Date()` on every resolution used to restart the 48h
      // dispute-filing window each time, which combined with no reopen guard is what made
      // disputes re-openable indefinitely. See docs/AUDIT_2026_09_FULL_SYSTEM.md finding X7.
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
  // docs/AUDIT_2026_09_FULL_SYSTEM.md finding X10. The correct paths from here are mutual
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
      ['confirmed'],
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

    // Stylist cancellation accrues a penalty debt — 3% early, 20% late. The reason type
    // must follow the tier: the unique {bookingId, reasonType} index is what makes
    // assessment idempotent, so a hardcoded type would collide across tiers.
    if (outcome.penaltyAmount > 0) {
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

  // If payment was paid, execute refund logic based on cancellation outcome
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

export default {
  createBookingFromOffer,
  getMine,
  getStylistBookings,
  getById,
  checkIn,
  confirmCompletion,
  fileDispute,
  addDisputeEvidence,
  getDisputeDetails,
  getDisputedBookings,
  resolveDispute,
  getCancellationQuote,
  cancelBooking,
};
