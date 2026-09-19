import tryOnService from './try-on.service.js';

/**
 * Creates or deduplicates a Virtual Try-On generation request.
 * Endpoint: POST /api/v1/ai/try-on
 * Returns 202 Accepted (or 200 OK on deduplicated 24-hour cache match).
 */
export const createTryOn = asyncHandler(async (req, res) => {
  const userId = req.user.id || req.user._id;
  const { isDuplicate, statusCode, generation } = await tryOnService.createTryOnRequest(
    userId,
    req.body
  );

  return ApiResponse.success(res, {
    statusCode,
    message: isDuplicate
      ? statusCode === 200
        ? 'Completed try-on retrieved from cache'
        : 'Try-on request already processing'
      : 'Try-on request accepted for processing',
    data: generation,
  });
});

/**
 * Retrieves a Try-On generation by ID with fresh signed URL if completed.
 * Endpoint: GET /api/v1/ai/try-on/:id
 */
export const getTryOnById = asyncHandler(async (req, res) => {
  const userId = req.user.id || req.user._id;
  const generation = await tryOnService.getGenerationById(userId, req.params.id);

  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Try-on generation retrieved',
    data: generation,
  });
});

/**
 * Lists user's Try-On generations with pagination.
 * Endpoint: GET /api/v1/ai/try-on
 */
export const listTryOns = asyncHandler(async (req, res) => {
  const userId = req.user.id || req.user._id;
  const { page, limit } = req.query;
  const result = await tryOnService.listGenerations(userId, { page, limit });

  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Try-on generations retrieved',
    data: result.data,
    meta: result.pagination,
  });
});

/**
 * Deletes a Try-On generation.
 * Endpoint: DELETE /api/v1/ai/try-on/:id
 */
export const deleteTryOn = asyncHandler(async (req, res) => {
  const userId = req.user.id || req.user._id;
  await tryOnService.deleteGeneration(userId, req.params.id);

  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Try-on generation deleted successfully',
    data: null,
  });
});

export default {
  createTryOn,
  getTryOnById,
  listTryOns,
  deleteTryOn,
};
