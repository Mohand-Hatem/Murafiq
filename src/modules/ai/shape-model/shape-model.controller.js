import shapeModelService from './shape-model.service.js';

/**
 * Creates or replaces the active ShapeModel for the authenticated client.
 * Endpoint: POST /api/v1/ai/shape-model
 */
export const createShapeModel = asyncHandler(async (req, res) => {
  const userId = req.user.id || req.user._id;
  const result = await shapeModelService.createOrReplace(userId, req.body);

  return ApiResponse.success(res, {
    statusCode: 201,
    message: 'Shape model created successfully',
    data: result,
  });
});

/**
 * Retrieves the currently active ShapeModel for the authenticated client.
 * Endpoint: GET /api/v1/ai/shape-model
 */
export const getActiveShapeModel = asyncHandler(async (req, res) => {
  const userId = req.user.id || req.user._id;
  const result = await shapeModelService.getActive(userId);

  return ApiResponse.success(res, {
    statusCode: 200,
    message: result ? 'Active shape model retrieved' : 'No active shape model',
    data: result,
  });
});

/**
 * Deletes the active ShapeModel and destroys the Cloudinary asset.
 * Endpoint: DELETE /api/v1/ai/shape-model
 */
export const deleteShapeModel = asyncHandler(async (req, res) => {
  const userId = req.user.id || req.user._id;
  await shapeModelService.deleteActive(userId);

  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Shape model deleted successfully',
    data: null,
  });
});

export default {
  createShapeModel,
  getActiveShapeModel,
  deleteShapeModel,
};
