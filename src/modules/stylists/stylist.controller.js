import stylistService from './stylist.service.js';
import stylistSearchService from './stylist-search.service.js';
import reliabilityService from './reliability.service.js';
import reviewService from '../reviews/review.service.js';
import { toPublicReviewDto } from '../reviews/review.dto.js';

export const createProfile = asyncHandler(async (req, res) => {
  const profile = await stylistService.createProfile(req.user.id, req.user.role, req.body);
  return ApiResponse.success(res, {
    statusCode: 201,
    message: 'Stylist profile created successfully',
    data: profile,
  });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const profile = await stylistService.updateProfile(req.user.id, req.user.role, req.body);
  return ApiResponse.success(res, {
    message: 'Stylist profile updated successfully',
    data: profile,
  });
});

export const getOwnProfile = asyncHandler(async (req, res) => {
  const profile = await stylistService.getOwnProfile(req.user.id);
  return ApiResponse.success(res, {
    message: 'Stylist profile retrieved successfully',
    data: profile,
  });
});

export const getPublicProfileById = asyncHandler(async (req, res) => {
  const profile = await stylistService.getPublicProfileById(req.params.id);
  return ApiResponse.success(res, {
    message: 'Stylist profile retrieved successfully',
    data: profile,
  });
});

export const searchStylists = asyncHandler(async (req, res) => {
  const result = await stylistSearchService.searchStylists(req.query);
  return ApiResponse.success(res, {
    message: 'Stylists retrieved successfully',
    data: result.items,
    meta: result.meta,
  });
});

export const getStylistReviews = asyncHandler(async (req, res) => {
  const { items, meta } = await reviewService.getStylistReviews(req.params.id, req.query);
  return ApiResponse.success(res, {
    message: 'Stylist reviews retrieved successfully',
    data: items.map(toPublicReviewDto),
    meta,
  });
});

export const getOwnPayouts = asyncHandler(async (req, res) => {
  // Phase 11 stub — returns empty payout history until Phase 11 is implemented
  return ApiResponse.success(res, {
    message: 'Payout history retrieved successfully',
    data: [],
    meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
  });
});

export const getReliability = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const reliability = await reliabilityService.calculateReliability(id);

  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Stylist reliability metrics retrieved successfully',
    data: reliability,
  });
});

export default {
  createProfile,
  updateProfile,
  getOwnProfile,
  getPublicProfileById,
  searchStylists,
  getStylistReviews,
  getOwnPayouts,
  getReliability,
};
