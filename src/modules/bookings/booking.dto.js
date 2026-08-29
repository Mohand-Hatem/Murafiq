import { toPublicUser } from '../auth/auth.dto.js';
import { toPublicClientDto } from '../users/user.dto.js';
import { minutesToTime } from '../../common/utils/timeUtils.js';

export const toPublicBookingDto = (bookingDoc) => {
  if (!bookingDoc) return null;
  const doc = bookingDoc.toObject ? bookingDoc.toObject() : bookingDoc;

  const client = doc.clientId && typeof doc.clientId === 'object' ? toPublicClientDto(doc.clientId) : doc.clientId;
  const stylist = doc.stylistId && typeof doc.stylistId === 'object' ? toPublicUser(doc.stylistId) : doc.stylistId;

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
