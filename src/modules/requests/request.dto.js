import { toPublicUser } from '../auth/auth.dto.js';
import { toPublicClientDto } from '../users/user.dto.js';

export const toPublicRequestDto = (requestDoc) => {
  if (!requestDoc) return null;
  const doc = requestDoc.toObject ? requestDoc.toObject() : requestDoc;

  const client = doc.clientId && typeof doc.clientId === 'object' ? toPublicClientDto(doc.clientId) : doc.clientId;
  const stylist = doc.stylistId && typeof doc.stylistId === 'object' ? toPublicUser(doc.stylistId) : doc.stylistId;

  return {
    id: doc._id?.toString() || doc.id,
    client,
    stylist,
    title: doc.title,
    visibility: doc.visibility || 'direct',
    date: doc.date || null,
    time: doc.time || null,
    meetingLocation: doc.meetingLocation || null,
    description: doc.description || '',
    budgetRange: doc.budgetRange || null,
    preferredStylistGender: doc.preferredStylistGender || 'any',
    images: doc.images || [],
    status: doc.status,
    // A count only -- stylists see how contested a request is, never the offers' prices.
    offerCount: doc.offerCount ?? 0,
    expiresAt: doc.expiresAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};
