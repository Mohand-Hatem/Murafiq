import { deriveCashOtp } from '../../common/utils/cashOtp.util.js';
import { minutesToTime } from '../../common/utils/timeUtils.js';
import { getAppointmentDateTime, getAppointmentEndDateTime } from '../../common/utils/appointmentTime.util.js';

// Deliberately NOT toPublicUser (email/phone/role/accountStatus) and NOT
// toPublicClientDto (client-specific fields — rating, verification — that make no sense
// on a stylist and are undefined anyway once the populate below is fixed). A booking
// response only ever needs to show the counterparty's name and photo. This was the fix
// half of docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X26: the populate `.select()` was
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

export const toPublicBookingDto = (bookingDoc, requestingUser = null) => {
  if (!bookingDoc) return null;
  const doc = bookingDoc.toObject ? bookingDoc.toObject() : bookingDoc;

  const client = toBookingParty(doc.clientId);
  const stylist = toBookingParty(doc.stylistId);

  const requestingUserId = requestingUser ? (requestingUser._id || requestingUser.id)?.toString() : null;
  const stylistId = (doc.stylistId?._id || doc.stylistId?.id || doc.stylistId)?.toString();

  const isStylist = Boolean(requestingUserId) && Boolean(stylistId) && requestingUserId === stylistId;
  const showOtp = isStylist && doc.bookingMode === 'demo' && doc.status === 'in-progress' && !doc.cashCollectedAt;

  // The service session starts at the SECOND check-in and is expected to run `duration`
  // minutes. Informational only (drives the client countdown): nothing on the server acts on it.
  const clientCheckInAt = doc.clientCheckInAt || null;
  const stylistCheckInAt = doc.stylistCheckInAt || null;
  const sessionStartedAt =
    clientCheckInAt && stylistCheckInAt
      ? new Date(Math.max(new Date(clientCheckInAt).getTime(), new Date(stylistCheckInAt).getTime()))
      : null;
  const sessionExpectedEndAt =
    sessionStartedAt && doc.duration ? new Date(sessionStartedAt.getTime() + doc.duration * 60 * 1000) : null;

  // Who raised the dispute, so the app can tell "Admin Review" (system) from "Disputed". Evidence
  // stays on GET /bookings/:id/dispute. The schema defaults disputeDetails.type on every booking,
  // so raisedAt is what marks a booking that was actually disputed.
  const details = doc.disputeDetails;
  const clientId = (doc.clientId?._id || doc.clientId)?.toString();
  const raiser = details?.raisedBy ? (details.raisedBy._id || details.raisedBy).toString() : null;
  const dispute = details?.raisedAt
    ? {
        type: details.type,
        reason: details.reason,
        raisedAt: details.raisedAt,
        raisedBy: !raiser ? 'system' : raiser === clientId ? 'client' : raiser === stylistId ? 'stylist' : 'admin',
      }
    : null;

  return {
    id: doc._id?.toString() || doc.id,
    requestId: doc.requestId?.toString() || doc.requestId,
    offerId: doc.offerId?.toString() || doc.offerId,
    bookingMode: doc.bookingMode || 'standard',
    client,
    stylist,
    scheduledDate: doc.scheduledDate,
    startTime: minutesToTime(doc.scheduledStartMinute),
    endTime: minutesToTime(doc.scheduledEndMinute),
    // Real instants (Cairo calendar day + minutes), so the app never does the timezone math.
    scheduledStartAt: doc.scheduledDate ? getAppointmentDateTime(doc) : null,
    scheduledEndAt: doc.scheduledDate ? getAppointmentEndDateTime(doc) : null,
    // For countdowns and overtime: compare against this, not the device clock.
    serverTime: new Date(),
    meetingLocation: doc.meetingLocation || null,
    price: doc.price,
    duration: doc.duration,
    status: doc.status,
    // Only set while the booking is awaiting payment; null otherwise.
    paymentExpiresAt: doc.paymentExpiresAt || null,
    checkInAt: doc.checkInAt || null,
    checkInLocation: doc.checkInLocation || null,
    // Attendance: one timestamp set while 'confirmed' means that party is waiting for the other.
    clientCheckInAt,
    stylistCheckInAt,
    clientCheckInLocation: doc.clientCheckInLocation || null,
    stylistCheckInLocation: doc.stylistCheckInLocation || null,
    sessionStartedAt,
    sessionExpectedEndAt,
    cashCollectedAt: doc.cashCollectedAt || null,
    // cashOtpPlain exists only on bookings checked in before the OTP became derived.
    ...(showOtp ? { cashOtp: doc.cashOtpPlain || deriveCashOtp(doc._id) } : {}),
    clientConfirmedAt: doc.clientConfirmedAt || null,
    stylistConfirmedAt: doc.stylistConfirmedAt || null,
    cancelledBy: doc.cancelledBy || null,
    cancellationReason: doc.cancellationReason || null,
    cancelledAt: doc.cancelledAt || null,
    dispute,
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
