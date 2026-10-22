import { toPublicUser } from '../auth/auth.dto.js';

// Latin, Arabic-Indic and Persian digits. A price typed into the message text would otherwise
// defeat the hidden price.
const DIGITS = /[0-9٠-٩۰-۹]+/g;
export const maskDigits = (text) => (text || '').replace(DIGITS, '•••');

/**
 * What a COMPETING stylist may see of another stylist's offer: message and a minimal stylist
 * card. Deliberately NOT built on toPublicUser (it carries email/phone) and never includes
 * price or duration (duration x hourly rate would reveal the price).
 */
export const toCompetingOfferDto = (offerDoc, stylistProfile, viewerId) => {
  const doc = offerDoc.toObject ? offerDoc.toObject() : offerDoc;
  const stylist = doc.stylistId;
  const stylistId = (stylist._id || stylist).toString();

  return {
    id: doc._id.toString(),
    message: maskDigits(doc.message),
    createdAt: doc.createdAt,
    isMine: stylistId === viewerId,
    stylist: {
      id: stylistId,
      name: stylist.name,
      profileImage: stylist.profileImage,
      rating: stylistProfile?.rating ?? 0,
      totalReviews: stylistProfile?.totalReviews ?? 0,
    },
  };
};

/** A stylist's own offer (so its price is theirs to see) plus a summary of the request. */
export const toMyOfferDto = (offerDoc) => {
  const doc = offerDoc.toObject ? offerDoc.toObject() : offerDoc;
  const request = doc.requestId && typeof doc.requestId === 'object' ? doc.requestId : null;

  return {
    id: doc._id.toString(),
    requestId: (request?._id || doc.requestId).toString(),
    price: doc.price,
    duration: doc.duration,
    message: doc.message || '',
    status: doc.status,
    createdAt: doc.createdAt,
    request: request && {
      id: request._id.toString(),
      title: request.title,
      date: request.date || null,
      time: request.time || null,
      status: request.status,
      visibility: request.visibility,
      offerCount: request.offerCount ?? 0,
    },
  };
};

export const toPublicOfferDto = (offerDoc) => {
  if (!offerDoc) return null;
  const doc = offerDoc.toObject ? offerDoc.toObject() : offerDoc;

  const stylist = doc.stylistId && typeof doc.stylistId === 'object' ? toPublicUser(doc.stylistId) : doc.stylistId;
  const client = doc.clientId && typeof doc.clientId === 'object' ? toPublicUser(doc.clientId) : doc.clientId;

  return {
    id: doc._id?.toString() || doc.id,
    requestId: doc.requestId?.toString() || doc.requestId,
    stylist,
    client,
    price: doc.price,
    duration: doc.duration,
    message: doc.message || '',
    status: doc.status,
    expiresAt: doc.expiresAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};
