import couponService from './coupon.service.js';
import bookingRepository from '../bookings/booking.repository.js';

export const getMyCoupons = asyncHandler(async (req, res) => {
  const coupons = await couponService.getMine(req.user.id, req.query);
  return ApiResponse.success(res, {
    message: 'Coupons retrieved successfully',
    data: coupons,
  });
});

export const validateCoupon = asyncHandler(async (req, res) => {
  const { code, bookingId } = req.body;

  // The price comes from the booking record, never from the request body — a
  // client-supplied price would let the caller inflate their own discount.
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }
  const clientId = (booking.clientId?._id || booking.clientId).toString();
  if (clientId !== req.user.id) {
    throw new ApiError(403, 'Forbidden');
  }

  const result = await couponService.validateCoupon(req.user.id, code, booking.price);
  return ApiResponse.success(res, {
    message: 'Coupon is valid',
    data: result,
  });
});

export const issueCoupon = asyncHandler(async (req, res) => {
  if (req.body.recipientIds && req.body.recipientIds.length > 0) {
    const coupons = await couponService.issueCouponsBulk({
      recipientIds: req.body.recipientIds,
      issuedReason: req.body.issuedReason || 'MARKETING',
      discountPercentage: req.body.discountPercentage,
      maxDiscountEgp: req.body.maxDiscountEgp,
      expiryDays: req.body.expiryDays,
    });
    return ApiResponse.success(res, {
      statusCode: 201,
      message: `${coupons.length} coupons issued successfully`,
      data: coupons,
    });
  }

  const coupon = await couponService.issueCoupon({
    recipientId: req.body.recipientId,
    issuedReason: req.body.issuedReason || 'MARKETING',
    discountPercentage: req.body.discountPercentage,
    maxDiscountEgp: req.body.maxDiscountEgp,
    expiryDays: req.body.expiryDays,
  });
  return ApiResponse.success(res, {
    statusCode: 201,
    message: 'Coupon issued successfully',
    data: coupon,
  });
});

export default { getMyCoupons, validateCoupon, issueCoupon };
