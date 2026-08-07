import { toPublicUser } from '../auth/auth.dto.js';

export const toPublicRequestDto = (requestDoc) => {
  if (!requestDoc) return null;
  const doc = requestDoc.toObject ? requestDoc.toObject() : requestDoc;

  const client = doc.clientId && typeof doc.clientId === 'object' ? toPublicUser(doc.clientId) : doc.clientId;
  const stylist = doc.stylistId && typeof doc.stylistId === 'object' ? toPublicUser(doc.stylistId) : doc.stylistId;

  return {
    id: doc._id?.toString() || doc.id,
    client,
    stylist,
    title: doc.title,
    date: doc.date || null,
    time: doc.time || null,
    meetingLocation: doc.meetingLocation || null,
    description: doc.description || '',
    budgetRange: doc.budgetRange || null,
    images: doc.images || [],
    status: doc.status,
    expiresAt: doc.expiresAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};
