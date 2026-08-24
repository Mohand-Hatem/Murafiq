import mongoose from 'mongoose';
import offerRepository from './offer.repository.js';
import requestRepository from '../requests/request.repository.js';
import userRepository from '../users/user.repository.js';
import bookingService from '../bookings/booking.service.js';
import { toPublicOfferDto } from './offer.dto.js';
import { getBusinessDayRange } from '../../common/utils/businessDay.util.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import ApiError from '../../common/utils/ApiError.js';
import { DEFAULT_CAPS } from '../../common/constants/defaults.constant.js';

export const createOffer = async (stylistUser, requestId, offerData) => {
  const stylist = await userRepository.findById(stylistUser._id || stylistUser.id);
  if (!stylist || stylist.verification?.status !== 'verified') {
    throw new ApiError(403, 'Your identity must be verified before sending offers');
  }

  const reqDoc = await requestRepository.findById(requestId);
  if (!reqDoc) {
    throw new ApiError(404, 'Request not found');
  }

  const reqStylistId = reqDoc.stylistId._id?.toString() || reqDoc.stylistId.toString();
  if (reqStylistId !== (stylistUser._id || stylistUser.id).toString()) {
    throw new ApiError(403, 'Forbidden');
  }

  if (reqDoc.status !== 'pending') {
    throw new ApiError(400, `Cannot send offer for request in '${reqDoc.status}' status`);
  }

  // Check request expiration
  if (reqDoc.expiresAt && reqDoc.expiresAt < new Date()) {
    await requestRepository.updateById(requestId, { status: 'expired' });
    throw new ApiError(400, 'Request has expired');
  }

  // 2. Check Stylist Daily Offer Cap (Africa/Cairo)
  const { startOfDay, endOfDay } = getBusinessDayRange();
  const dailyCount = await offerRepository.countDailyStylistOffers(
    stylistUser._id || stylistUser.id,
    startOfDay,
    endOfDay
  );

  const maxDailyOffers = DEFAULT_CAPS.STYLIST_DAILY_OFFERS;
  if (dailyCount >= maxDailyOffers) {
    throw new ApiError(
      403,
      `Daily offer limit reached (${maxDailyOffers}/day). Try again tomorrow.`
    );
  }

  const reqClientId = reqDoc.clientId._id?.toString() || reqDoc.clientId.toString();

  // 3. Cross-request "one active offer per client" rule
  const activeOffer = await offerRepository.findActiveForClient(
    stylistUser._id || stylistUser.id,
    reqClientId
  );
  if (activeOffer) {
    throw new ApiError(409, 'You already have an active offer open with this client.');
  }

  // 24-hour offer expiration window
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const newOffer = await offerRepository.create({
    requestId,
    stylistId: stylistUser._id || stylistUser.id,
    clientId: reqClientId,
    price: offerData.price,
    duration: offerData.duration,
    message: offerData.message,
    expiresAt,
  });

  // Transition request status to 'offered'
  await requestRepository.updateById(requestId, { status: 'offered' });

  eventBus.emit(EVENTS.OFFER_CREATED, { offerId: newOffer._id.toString() });

  return toPublicOfferDto(newOffer);
};

export const acceptOffer = async (clientUser, offerId) => {
  const offerDoc = await offerRepository.findById(offerId);
  if (!offerDoc) {
    throw new ApiError(404, 'Offer not found');
  }

  const offerClientId = offerDoc.clientId._id?.toString() || offerDoc.clientId.toString();
  if (offerClientId !== (clientUser._id || clientUser.id).toString()) {
    throw new ApiError(403, 'Forbidden');
  }

  if (offerDoc.status !== 'pending') {
    throw new ApiError(400, `Cannot accept offer in '${offerDoc.status}' status`);
  }

  if (offerDoc.expiresAt && offerDoc.expiresAt < new Date()) {
    await offerRepository.updateById(offerId, { status: 'expired' });
    throw new ApiError(400, 'Offer has expired');
  }

  let bookingDoc;
  let session;
  try {
    if (mongoose.connection?.readyState === 1) {
      session = await mongoose.startSession();
      session.startTransaction();
      bookingDoc = await bookingService.createBookingFromOffer(offerId, session);
      await session.commitTransaction();
    } else {
      bookingDoc = await bookingService.createBookingFromOffer(offerId, null);
    }
  } catch (err) {
    if (session) {
      try { await session.abortTransaction(); } catch (_) {}
    }
    throw err;
  } finally {
    if (session) {
      try { session.endSession(); } catch (_) {}
    }
  }

  eventBus.emit(EVENTS.OFFER_ACCEPTED, { offerId });
  eventBus.emit(EVENTS.BOOKING_CREATED, { bookingId: bookingDoc.id || bookingDoc._id });

  return bookingDoc;
};

export const rejectOffer = async (clientUser, offerId) => {
  const offerDoc = await offerRepository.findById(offerId);
  if (!offerDoc) {
    throw new ApiError(404, 'Offer not found');
  }

  const offerClientId = offerDoc.clientId._id?.toString() || offerDoc.clientId.toString();
  if (offerClientId !== (clientUser._id || clientUser.id).toString()) {
    throw new ApiError(403, 'Forbidden');
  }

  if (offerDoc.status !== 'pending') {
    throw new ApiError(400, `Cannot reject offer in '${offerDoc.status}' status`);
  }

  const updatedOffer = await offerRepository.updateById(offerId, { status: 'rejected' });
  // Reset request status back to 'pending' so stylist can re-offer or decline
  await requestRepository.updateById(offerDoc.requestId, { status: 'pending' });

  eventBus.emit(EVENTS.OFFER_REJECTED, { offerId });

  return toPublicOfferDto(updatedOffer);
};

export default {
  createOffer,
  acceptOffer,
  rejectOffer,
};
