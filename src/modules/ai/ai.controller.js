import orchestrator from './stylist/stylist.orchestrator.js';

/**
 * Controller handling client AI Stylist occasion requests.
 * Endpoint: POST /api/v1/ai/stylist
 */
export const handleStylistRequest = asyncHandler(async (req, res) => {
  const { message, conversationId, imageRef } = req.body;
  const userId = req.user.id || req.user._id;

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

  return ApiResponse.success(res, {
    message: result.refused ? 'Stylist request out of domain' : 'Stylist outfits generated successfully',
    data: result,
  });
});

export default {
  handleStylistRequest,
};
