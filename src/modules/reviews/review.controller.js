import reviewService from './review.service.js';
import { toReviewDto, toPublicReviewDto } from './review.dto.js';

export const createBookingReview = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const review = await reviewService.createReview(req.user, bookingId, req.body);

  return ApiResponse.success(
    res,
    {
      statusCode: 201,
      message: 'Review submitted successfully',
      data: toReviewDto(review),
    }
  );
});

export const getStylistReviews = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { items, meta } = await reviewService.getStylistReviews(id, req.query);

  return ApiResponse.success(
    res,
    {
      statusCode: 200,
      message: 'Stylist reviews retrieved successfully',
      data: {
        items: items.map(toPublicReviewDto),
      },
      meta,
    }
  );
});

export const getMyReviews = asyncHandler(async (req, res) => {
  const { items, meta } = await reviewService.getMyReviews(
    req.user._id || req.user.id,
    req.query
  );

  return ApiResponse.success(
    res,
    {
      statusCode: 200,
      message: 'My reviews retrieved successfully',
      data: {
        items: items.map(toReviewDto),
      },
      meta,
    }
  );
});

export const hideReview = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isHidden = req.body.isHidden !== undefined ? req.body.isHidden : true;
  const updated = await reviewService.hideReview(id, isHidden);

  return ApiResponse.success(
    res,
    {
      statusCode: 200,
      message: `Review visibility updated to ${isHidden ? 'hidden' : 'visible'}`,
      data: toReviewDto(updated),
    }
  );
});

export default {
  createBookingReview,
  getStylistReviews,
  getMyReviews,
  hideReview,
};
