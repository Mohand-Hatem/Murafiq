import orchestrator from './stylist/stylist.orchestrator.js';
import stylistRequestService from './stylist/stylist-request.service.js';
import conversationService from './conversation/ai-conversation.service.js';
import outfitService from './outfits/outfit.service.js';
import stylePreferenceService from './preferences/style-preference.service.js';
import {
  toMobileConversationDto,
  toMobileMessageDto,
  toMobileOutfitDto,
} from './ai.dto.js';

/**
 * Controller handling client AI Stylist occasion requests.
 * Endpoint: POST /api/v1/ai/stylist
 */
export const handleStylistRequest = asyncHandler(async (req, res) => {
  const { message, conversationId, imageRef } = req.body;
  const userId = req.user.id;

  if (conversationId) {
    const conversation = await conversationService.getConversation(conversationId, userId);
    if (!conversation) {
      throw new ApiError(404, 'AI conversation not found');
    }
  }

  if (imageRef) {
    const parts = imageRef.split('/');
    // Expected format: murafiq/ai-chat/<userId>/<uuid>
    if (parts.length < 4 || parts[0] !== 'murafiq' || parts[1] !== 'ai-chat' || parts[2] !== userId.toString()) {
      throw new ApiError(400, 'imageRef does not belong to the authenticated user');
    }
  }

  const result = await orchestrator.runStylistPipeline({
    userId,
    message,
    conversationId,
    imageRef,
  });

  const successMessage = result.refused
    ? 'Stylist request out of domain'
    : (result.responseType === 'clarification'
      ? 'Stylist consultation response'
      : 'Stylist outfits generated successfully');

  return ApiResponse.success(res, {
    message: successMessage,
    data: result,
  });
});

/**
 * Polls status and mobile-safe details of a stylist request.
 * Endpoint: GET /api/v1/ai/stylist/requests/:requestId
 */
export const getStylistRequestStatus = asyncHandler(async (req, res) => {
  const { requestId } = req.params;
  const summary = await stylistRequestService.getRequest(requestId, req.user.id);
  if (!summary) {
    throw new ApiError(404, 'Stylist request not found');
  }
  return ApiResponse.success(res, {
    message: 'Stylist request status retrieved successfully',
    data: summary,
  });
});

/**
 * Cancels an active stylist request with quota refund.
 * Endpoint: POST /api/v1/ai/stylist/requests/:requestId/cancel
 */
export const cancelStylistRequest = asyncHandler(async (req, res) => {
  const { requestId } = req.params;
  const cancelled = await stylistRequestService.cancelRequest(requestId, req.user.id);
  if (!cancelled) {
    throw new ApiError(404, 'Stylist request not found');
  }
  return ApiResponse.success(res, {
    message: 'Stylist request cancelled successfully',
    data: cancelled,
  });
});

/**
 * Submits feedback (liked/disliked) on a composed outfit.
 * Endpoint: POST /api/v1/ai/stylist/feedback
 */
export const submitStylistFeedback = asyncHandler(async (req, res) => {
  const { outfitId, feedback } = req.body;
  const updated = await outfitService.setUserFeedback(outfitId, req.user.id, feedback);
  if (!updated) {
    throw new ApiError(404, 'Outfit not found');
  }
  return ApiResponse.success(res, {
    message: 'Feedback submitted successfully',
    data: toMobileOutfitDto(updated),
  });
});

/**
 * Starts an explicit AI conversation.
 * Endpoint: POST /api/v1/ai/conversations
 */
export const createConversation = asyncHandler(async (req, res) => {
  const { title } = req.body;
  const conversation = await conversationService.createConversation(req.user.id, title);
  return ApiResponse.success(res, {
    statusCode: 201,
    message: 'AI conversation created successfully',
    data: toMobileConversationDto(conversation),
  });
});

/**
 * Lists the user's AI conversations, newest first.
 * Endpoint: GET /api/v1/ai/conversations
 */
export const listConversations = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const { items, total } = await conversationService.getUserConversations(req.user.id, { limit, skip });
  return ApiResponse.success(res, {
    message: 'AI conversations retrieved successfully',
    data: {
      conversations: items.map(toMobileConversationDto),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    },
  });
});

/**
 * Retrieves a single AI conversation by ID.
 * Endpoint: GET /api/v1/ai/conversations/:conversationId
 */
export const getConversation = asyncHandler(async (req, res) => {
  const conversation = await conversationService.getConversation(req.params.conversationId, req.user.id);
  if (!conversation) {
    throw new ApiError(404, 'AI conversation not found');
  }
  return ApiResponse.success(res, {
    message: 'AI conversation retrieved successfully',
    data: toMobileConversationDto(conversation),
  });
});

/**
 * Retrieves message history for an AI conversation.
 * Endpoint: GET /api/v1/ai/conversations/:conversationId/messages
 */
export const getConversationMessages = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const skip = (page - 1) * limit;

  const { items, total } = await conversationService.getConversationMessages(
    req.params.conversationId,
    req.user.id,
    { limit, skip }
  );

  return ApiResponse.success(res, {
    message: 'Conversation messages retrieved successfully',
    data: {
      messages: items.map(toMobileMessageDto),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    },
  });
});

/**
 * Deletes an AI conversation and its messages.
 * Endpoint: DELETE /api/v1/ai/conversations/:conversationId
 */
export const deleteConversation = asyncHandler(async (req, res) => {
  const deleted = await conversationService.deleteConversation(req.params.conversationId, req.user.id);
  if (!deleted) {
    throw new ApiError(404, 'AI conversation not found');
  }
  return ApiResponse.success(res, {
    message: 'AI conversation deleted successfully',
    data: null,
  });
});

/**
 * Lists the authenticated user's generated outfits.
 * Endpoint: GET /api/v1/ai/outfits
 */
export const listOutfits = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const { items, total } = await outfitService.getUserOutfits(req.user.id, { limit, skip });
  return ApiResponse.success(res, {
    message: 'Outfits retrieved successfully',
    data: {
      outfits: items.map(toMobileOutfitDto),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    },
  });
});

/**
 * Retrieves a single outfit by ID.
 * Endpoint: GET /api/v1/ai/outfits/:outfitId
 */
export const getOutfit = asyncHandler(async (req, res) => {
  const outfit = await outfitService.getOutfitById(req.params.outfitId, req.user.id);
  if (!outfit) {
    throw new ApiError(404, 'Outfit not found');
  }
  return ApiResponse.success(res, {
    message: 'Outfit retrieved successfully',
    data: toMobileOutfitDto(outfit),
  });
});

/**
 * Deletes an outfit by ID.
 * Endpoint: DELETE /api/v1/ai/outfits/:outfitId
 */
export const deleteOutfit = asyncHandler(async (req, res) => {
  const deleted = await outfitService.deleteOutfit(req.params.outfitId, req.user.id);
  if (!deleted) {
    throw new ApiError(404, 'Outfit not found');
  }
  return ApiResponse.success(res, {
    message: 'Outfit deleted successfully',
    data: null,
  });
});

/**
 * Retrieves user style preferences (Prepared — Inactive in Phase 15).
 */
export const getUserPreferences = asyncHandler(async (req, res) => {
  const preferences = await stylePreferenceService.getPreferences(req.user.id);
  return ApiResponse.success(res, {
    message: 'Style preferences retrieved successfully',
    data: preferences,
  });
});

/**
 * Updates user style preferences (Prepared — Inactive in Phase 15).
 */
export const updateUserPreferences = asyncHandler(async (req, res) => {
  const updated = await stylePreferenceService.updatePreferences(req.user.id, req.body);
  return ApiResponse.success(res, {
    message: 'Style preferences updated successfully',
    data: updated,
  });
});

export default {
  handleStylistRequest,
  getStylistRequestStatus,
  cancelStylistRequest,
  submitStylistFeedback,
  createConversation,
  listConversations,
  getConversation,
  getConversationMessages,
  deleteConversation,
  listOutfits,
  getOutfit,
  deleteOutfit,
  getUserPreferences,
  updateUserPreferences,
};
