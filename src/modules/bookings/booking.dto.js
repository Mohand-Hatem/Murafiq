import { minutesToTime } from '../../common/utils/timeUtils.js';

// Deliberately NOT toPublicUser (email/phone/role/accountStatus) and NOT
// toPublicClientDto (client-specific fields — rating, verification — that make no sense
// on a stylist and are undefined anyway once the populate below is fixed). A booking
// response only ever needs to show the counterparty's name and photo. This was the fix
// half of docs/AUDIT_2026_09_FULL_SYSTEM.md finding X26: the populate `.select()` was
// requesting nonexistent fields (`nameEn nameAr`, copy-pasted from the governorate
// shape), so `name` came back `undefined` on every booking response -- and simply
// widening that select without ALSO replacing toPublicUser here would have started
// leaking the stylist's email and phone to every client on every booking read.
const toBookingParty = (userDoc) => {
  if (!userDoc || typeof userDoc !== 'object') return userDoc || null;
  return {
    id: (userDoc._id || userDoc.id)?.toString(),
    name: userDoc.name || null,
    profileImage: userDoc.profileImage || null,
  };
};

export const toPublicBookingDto = (bookingDoc) => {
  if (!bookingDoc) return null;
  const doc = bookingDoc.toObject ? bookingDoc.toObject() : bookingDoc;

  const client = toBookingParty(doc.clientId);
  const stylist = toBookingParty(doc.stylistId);

  return {
    id: doc._id?.toString() || doc.id,
    requestId: doc.requestId?.toString() || doc.requestId,
    offerId: doc.offerId?.toString() || doc.offerId,
    client,
    stylist,
    scheduledDate: doc.scheduledDate,
    startTime: minutesToTime(doc.scheduledStartMinute),
    endTime: minutesToTime(doc.scheduledEndMinute),
    meetingLocation: doc.meetingLocation || null,
    price: doc.price,
    duration: doc.duration,
    status: doc.status,
    checkInAt: doc.checkInAt || null,
    checkInLocation: doc.checkInLocation || null,
    clientConfirmedAt: doc.clientConfirmedAt || null,
    stylistConfirmedAt: doc.stylistConfirmedAt || null,
    cancelledBy: doc.cancelledBy || null,
    cancellationReason: doc.cancellationReason || null,
    cancelledAt: doc.cancelledAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

export const toPublicScheduleBlockDto = (blockDoc) => {
  if (!blockDoc) return null;
  const doc = blockDoc.toObject ? blockDoc.toObject() : blockDoc;

  return {
    id: doc._id?.toString() || doc.id,
    stylistId: doc.stylistId?.toString() || doc.stylistId,
    bookingId: doc.bookingId?.toString() || doc.bookingId,
    date: doc.date,
    startTime: minutesToTime(doc.startMinute),
    endTime: minutesToTime(doc.endMinute),
    createdAt: doc.createdAt,
  };
};
