import noShowService from './no-show.service.js';
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

export const getCancellationQuote = asyncHandler(async (req, res) => {
  const quote = await bookingService.getCancellationQuote(req.user, req.params.id);
  return ApiResponse.success(res, {
    message: 'Cancellation quote calculated successfully',
    data: quote,
  });
});

export const cancelBooking = asyncHandler(async (req, res) => {
  const booking = await bookingService.cancelBooking(req.params.id, req.user, req.body);
  return ApiResponse.success(res, {
    message: 'Booking cancelled successfully',
    data: booking,
  });
});

export const addDisputeEvidence = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const booking = await bookingService.addDisputeEvidence(req.user, id, req.body);
  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Dispute evidence submitted successfully',
    data: booking,
  });
});

export const getDisputeDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const dispute = await bookingService.getDisputeDetails(req.user, id);
  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Dispute details retrieved successfully',
    data: dispute,
  });
});

export const getDisputedBookings = asyncHandler(async (req, res) => {
  const result = await bookingService.getDisputedBookings(req.query);
  return ApiResponse.success(res, {
    message: 'Disputed bookings retrieved successfully',
    data: result.items,
    meta: result.meta,
  });
});

export const resolveDispute = asyncHandler(async (req, res) => {
  const result = await bookingService.resolveDispute(req.params.id, req.user.id, req.body);
  return ApiResponse.success(res, {
    message: 'Dispute resolved successfully',
    data: result,
  });
});

export const fileNoShow = asyncHandler(async (req, res) => {
  const result = await noShowService.fileNoShow(req.user, req.params.id, req.body);
  return ApiResponse.success(res, {
    statusCode: 201,
    message: 'No-show reported. The other party has a window to respond.',
    data: result,
  });
});

export const respondToNoShow = asyncHandler(async (req, res) => {
  const booking = await noShowService.respondToNoShow(req.user, req.params.id, req.body);
  return ApiResponse.success(res, {
    message: req.body.contest ? 'Report contested — escalated to arbitration' : 'Report accepted',
    data: booking,
  });
});

export default {
  fileNoShow,
  respondToNoShow,
  getMine,
  getStylistBookings,
  getById,
  checkIn,
  confirmCompletion,
  fileDispute,
  addDisputeEvidence,
  getDisputeDetails,
  getCancellationQuote,
  cancelBooking,
  getDisputedBookings,
  resolveDispute,
};
