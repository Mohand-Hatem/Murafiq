import bookingService from './booking.service.js';

export const getMine = asyncHandler(async (req, res) => {
  const result = await bookingService.getMine(req.user.id, req.query);
  return ApiResponse.success(res, {
    message: 'Client bookings retrieved successfully',
    data: result.items,
    meta: result.meta,
  });
});

export const getStylistBookings = asyncHandler(async (req, res) => {
  const result = await bookingService.getStylistBookings(req.user.id, req.query);
  return ApiResponse.success(res, {
    message: 'Stylist bookings retrieved successfully',
    data: result.items,
    meta: result.meta,
  });
});

export const getById = asyncHandler(async (req, res) => {
  const booking = await bookingService.getById(req.user, req.params.id);
  return ApiResponse.success(res, {
    message: 'Booking details retrieved successfully',
    data: booking,
  });
});

export const checkIn = asyncHandler(async (req, res) => {
  const booking = await bookingService.checkIn(req.user, req.params.id, req.body);
  return ApiResponse.success(res, {
    message: 'Check-in recorded successfully',
    data: booking,
  });
});

export const confirmCompletion = asyncHandler(async (req, res) => {
  const booking = await bookingService.confirmCompletion(req.user, req.params.id);
  return ApiResponse.success(res, {
    message: 'Completion confirmation recorded successfully',
    data: booking,
  });
});

export const fileDispute = asyncHandler(async (req, res) => {
  const booking = await bookingService.fileDispute(req.user, req.params.id, req.body);
  return ApiResponse.success(res, {
    message: 'Dispute filed successfully',
    data: booking,
  });
});

export const cancelBooking = asyncHandler(async (req, res) => {
  const booking = await bookingService.cancelBooking(req.user, req.params.id, req.body);
  return ApiResponse.success(res, {
    message: 'Booking cancelled successfully',
    data: booking,
  });
});

export default {
  getMine,
  getStylistBookings,
  getById,
  checkIn,
  confirmCompletion,
  fileDispute,
  cancelBooking,
};
