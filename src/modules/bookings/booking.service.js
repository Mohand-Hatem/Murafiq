import bookingRepository from './booking.repository.js';
import scheduleRepository from './schedule.repository.js';
import requestRepository from '../requests/request.repository.js';
import offerRepository from '../offers/offer.repository.js';
import paymentRepository from '../payments/payment.repository.js';
import paymentService, { round2 } from '../payments/payment.service.js';
import { toPublicBookingDto } from './booking.dto.js';
import { timeToMinutes } from '../../common/utils/timeUtils.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import ApiError from '../../common/utils/ApiError.js';
import { ROLES } from '../../common/constants/roles.constant.js';
import { PAYMENT_STATUS, CANCELLATION_POLICY } from '../../common/constants/statuses.constant.js';
import env from '../../config/env.config.js';

export const createBookingFromOffer = async (offerId, session = null) => {
  const offer = await offerRepository.findById(offerId);
  if (!offer) {
    throw new ApiError(404, 'Offer not found');
  }

  const requestDoc = await requestRepository.findById(offer.requestId);
  if (!requestDoc) {
    throw new ApiError(404, 'Associated request not found');
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

  // Create booking
  const bookingDoc = await bookingRepository.create(
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

  // Block the stylist's schedule
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

  // Update Request & Offer statuses to 'accepted'
  await requestRepository.updateById(requestDoc._id, { status: 'accepted' }, session);
  await offerRepository.updateById(offer._id, { status: 'accepted' }, session);

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
  }

  const updated = await bookingRepository.updateById(bookingId, updateData);

  if (updateData.status === 'completed') {
    eventBus.emit(EVENTS.SESSION_COMPLETED, { bookingId: updated._id.toString() });
  }

  return toPublicBookingDto(updated);
};

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

  const updated = await bookingRepository.updateById(bookingId, {
    status: 'disputed',
  });

  eventBus.emit(EVENTS.SESSION_DISPUTED, {
    bookingId: updated._id.toString(),
    reason: disputeData.reason,
    type: disputeData.type || 'general',
  });

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

  if (booking.status === 'completed' || booking.status === 'cancelled') {
    throw new ApiError(400, `Cannot cancel a booking in '${booking.status}' status`);
  }

  // Release schedule block
  await scheduleRepository.deleteByBookingId(bookingId);

  const updated = await bookingRepository.updateById(bookingId, {
    status: 'cancelled',
    cancelledBy,
    cancellationReason: cancelData.reason || undefined,
    cancelledAt: new Date(),
  });

  // If payment was paid, execute refund logic based on cancellation policy
  const payment = await paymentRepository.findByBookingId(bookingId);
  if (payment && payment.status === PAYMENT_STATUS.PAID) {
    let refundPercentage = 100;
    if (cancelledBy === 'client') {
      const scheduledDateTime = new Date(booking.scheduledDate);
      if (booking.scheduledStartMinute) {
        scheduledDateTime.setMinutes(scheduledDateTime.getMinutes() + booking.scheduledStartMinute);
      }
      const hoursUntilSession = (scheduledDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilSession < CANCELLATION_POLICY.FULL_REFUND_HOURS) {
        refundPercentage = CANCELLATION_POLICY.PARTIAL_REFUND_PERCENTAGE; // 75%
      }
    }
    await paymentService.processRefund({
      bookingId,
      refundPercentage,
      reason: cancelData.reason || `Booking cancelled by ${cancelledBy}`,
    });
  }

  eventBus.emit(EVENTS.BOOKING_CANCELLED, { bookingId: updated._id.toString(), cancelledBy });

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
  cancelBooking,
};
