import requestService from './request.service.js';
import requestFeedService from './request-feed.service.js';

export const createRequest = asyncHandler(async (req, res) => {
  const requestDoc = await requestService.createRequest(req.user, req.body);
  return ApiResponse.success(res, {
    statusCode: 201,
    message: 'Request created successfully',
    data: requestDoc,
  });
});

export const getMine = asyncHandler(async (req, res) => {
  const result = await requestService.getMine(req.user.id, req.query);
  return ApiResponse.success(res, {
    message: 'Requests retrieved successfully',
    data: result.items,
    meta: result.meta,
  });
});

export const getIncoming = asyncHandler(async (req, res) => {
  const result = await requestService.getIncoming(req.user.id, req.query);
  return ApiResponse.success(res, {
    message: 'Incoming requests retrieved successfully',
    data: result.items,
    meta: result.meta,
  });
});

export const getBroadcastFeed = asyncHandler(async (req, res) => {
  const result = await requestFeedService.getBroadcastFeed(req.user, req.query);
  return ApiResponse.success(res, {
    message: 'Broadcast feed retrieved successfully',
    data: result.items,
    meta: result.meta,
  });
});

export const cancelRequest = asyncHandler(async (req, res) => {
  const requestDoc = await requestService.cancelRequest(req.user.id, req.params.id);
  return ApiResponse.success(res, {
    message: 'Request cancelled successfully',
    data: requestDoc,
  });
});

export const declineRequest = asyncHandler(async (req, res) => {
  const requestDoc = await requestService.declineRequest(req.user.id, req.params.id);
  return ApiResponse.success(res, {
    message: 'Request declined successfully',
    data: requestDoc,
  });
});

export default {
  createRequest,
  getMine,
  getIncoming,
  getBroadcastFeed,
  cancelRequest,
  declineRequest,
};

