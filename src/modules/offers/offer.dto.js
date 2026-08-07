import { toPublicUser } from '../auth/auth.dto.js';

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
