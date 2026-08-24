import requestRepository from './request.repository.js';
import userRepository from '../users/user.repository.js';
import stylistRepository from '../stylists/stylist.repository.js';
import { toPublicRequestDto } from './request.dto.js';
import { getBusinessDayRange } from '../../common/utils/businessDay.util.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import ApiError from '../../common/utils/ApiError.js';
import { ROLES } from '../../common/constants/roles.constant.js';
import { DEFAULT_CAPS } from '../../common/constants/defaults.constant.js';

export const createRequest = async (clientUser, requestData) => {
  const client = await userRepository.findById(clientUser._id || clientUser.id);
  if (!client || client.verification?.status !== 'verified') {
    throw new ApiError(403, 'Your identity must be verified before creating requests');
  }

  const { stylistId, meetingLocation, ...restData } = requestData;

  // 2. Check target stylist's account & verification status
  const targetStylist = await userRepository.findById(stylistId);
  if (!targetStylist || targetStylist.role !== ROLES.STYLIST) {
    throw new ApiError(404, 'Target stylist not found');
  }
  if (targetStylist.verification?.status !== 'verified') {
    throw new ApiError(400, 'Target stylist is not identity-verified');
  }

  // 3. Check completed StylistProfile
  const stylistProfile = await stylistRepository.findByUserId(stylistId);
  if (!stylistProfile) {
    throw new ApiError(400, 'Target stylist has not completed onboarding');
  }

  // 4. Check Client Daily Request Cap (verified: 5/day, unverified: 2/day in Africa/Cairo)
  const { startOfDay, endOfDay } = getBusinessDayRange();
  const dailyCount = await requestRepository.countDailyClientRequests(
    clientUser._id || clientUser.id,
    startOfDay,
    endOfDay
  );

  const isVerified = client.verification?.status === 'verified';
  const maxDailyRequests = isVerified
    ? DEFAULT_CAPS.CLIENT_DAILY_REQUESTS_VERIFIED
    : DEFAULT_CAPS.CLIENT_DAILY_REQUESTS_UNVERIFIED;

  if (dailyCount >= maxDailyRequests) {
    throw new ApiError(
      403,
      `Daily request limit reached (${maxDailyRequests}/day). Try again tomorrow.`
    );
  }

  // Format meeting location
  let formattedLocation = undefined;
  if (meetingLocation) {
    const coords = [
      meetingLocation.lng !== undefined ? meetingLocation.lng : 0,
      meetingLocation.lat !== undefined ? meetingLocation.lat : 0,
    ];
    formattedLocation = {
      address: meetingLocation.address || null,
      country: meetingLocation.country || null,
      governorate: meetingLocation.governorate || null,
      city: meetingLocation.city || null,
      area: meetingLocation.area || null,
      location: { type: 'Point', coordinates: coords },
    };
  }

  // 48-hour expiration window
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  const requestDoc = await requestRepository.create({
    clientId: clientUser._id || clientUser.id,
    stylistId,
    meetingLocation: formattedLocation,
    expiresAt,
    ...restData,
  });

  eventBus.emit(EVENTS.REQUEST_CREATED, { requestId: requestDoc._id.toString() });

  return toPublicRequestDto(requestDoc);
};

export const getMine = async (clientId, queryString) => {
  await requestRepository.expireOldRequests();
  const { items, meta } = await requestRepository.findMine(clientId, queryString);
  return {
    items: items.map(toPublicRequestDto),
    meta,
  };
};

export const getIncoming = async (stylistId, queryString) => {
  await requestRepository.expireOldRequests();
  const { items, meta } = await requestRepository.findIncoming(stylistId, queryString);
  return {
    items: items.map(toPublicRequestDto),
    meta,
  };
};

export const cancelRequest = async (clientId, requestId) => {
  const reqDoc = await requestRepository.findById(requestId);
  if (!reqDoc) {
    throw new ApiError(404, 'Request not found');
  }

  const reqClientId = reqDoc.clientId._id?.toString() || reqDoc.clientId.toString();
  if (reqClientId !== clientId.toString()) {
    throw new ApiError(403, 'Forbidden');
  }

  if (reqDoc.status !== 'pending') {
    throw new ApiError(400, `Cannot cancel request in '${reqDoc.status}' status`);
  }

  const updated = await requestRepository.updateById(requestId, { status: 'cancelled' });
  return toPublicRequestDto(updated);
};

export const declineRequest = async (stylistId, requestId) => {
  const reqDoc = await requestRepository.findById(requestId);
  if (!reqDoc) {
    throw new ApiError(404, 'Request not found');
  }

  const reqStylistId = reqDoc.stylistId._id?.toString() || reqDoc.stylistId.toString();
  if (reqStylistId !== stylistId.toString()) {
    throw new ApiError(403, 'Forbidden');
  }

  if (reqDoc.status !== 'pending') {
    throw new ApiError(400, `Cannot decline request in '${reqDoc.status}' status`);
  }

  const updated = await requestRepository.updateById(requestId, { status: 'rejected' });
  eventBus.emit(EVENTS.REQUEST_DECLINED, { requestId });
  return toPublicRequestDto(updated);
};

export default {
  createRequest,
  getMine,
  getIncoming,
  cancelRequest,
  declineRequest,
};
