import mongoose from 'mongoose';
import bookingRepository from './booking.repository.js';
import scheduleRepository from './schedule.repository.js';
import requestRepository from '../requests/request.repository.js';
import offerRepository from '../offers/offer.repository.js';
import paymentRepository from '../payments/payment.repository.js';
import paymentService, { round2 } from '../payments/payment.service.js';
import penaltyRepository from '../penalties/penalty.repository.js';
import ledgerService, { egpToPiastres } from '../ledger/ledger.service.js';
import chatService from '../chat/chat.service.js';
import moderationService from '../moderation/moderation.service.js';
import reliabilityService from '../stylists/reliability.service.js';
import { toPublicBookingDto } from './booking.dto.js';
import { timeToMinutes } from '../../common/utils/timeUtils.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import ApiError from '../../common/utils/ApiError.js';
import { ROLES } from '../../common/constants/roles.constant.js';
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

  const userIdStr = (user._id || user.id).toString();
  const clientIdStr = (booking.clientId._id || booking.clientId).toString();
  const stylistIdStr = (booking.stylistId._id || booking.stylistId).toString();

  if (user.role !== ROLES.ADMIN && userIdStr !== clientIdStr && userIdStr !== stylistIdStr) {
    throw new ApiError(403, 'Forbidden');
  }

  return toPublicBookingDto(booking);
};

export const checkIn = async (user, bookingId, locationData = {}) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  const userIdStr = (user._id || user.id).toString();
  const clientIdStr = (booking.clientId._id || booking.clientId).toString();
  const stylistIdStr = (booking.stylistId._id || booking.stylistId).toString();

  if (userIdStr !== clientIdStr && userIdStr !== stylistIdStr) {
    throw new ApiError(403, 'Forbidden');
  }

  if (booking.status !== 'confirmed' && booking.status !== 'in-progress') {
    throw new ApiError(400, `Cannot check-in to a booking in '${booking.status}' status`);
  }

  // Payment Gate: Booking must be paid before check-in is permitted
  const payment = await paymentRepository.findByBookingId(bookingId);
  if (!payment || payment.status !== PAYMENT_STATUS.PAID) {
    throw new ApiError(400, 'Payment must be completed before check-in');
  }

  const updateData = {
    checkInAt: new Date(),
    status: 'in-progress',
  };

  if (locationData.lat !== undefined && locationData.lng !== undefined) {
    updateData.checkInLocation = { lat: locationData.lat, lng: locationData.lng };
  }

  const updated = await bookingRepository.updateById(bookingId, updateData);

  eventBus.emit(EVENTS.CHECK_IN_COMPLETED, {
    bookingId: updated._id.toString(),
    clientId: clientIdStr,
  });

  return toPublicBookingDto(updated);
};

export const confirmCompletion = async (user, bookingId) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  const userIdStr = (user._id || user.id).toString();
  const clientIdStr = (booking.clientId._id || booking.clientId).toString();
  const stylistIdStr = (booking.stylistId._id || booking.stylistId).toString();

  if (userIdStr !== clientIdStr && userIdStr !== stylistIdStr) {
    throw new ApiError(403, 'Forbidden');
  }

  if (booking.status !== 'in-progress') {
    throw new ApiError(
      400,
      `Cannot confirm completion of a booking in '${booking.status}' status. Session must be in-progress.`
    );
  }

  const updateData = {};
  if (userIdStr === clientIdStr) {
    updateData.clientConfirmedAt = new Date();
  }
  if (userIdStr === stylistIdStr) {
    updateData.stylistConfirmedAt = new Date();
  }

  const isClientDone = updateData.clientConfirmedAt || booking.clientConfirmedAt;
  const isStylistDone = updateData.stylistConfirmedAt || booking.stylistConfirmedAt;

  if (isClientDone && isStylistDone) {
    updateData.status = 'completed';
    updateData.completedAt = new Date();
  }

  const updated = await bookingRepository.updateById(bookingId, updateData);

  if (updateData.status === 'completed') {
    eventBus.emit(EVENTS.SESSION_COMPLETED, { bookingId: updated._id.toString() });
  }

  return toPublicBookingDto(updated);
};

const DISPUTE_WINDOW_HOURS = 48;

export const fileDispute = async (user, bookingId, disputeData) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  const userIdStr = (user._id || user.id).toString();
  const clientIdStr = (booking.clientId._id || booking.clientId).toString();
  const stylistIdStr = (booking.stylistId._id || booking.stylistId).toString();

  if (userIdStr !== clientIdStr && userIdStr !== stylistIdStr && user.role !== ROLES.ADMIN) {
    throw new ApiError(403, 'Forbidden');
  }

  if (booking.status === 'disputed') {
    throw new ApiError(409, 'Booking is already disputed');
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

  const updated = await bookingRepository.updateById(bookingId, {
    status: 'disputed',
    disputeDetails: {
      raisedBy: user._id || user.id,
      reason: disputeData.reason,
      type: disputeData.type || 'general',
      raisedAt: new Date(),
      evidence: disputeData.evidence || [],
    },
  });

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

  const userId = (user._id || user.id).toString();
  const clientId = (booking.clientId._id || booking.clientId).toString();
  const stylistId = (booking.stylistId._id || booking.stylistId).toString();

  if (userId !== clientId && userId !== stylistId && user.role !== ROLES.ADMIN) {
    throw new ApiError(403, 'Forbidden: You are not a participant in this booking');
  }

  if (text) {
    await moderationService.scanAndEnforce(userId, 'MESSAGE', text, { bookingId });
  }

  const evidenceEntry = {
    submittedBy: userId,
    text: text ? text.trim() : undefined,
    images: Array.isArray(images) ? images : [],
    submittedAt: new Date(),
  };

  const updated = await bookingRepository.updateById(bookingId, {
    $push: { 'disputeDetails.evidence': evidenceEntry },
  });

  return toPublicBookingDto(updated);
};

export const getDisputeDetails = async (user, bookingId) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  const userId = (user._id || user.id).toString();
  const clientId = (booking.clientId._id || booking.clientId).toString();
  const stylistId = (booking.stylistId._id || booking.stylistId).toString();

  if (userId !== clientId && userId !== stylistId && user.role !== ROLES.ADMIN) {
    throw new ApiError(403, 'Forbidden');
  }

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

  // If refund is required, execute via paymentService
  if (finalRefundPercentage > 0) {
    await paymentService.processRefund({
      bookingId,
      refundPercentage: finalRefundPercentage,
      reason: resolutionNotes || `Dispute arbitration resolution: ${outcome}`,
    });
  }

  const updated = await bookingRepository.updateById(bookingId, {
    status: targetStatus,
    ...(targetStatus === 'completed' ? { completedAt: new Date() } : {}),
    disputeResolution: {
      outcome,
      refundPercentage: finalRefundPercentage,
      resolutionNotes,
      resolvedBy: adminUserId,
      resolvedAt: new Date(),
    },
  });

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
    eventBus.emit(EVENTS.SESSION_COMPLETED, { bookingId: updated._id.toString() });
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

export const calculateCancellationOutcome = (booking, cancelledByRole, now = new Date()) => {
  const appointmentTime = getAppointmentDateTime(booking);
  const diffHours = (appointmentTime.getTime() - now.getTime()) / (1000 * 60 * 60);
  const isEarly = diffHours >= CANCELLATION_POLICY.EARLY_HOURS; // 24 hours

  const bookingPrice = booking.price || 0;

  if (cancelledByRole === 'client') {
    if (isEarly) {
      const refundPercentage = CANCELLATION_POLICY.EARLY_CLIENT_REFUND_PERCENTAGE; // 97%
      const refundAmount = round2(bookingPrice * (refundPercentage / 100));
      const platformFeeAmount = round2(bookingPrice - refundAmount);
      return {
        hoursUntilSession: diffHours,
        isEarly,
        refundPercentage,
        refundAmount,
        platformFeeAmount,
        stylistCompensationAmount: 0,
        penaltyAmount: 0,
        couponEligible: false,
        tier: 'EARLY_CLIENT_CANCEL',
      };
    }
    // Client cancels < 24h: platform retains 20%, client refunded 80%, stylist gets
    // NOTHING. A stylist who has not yet travelled has not incurred the loss that the
    // no-show policy exists to compensate — see §H.
    const refundPercentage = CANCELLATION_POLICY.LATE_CLIENT_REFUND_PERCENTAGE; // 80%
    const refundAmount = round2(bookingPrice * (refundPercentage / 100));
    const platformFeeAmount = round2(bookingPrice - refundAmount); // 20%
    return {
      hoursUntilSession: diffHours,
      isEarly,
      refundPercentage,
      refundAmount,
      platformFeeAmount,
      stylistCompensationAmount: 0,
      penaltyAmount: 0,
      couponEligible: false,
      tier: 'LATE_CLIENT_CANCEL',
    };
  }

  // Cancelled by Stylist — the client is always refunded in full and never bears the
  // cost. The stylist accrues a penalty debt instead, settled against a future payout.
  if (isEarly) {
    return {
      hoursUntilSession: diffHours,
      isEarly,
      refundPercentage: 100,
      refundAmount: bookingPrice,
      platformFeeAmount: 0,
      stylistCompensationAmount: 0,
      penaltyAmount: round2(
        bookingPrice * (CANCELLATION_POLICY.EARLY_STYLIST_PENALTY_PERCENTAGE / 100)
      ), // 3%
      couponEligible: false,
      tier: 'EARLY_STYLIST_CANCEL',
    };
  }
  const penaltyAmount = round2(
    bookingPrice * (CANCELLATION_POLICY.LATE_STYLIST_PENALTY_PERCENTAGE / 100)
  ); // 20%
  return {
    hoursUntilSession: diffHours,
    isEarly,
    refundPercentage: 100,
    refundAmount: bookingPrice,
    platformFeeAmount: 0,
    stylistCompensationAmount: 0,
    penaltyAmount,
    couponEligible: true,
    tier: 'LATE_STYLIST_CANCEL',
  };
};

export const getCancellationQuote = async (user, bookingId) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  const clientId = (booking.clientId?._id || booking.clientId).toString();
  const stylistId = (booking.stylistId?._id || booking.stylistId).toString();
  const userId = (user._id || user.id).toString();

  let cancelledByRole;
  if (userId === clientId) {
    cancelledByRole = 'client';
  } else if (userId === stylistId) {
    cancelledByRole = 'stylist';
  } else if (user.role === 'admin') {
    cancelledByRole = 'client';
  } else {
    throw new ApiError(403, 'Forbidden');
  }

  const outcome = calculateCancellationOutcome(booking, cancelledByRole, new Date());
  return {
    bookingId: booking._id,
    cancelledByRole,
    ...outcome,
  };
};

export const cancelBooking = async (param1, param2, cancelData = {}) => {
  let user;
  let bookingId;
  if (typeof param1 === 'string' || (param1 && !param1.role && !param1.email)) {
    bookingId = param1;
    user = param2;
  } else {
    user = param1;
    bookingId = param2;
  }

  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  const clientId = (booking.clientId?._id || booking.clientId).toString();
  const stylistId = (booking.stylistId?._id || booking.stylistId).toString();
  const userId = (user?._id || user?.id || user || '').toString();

  let cancelledBy;
  if (userId === clientId) {
    cancelledBy = 'client';
  } else if (userId === stylistId) {
    cancelledBy = 'stylist';
  } else if (user.role === 'admin') {
    cancelledBy = 'admin';
  } else {
    throw new ApiError(403, 'Forbidden');
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

  const outcome = calculateCancellationOutcome(booking, cancelledBy, new Date());

  let session = null;
  let updated;
  try {
    if (mongoose.connection?.readyState === 1) {
      session = await mongoose.startSession();
      session.startTransaction();
    }

    const currentBooking = await bookingRepository.findById(bookingId, session);
    if (!currentBooking) {
      throw new ApiError(404, 'Booking not found');
    }
    if (
      BOOKING_TERMINAL_STATUSES.includes(currentBooking.status) ||
      currentBooking.status === 'disputed'
    ) {
      throw new ApiError(400, `Cannot cancel a booking in '${currentBooking.status}' status`);
    }

    await scheduleRepository.deleteByBookingId(bookingId, session);

    updated = await bookingRepository.updateById(
      bookingId,
      {
        status: 'cancelled',
        cancelledBy,
        cancellationReason: cancelData.reason || undefined,
        cancelledAt: new Date(),
      },
      session
    );

    // Stylist cancellation accrues a penalty debt — 3% early, 20% late. The reason type
    // must follow the tier: the unique {bookingId, reasonType} index is what makes
    // assessment idempotent, so a hardcoded type would collide across tiers.
    if (outcome.penaltyAmount > 0) {
      await penaltyRepository.create(
        {
          stylistId: booking.stylistId._id || booking.stylistId,
          bookingId: booking._id,
          reasonType: outcome.tier === 'EARLY_STYLIST_CANCEL' ? 'EARLY_CANCEL' : 'LATE_CANCEL',
          assessedMinor: egpToPiastres(outcome.penaltyAmount),
          status: 'OUTSTANDING',
        },
        session
      );
    }

    if (session) {
      await session.commitTransaction();
    }
  } catch (err) {
    if (session) {
      try {
        await session.abortTransaction();
      } catch (_) {}
    }
    throw err;
  } finally {
    if (session) {
      try {
        session.endSession();
      } catch (_) {}
    }
  }

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

  // Dual-write penalty to ledger if assessed.
  // entryType must be 'PENALTY_ASSESSMENT' — 'PENALTY' is not in the LedgerEntry enum,
  // so it failed validation and was swallowed by this catch on every cancellation.
  if (outcome.penaltyAmount > 0) {
    const isEarlyCancel = outcome.tier === 'EARLY_STYLIST_CANCEL';
    const penaltyPct = isEarlyCancel
      ? CANCELLATION_POLICY.EARLY_STYLIST_PENALTY_PERCENTAGE
      : CANCELLATION_POLICY.LATE_STYLIST_PENALTY_PERCENTAGE;
    try {
      await ledgerService.postEntry({
        idempotencyKey: `penalty:${isEarlyCancel ? 'early' : 'late'}_cancel:${bookingId}`,
        entryType: 'PENALTY_ASSESSMENT',
        accountType: 'STYLIST',
        accountId: (booking.stylistId._id || booking.stylistId).toString(),
        direction: 'DEBIT',
        amountMinor: egpToPiastres(outcome.penaltyAmount),
        bookingId,
        correlationId: `booking_${bookingId}`,
        notes: `Stylist cancellation penalty (${penaltyPct}%) for booking #${bookingId}`,
      });
    } catch (ledgerErr) {
      logger.error(`[Ledger Dual-Write Warning] ${ledgerErr.message}`);
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
