import * as wardrobeService from './wardrobe.service.js';
import { formatWardrobeItemDto, formatWardrobeListDto } from './wardrobe.dto.js';

export const createWardrobeItem = asyncHandler(async (req, res) => {
  const item = await wardrobeService.createWardrobeItem(req.user.id, req.body);
  return ApiResponse.success(res, {
    statusCode: 201,
    message: 'Wardrobe item uploaded and queued for AI classification',
    data: formatWardrobeItemDto(item),
  });
});

export const getMyWardrobe = asyncHandler(async (req, res) => {
  const result = await wardrobeService.getMyWardrobe(req.user.id, req.query);
  return ApiResponse.success(res, {
    message: 'Wardrobe items retrieved successfully',
    data: formatWardrobeListDto(result),
  });
});

export const getWardrobeItemById = asyncHandler(async (req, res) => {
  const item = await wardrobeService.getWardrobeItemById(req.user.id, req.params.id);
  return ApiResponse.success(res, {
    message: 'Wardrobe item retrieved successfully',
    data: formatWardrobeItemDto(item),
  });
});

export const updateWardrobeItem = asyncHandler(async (req, res) => {
  const item = await wardrobeService.updateWardrobeItem(req.user.id, req.params.id, req.body);
  return ApiResponse.success(res, {
    message: 'Wardrobe item updated successfully',
    data: formatWardrobeItemDto(item),
  });
});

export const deleteWardrobeItem = asyncHandler(async (req, res) => {
  await wardrobeService.deleteWardrobeItem(req.user.id, req.params.id);
  return ApiResponse.success(res, {
    message: 'Wardrobe item and vector index deleted successfully',
    data: null,
  });
});
