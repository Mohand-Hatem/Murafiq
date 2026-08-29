import requestRepository from './request.repository.js';
import userRepository from '../users/user.repository.js';
import stylistRepository from '../stylists/stylist.repository.js';
import entitlementService from '../subscriptions/entitlement.service.js';
import moderationService from '../moderation/moderation.service.js';
import { toPublicRequestDto } from './request.dto.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import ApiError from '../../common/utils/ApiError.js';
import { REQUEST_STATUS } from '../../common/constants/statuses.constant.js';
import { ROLES } from '../../common/constants/roles.constant.js';

// A request in one of these states is finished; no further client action applies.
const TERMINAL_REQUEST_STATUSES = [
  REQUEST_STATUS.CLOSED,
  REQUEST_STATUS.FULFILLED,
  REQUEST_STATUS.CANCELLED,
  REQUEST_STATUS.DECLINED,
];

export const createRequest = async (clientUser, requestData) => {
  const clientId = clientUser._id || clientUser.id;
  const client = await userRepository.findById(clientId);
  if (!client || client.verification?.status !== 'verified') {
    throw new ApiError(403, 'Your identity must be verified before creating requests');
  }

  const { stylistId, meetingLocation, visibility = 'direct', ...restData } = requestData;

  // 1. For direct requests: check target stylist's account & verification status
  if (visibility === 'direct') {
    const targetStylist = await userRepository.findById(stylistId);
    if (!targetStylist || targetStylist.role !== ROLES.STYLIST) {
      throw new ApiError(404, 'Target stylist not found');
    }
    if (targetStylist.verification?.status !== 'verified') {
      throw new ApiError(400, 'Target stylist is not identity-verified');
    }

    const stylistProfile = await stylistRepository.findByUserId(stylistId);
    if (!stylistProfile) {
      throw new ApiError(400, 'Target stylist has not completed onboarding');
    }
  }

  // 2. Check persistent active capacity via Entitlement Service
  const capacityInfo = await entitlementService.capacity(clientId, 'requests.active', 'client');
  if (!capacityInfo.hasCapacity) {
    throw new ApiError(
      403,
      `Active request capacity reached (${capacityInfo.limit}). Upgrade your plan or close existing open requests.`
    );
  }

  // 3. Content Safety Scan BEFORE consuming quota.
  //
  // Ordering matters: a blocked message must not cost the client a day's allowance. On the
  // Free plan that is their ONE request, so a single typo containing a phone number would
  // lock them out for 24 hours over content that was never created. Abuse is still
  // deterred — scanAndEnforce records the strike regardless, and repeat offences escalate
  // to RESTRICT and SUSPEND — so nothing is lost by not also burning the quota.
  const fullText = `${requestData.title || ''} ${requestData.description || ''}`.trim();
  if (fullText) {
    await moderationService.scanAndEnforce(clientId.toString(), 'REQUEST', fullText);
  }

  // 4. Atomically consume daily quota via Entitlement Service (throws 429 if exceeded)
  await entitlementService.consume(clientId, 'requests.daily', 1, 'client');

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

  // 48-hour auto-pause timer
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const autoPauseAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const requestDoc = await requestRepository.create({
    clientId,
    visibility,
    stylistId: visibility === 'direct' ? stylistId : null,
    meetingLocation: formattedLocation,
    status: REQUEST_STATUS.OPEN,
    offerCount: 0,
    pauseCount: 0,
    autoPauseAt,
    expiresAt,
    ...restData,
  });

  eventBus.emit(EVENTS.REQUEST_CREATED, { requestId: requestDoc._id.toString() });

  return toPublicRequestDto(requestDoc);
};

export const editRequest = async (clientId, requestId, updateData) => {
  const reqDoc = await requestRepository.findById(requestId);
  if (!reqDoc) {
    throw new ApiError(404, 'Request not found');
  }

  const reqClientId = (reqDoc.clientId?._id || reqDoc.clientId).toString();
  if (reqClientId !== clientId.toString()) {
    throw new ApiError(403, 'Forbidden');
  }

  if (reqDoc.status !== REQUEST_STATUS.OPEN) {
    throw new ApiError(400, `Cannot edit request in '${reqDoc.status}' status`);
  }

  // Immutability Guard: If offers already exist, price/time/scope are frozen
  if (reqDoc.offerCount > 0) {
    const forbiddenFields = ['title', 'description', 'date', 'time', 'meetingLocation', 'budgetRange'];
    const attemptedForbidden = forbiddenFields.filter((f) => updateData[f] !== undefined);

    if (attemptedForbidden.length > 0) {
      throw new ApiError(
        409,
        `Request details are frozen after receiving ${reqDoc.offerCount} offer(s). Only additional images may be attached.`
      );
    }
  }

  const updateFields = {};
  if (updateData.title !== undefined) updateFields.title = updateData.title;
  if (updateData.description !== undefined) updateFields.description = updateData.description;
  if (updateData.date !== undefined) updateFields.date = updateData.date;
  if (updateData.time !== undefined) updateFields.time = updateData.time;
  if (updateData.budgetRange !== undefined) updateFields.budgetRange = updateData.budgetRange;
  if (updateData.images !== undefined) updateFields.images = updateData.images;

  if (updateData.meetingLocation) {
    const loc = updateData.meetingLocation;
    const coords = [loc.lng !== undefined ? loc.lng : 0, loc.lat !== undefined ? loc.lat : 0];
    updateFields.meetingLocation = {
      address: loc.address || null,
      country: loc.country || null,
      governorate: loc.governorate || null,
      city: loc.city || null,
      area: loc.area || null,
      location: { type: 'Point', coordinates: coords },
    };
  }

  const editFullText = `${updateData.title || ''} ${updateData.description || ''}`.trim();
  if (editFullText) {
    await moderationService.scanAndEnforce(clientId.toString(), 'REQUEST', editFullText, { requestId });
  }

  const updated = await requestRepository.updateById(requestId, updateFields);
  return toPublicRequestDto(updated);
};

export const reactivateRequest = async (clientId, requestId) => {
  const reqDoc = await requestRepository.findById(requestId);
  if (!reqDoc) {
    throw new ApiError(404, 'Request not found');
  }

  const reqClientId = (reqDoc.clientId?._id || reqDoc.clientId).toString();
  if (reqClientId !== clientId.toString()) {
    throw new ApiError(403, 'Forbidden');
  }

  if (reqDoc.status !== REQUEST_STATUS.PAUSED) {
    throw new ApiError(400, `Cannot reactivate request in '${reqDoc.status}' status (must be PAUSED)`);
  }

  // Max 3 reactivations ceiling
  if (reqDoc.pauseCount >= 3) {
    await requestRepository.updateById(requestId, { status: REQUEST_STATUS.CLOSED });
    throw new ApiError(
      400,
      'This request has reached the maximum of 3 reactivations and has been permanently closed. Please create a new request.'
    );
  }

  // Check persistent capacity (does NOT consume a new daily quota)
  const capacityInfo = await entitlementService.capacity(clientId, 'requests.active', 'client');
  if (!capacityInfo.hasCapacity) {
    throw new ApiError(
      403,
      `Active request capacity reached (${capacityInfo.limit}). Close another active request to reactivate this one.`
    );
  }

  const now = new Date();
  const autoPauseAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const updated = await requestRepository.updateById(requestId, {
    status: REQUEST_STATUS.OPEN,
    reactivatedAt: now,
    autoPauseAt,
  });

  return toPublicRequestDto(updated);
};

export const closeRequest = async (clientId, requestId) => {
  const reqDoc = await requestRepository.findById(requestId);
  if (!reqDoc) {
    throw new ApiError(404, 'Request not found');
  }

  const reqClientId = (reqDoc.clientId?._id || reqDoc.clientId).toString();
  if (reqClientId !== clientId.toString()) {
    throw new ApiError(403, 'Forbidden');
  }

  if (TERMINAL_REQUEST_STATUSES.includes(reqDoc.status)) {
    throw new ApiError(400, `Cannot close request in terminal status '${reqDoc.status}'`);
  }

  const updated = await requestRepository.updateById(requestId, {
    status: REQUEST_STATUS.CLOSED,
    autoPauseAt: null,
  });

  return toPublicRequestDto(updated);
};

export const cancelRequest = async (clientId, requestId) => {
  const reqDoc = await requestRepository.findById(requestId);
  if (!reqDoc) {
    throw new ApiError(404, 'Request not found');
  }

  const reqClientId = (reqDoc.clientId?._id || reqDoc.clientId).toString();
  if (reqClientId !== clientId.toString()) {
    throw new ApiError(403, 'Forbidden');
  }

  if (TERMINAL_REQUEST_STATUSES.includes(reqDoc.status)) {
    throw new ApiError(400, `Cannot cancel request in '${reqDoc.status}' status`);
  }

  // 15-minute 0-offer quota refund grace window
  const isWithin15Min = Date.now() - new Date(reqDoc.createdAt).getTime() <= 15 * 60 * 1000;
  if (isWithin15Min && (!reqDoc.offerCount || reqDoc.offerCount === 0)) {
    try {
      await entitlementService.refundQuota(clientId, 'requests.daily', 1);
    } catch (err) {
      console.error(`[Quota Refund Warning] ${err.message}`);
    }
  }

  const updated = await requestRepository.updateById(requestId, {
    status: REQUEST_STATUS.CANCELLED,
    autoPauseAt: null,
  });

  return toPublicRequestDto(updated);
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

export const declineRequest = async (stylistId, requestId) => {
  const reqDoc = await requestRepository.findById(requestId);
  if (!reqDoc) {
    throw new ApiError(404, 'Request not found');
  }

  if (reqDoc.visibility !== 'direct') {
    throw new ApiError(400, 'Only direct requests can be declined');
  }

  const targetStylistId = (reqDoc.stylistId?._id || reqDoc.stylistId || '').toString();
  if (targetStylistId !== stylistId.toString()) {
    throw new ApiError(403, 'Forbidden');
  }

  if (reqDoc.status !== REQUEST_STATUS.OPEN) {
    throw new ApiError(400, `Cannot decline request in '${reqDoc.status}' status`);
  }

  const updated = await requestRepository.updateById(requestId, {
    status: REQUEST_STATUS.DECLINED,
    autoPauseAt: null,
  });

  eventBus.emit(EVENTS.REQUEST_DECLINED, { requestId });
  return toPublicRequestDto(updated);
};

export default {
  createRequest,
  editRequest,
  reactivateRequest,
  closeRequest,
  cancelRequest,
  getMine,
  getIncoming,
  declineRequest,
};
