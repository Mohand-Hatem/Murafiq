import mongoose from 'mongoose';
import bookingRepository from './booking.repository.js';
import scheduleRepository from './schedule.repository.js';
import requestRepository from '../requests/request.repository.js';
import offerRepository from '../offers/offer.repository.js';
import paymentRepository from '../payments/payment.repository.js';
import paymentService, { round2 } from '../payments/payment.service.js';
import chatService from '../chat/chat.service.js';
import { toPublicBookingDto } from './booking.dto.js';
import { timeToMinutes } from '../../common/utils/timeUtils.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import ApiError from '../../common/utils/ApiError.js';
import { ROLES } from '../../common/constants/roles.constant.js';
import { PAYMENT_STATUS, CANCELLATION_POLICY } from '../../common/constants/statuses.constant.js';
import getBusinessDayRange from '../../common/utils/businessDay.util.js';
import env from '../../config/env.config.js';
import logger from '../../config/logger.config.js';

export const createBookingFromOffer = async (offerId, session = null) => {
  const offer = await offerRepository.findById(offerId, session);
  if (!offer) {
    throw new ApiError(404, 'Offer not found');
  }

  if (offer.status !== 'pending') {
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
  await offerRepository.updateById(offer._id, { status: 'accepted' }, session);

  // Close all competing sibling offers on this request
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
  if (outcome === 'cancelled') {
    finalRefundPercentage = refundPercentage > 0 ? refundPercentage : 100;
  } else if (outcome === 'completed') {
    finalRefundPercentage = refundPercentage;
  }

  // If refund is required, execute via paymentService
  if (finalRefundPercentage > 0) {
    await paymentService.processRefund({
      bookingId,
      refundPercentage: finalRefundPercentage,
      reason: resolutionNotes,
    });
  }

  const targetStatus = outcome === 'cancelled' ? 'cancelled' : 'completed';
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

export const cancelBooking = async (user, bookingId, cancelData = {}) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  const userIdStr = (user._id || user.id).toString();
  const clientIdStr = (booking.clientId._id || booking.clientId).toString();
  const stylistIdStr = (booking.stylistId._id || booking.stylistId).toString();

  let cancelledBy = 'admin';
  if (userIdStr === clientIdStr) cancelledBy = 'client';
  else if (userIdStr === stylistIdStr) cancelledBy = 'stylist';
  else if (user.role !== ROLES.ADMIN) throw new ApiError(403, 'Forbidden');

  if (
    booking.status === 'completed' ||
    booking.status === 'cancelled' ||
    booking.status === 'disputed'
  ) {
    throw new ApiError(
      400,
      `Cannot cancel a booking in '${booking.status}' status. Disputed bookings must be resolved via admin arbitration.`
    );
  }

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
      currentBooking.status === 'completed' ||
      currentBooking.status === 'cancelled' ||
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

  // If payment was paid, execute refund logic based on cancellation policy
  const payment = await paymentRepository.findByBookingId(bookingId);
  if (payment && payment.status === PAYMENT_STATUS.PAID) {
    let refundPercentage = 100;
    if (cancelledBy === 'client') {
      const { startOfDay } = getBusinessDayRange(booking.scheduledDate, 'Africa/Cairo');
      const startMinute =
        booking.scheduledStartMinute !== undefined && booking.scheduledStartMinute !== null
          ? booking.scheduledStartMinute
          : 0;
      const scheduledDateTime = new Date(startOfDay.getTime() + startMinute * 60 * 1000);
      const hoursUntilSession = (scheduledDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilSession < CANCELLATION_POLICY.FULL_REFUND_HOURS) {
        refundPercentage = CANCELLATION_POLICY.PARTIAL_REFUND_PERCENTAGE; // 75%
      }
    }

    try {
      await paymentService.processRefund({
        bookingId,
        refundPercentage,
        reason: cancelData.reason || `Booking cancelled by ${cancelledBy}`,
      });
    } catch (refundErr) {
      await paymentRepository.updateById(payment._id, {
        refundError: refundErr.message,
        refundFailedAt: new Date(),
      });
      logger.error(`Refund failed after cancellation for booking ${bookingId}: ${refundErr.message}`);
    }
  }

  const stylistUserId = updated.stylistId?._id ? updated.stylistId._id.toString() : updated.stylistId?.toString();
  eventBus.emit(EVENTS.BOOKING_CANCELLED, {
    bookingId: updated._id.toString(),
    cancelledBy,
    stylistId: stylistUserId,
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
  getDisputedBookings,
  resolveDispute,
  cancelBooking,
};
