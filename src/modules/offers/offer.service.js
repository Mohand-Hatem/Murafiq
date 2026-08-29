import mongoose from 'mongoose';
import offerRepository from './offer.repository.js';
import requestRepository from '../requests/request.repository.js';
import userRepository from '../users/user.repository.js';
import bookingService from '../bookings/booking.service.js';
import entitlementService from '../subscriptions/entitlement.service.js';
import moderationService from '../moderation/moderation.service.js';
import { toPublicOfferDto } from './offer.dto.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import ApiError from '../../common/utils/ApiError.js';
import { OFFER_STATUS, REQUEST_STATUS } from '../../common/constants/statuses.constant.js';

export const createOffer = async (stylistUser, requestId, offerData) => {
  const stylistId = (stylistUser._id || stylistUser.id).toString();
  const stylist = await userRepository.findById(stylistId);
  if (!stylist || stylist.verification?.status !== 'verified') {
    throw new ApiError(403, 'Your identity must be verified before sending offers');
  }

  const reqDoc = await requestRepository.findById(requestId);
  if (!reqDoc) {
    throw new ApiError(404, 'Request not found');
  }

  if (reqDoc.visibility === 'direct') {
    const reqStylistId = reqDoc.stylistId?._id?.toString() || reqDoc.stylistId?.toString();
    if (reqStylistId !== stylistId) {
      throw new ApiError(403, 'Forbidden: This direct request was sent to another stylist');
    }
  }

  if (reqDoc.status !== REQUEST_STATUS.OPEN) {
    throw new ApiError(400, `Cannot send offer for request in '${reqDoc.status}' status`);
  }

  // Check request expiration
  if (reqDoc.expiresAt && reqDoc.expiresAt < new Date()) {
    // An unanswered request PAUSES rather than expiring — the client can reactivate it.
    await requestRepository.updateById(requestId, {
      status: REQUEST_STATUS.PAUSED,
      pausedAt: new Date(),
    });
    throw new ApiError(400, 'This request is no longer open for offers');
  }

  // 1. Check persistent active capacity via Entitlement Service
  const capacityInfo = await entitlementService.capacity(stylistId, 'offers.active', 'stylist');
  if (!capacityInfo.hasCapacity) {
    throw new ApiError(
      403,
      `Active offer capacity reached (${capacityInfo.limit}). Upgrade your plan or withdraw older pending offers.`
    );
  }

  // 2. Enforce max 1 offer from one stylist to one request
  const bidsOnThisRequest = await offerRepository.countByStylistAndRequest(stylistId, requestId);
  if (bidsOnThisRequest >= 1) {
    throw new ApiError(400, 'Maximum of 1 offer per request reached for your account.');
  }

  // 3. Content Safety Scan BEFORE consuming quota — a blocked message must not cost the
  //    stylist one of their limited daily offers. The moderation strike is still recorded,
  //    so repeat abuse still escalates; only the quota burn is avoided.
  if (offerData.message) {
    await moderationService.scanAndEnforce(stylistId, 'OFFER', offerData.message, { requestId });
  }

  // 4. Atomically consume daily offer quota via Entitlement Service (throws 429 if exceeded)
  await entitlementService.consume(stylistId, 'offers.daily', 1, 'stylist');

  const reqClientId = reqDoc.clientId._id?.toString() || reqDoc.clientId.toString();

  // 24-hour standard expiry, 30-day long-stop expiry
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const longStopExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const newOffer = await offerRepository.create({
    requestId,
    stylistId,
    clientId: reqClientId,
    requestVisibility: reqDoc.visibility || 'direct',
    price: offerData.price,
    duration: offerData.duration,
    message: offerData.message,
    status: OFFER_STATUS.PENDING,
    expiresAt,
    longStopExpiresAt,
  });

  // The request STAYS 'OPEN'. It deliberately does not move to an 'offered' state:
  // "has at least one offer" is a count, not a status, and encoding it as a status is
  // what previously hid a broadcast request from every other stylist's feed the moment
  // the first bid landed — defeating competitive bidding entirely (see §B.3/§F.1).
  //
  // $min sets firstOfferAt when the field is absent and never overwrites a later write
  // with an earlier one. Since time only moves forward, this atomically records the
  // FIRST offer's timestamp even under concurrent offer creation — no read-then-write
  // window, which matters because firstOfferAt is what freezes the request from edits.
  await requestRepository.updateById(requestId, {
    $inc: { offerCount: 1 },
    $min: { firstOfferAt: new Date() },
  });

  eventBus.emit(EVENTS.OFFER_CREATED, { offerId: newOffer._id.toString() });

  return toPublicOfferDto(newOffer);
};

export const withdrawOffer = async (stylistUser, offerId) => {
  const stylistId = (stylistUser._id || stylistUser.id).toString();
  const offer = await offerRepository.findById(offerId);
  if (!offer) {
    throw new ApiError(404, 'Offer not found');
  }

  const offerStylistId = (offer.stylistId?._id || offer.stylistId).toString();
  if (offerStylistId !== stylistId) {
    throw new ApiError(403, 'Forbidden: You can only withdraw your own offers');
  }

  if (offer.status !== OFFER_STATUS.PENDING) {
    throw new ApiError(400, `Cannot withdraw offer in '${offer.status}' status`);
  }

  const updated = await offerRepository.updateById(offerId, {
    status: OFFER_STATUS.WITHDRAWN,
  });

  // Decrement request offerCount
  await requestRepository.updateById(offer.requestId, {
    $inc: { offerCount: -1 },
  });

  return toPublicOfferDto(updated);
};

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

  if (offerDoc.status !== OFFER_STATUS.PENDING) {
    throw new ApiError(400, `Cannot accept offer in '${offerDoc.status}' status`);
  }

  if (offerDoc.expiresAt && offerDoc.expiresAt < new Date()) {
    await offerRepository.updateById(offerId, { status: OFFER_STATUS.EXPIRED });
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
      try {
        session.endSession();
      } catch (_) {}
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
      if (err.statusCode || !isTransientMongoError(err) || attempt === MAX_TRANSIENT_RETRIES) {
        throw err;
      }
      await sleep(RETRY_BACKOFF_MS * attempt);
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

  if (offerDoc.status !== OFFER_STATUS.PENDING) {
    throw new ApiError(400, `Cannot reject offer in '${offerDoc.status}' status`);
  }

  const updatedOffer = await offerRepository.updateById(offerId, {
    status: OFFER_STATUS.REJECTED,
  });
  // The request deliberately STAYS OPEN. Rejecting one bid must not reset the request:
  // it may still hold several other live offers the client is comparing.

  eventBus.emit(EVENTS.OFFER_REJECTED, { offerId });

  return toPublicOfferDto(updatedOffer);
};

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
  withdrawOffer,
  acceptOffer,
  rejectOffer,
  getOffersForRequest,
};
