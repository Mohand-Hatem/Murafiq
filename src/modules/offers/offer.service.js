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

  if (reqDoc.visibility === 'direct') {
    const reqStylistId = reqDoc.stylistId?._id?.toString() || reqDoc.stylistId?.toString();
    if (reqStylistId !== (stylistUser._id || stylistUser.id).toString()) {
      throw new ApiError(403, 'Forbidden');
    }
  }

  if (reqDoc.status !== 'pending' && reqDoc.status !== 'offered') {
    throw new ApiError(400, `Cannot send offer for request in '${reqDoc.status}' status`);
  }

  // Check request expiration
  if (reqDoc.expiresAt && reqDoc.expiresAt < new Date()) {
    await requestRepository.updateById(requestId, { status: 'expired' });
    throw new ApiError(400, 'Request has expired');
  }

  // Check Stylist Daily Offer Cap only for broadcast offers
  if (reqDoc.visibility === 'broadcast') {
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
        `Daily broadcast offer limit reached (${maxDailyOffers}/day). Try again tomorrow.`
      );
    }
  }

  const reqClientId = reqDoc.clientId._id?.toString() || reqDoc.clientId.toString();

  // Cross-request "one active offer per client" rule
  const activeOffer = await offerRepository.findActiveForClient(
    stylistUser._id || stylistUser.id,
    reqClientId
  );
  if (activeOffer) {
    throw new ApiError(409, 'You already have an active offer open with this client.');
  }

  // 24-hour offer expiration window
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  let newOffer;
  try {
    newOffer = await offerRepository.create({
      requestId,
      stylistId: stylistUser._id || stylistUser.id,
      clientId: reqClientId,
      requestVisibility: reqDoc.visibility || 'direct',
      price: offerData.price,
      duration: offerData.duration,
      message: offerData.message,
      expiresAt,
    });
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, 'You have already submitted an offer for this request.');
    }
    throw err;
  }

  // Transition request status to 'offered'
  await requestRepository.updateById(requestId, { status: 'offered' });

  eventBus.emit(EVENTS.OFFER_CREATED, { offerId: newOffer._id.toString() });

  return toPublicOfferDto(newOffer);
};

// MongoDB can abort an operation for reasons that have nothing to do with a real competing offer —
// e.g. `WriteConflict` / `TransientTransactionError` from ordinary storage-engine catalog activity,
// or a lock-acquisition timeout on a plain read under contention. MongoDB's own driver docs say the
// correct response to a transient-labeled error is to retry, not treat it as a business conflict.
// The ACTUAL "someone else already won" case is the CAS lock in createBookingFromOffer returning
// null, which already throws a real ApiError(409, ...) directly — that one propagates immediately,
// every other ApiError (403/400/404 from validation) does too. Only genuine MongoDB transience retries.
const isTransientMongoError = (err) =>
  err.code === 112 || // WriteConflict
  err.code === 24 || // LockTimeout
  err.hasErrorLabel?.('TransientTransactionError') ||
  err.message?.includes('WriteConflict') ||
  err.message?.includes('Unable to acquire') ||
  err.message?.includes('catalog changes');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const acceptOfferOnce = async (clientUser, offerId) => {
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

  let session;
  try {
    if (mongoose.connection?.readyState === 1) {
      session = await mongoose.startSession();
      session.startTransaction();
      const bookingDoc = await bookingService.createBookingFromOffer(offerId, session);
      await session.commitTransaction();
      return bookingDoc;
    }
    return await bookingService.createBookingFromOffer(offerId, null);
  } catch (err) {
    if (session) {
      try {
        await session.abortTransaction();
      } catch (_) {}
    }
    throw err;
  } finally {
    if (session) {
      try { session.endSession(); } catch (_) {}
    }
  }
};

export const acceptOffer = async (clientUser, offerId) => {
  const MAX_TRANSIENT_RETRIES = 5;
  const RETRY_BACKOFF_MS = 50;
  let bookingDoc;

  for (let attempt = 1; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
    try {
      bookingDoc = await acceptOfferOnce(clientUser, offerId);
      break; // success
    } catch (err) {
      // A real business error (statusCode already set by an ApiError — the CAS lock's genuine 409,
      // or a 400/403/404 from validation) never retries, regardless of attempts remaining.
      if (err.statusCode || !isTransientMongoError(err) || attempt === MAX_TRANSIENT_RETRIES) {
        throw err;
      }
      await sleep(RETRY_BACKOFF_MS * attempt); // small backoff so the contention actually clears
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

// The request's own client comparing competing offers — the actual decision point a broadcast
// request exists for. Full price/stylist comparison, intentionally: sealed-bid (§2.3 of the design
// doc) hides offers from other STYLISTS, never from the client whose request they're bidding on.
export const getOffersForRequest = async (clientUser, requestId) => {
  const reqDoc = await requestRepository.findById(requestId);
  if (!reqDoc) {
    throw new ApiError(404, 'Request not found');
  }

  const reqClientId = reqDoc.clientId._id?.toString() || reqDoc.clientId?.toString();
  if (reqClientId !== (clientUser._id || clientUser.id).toString()) {
    throw new ApiError(403, 'Forbidden');
  }

  const offers = await offerRepository.findAllByRequestId(requestId);
  return offers.map(toPublicOfferDto);
};

export default {
  createOffer,
  acceptOffer,
  rejectOffer,
  getOffersForRequest,
};
