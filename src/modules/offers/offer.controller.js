import offerService from './offer.service.js';

export const createOffer = asyncHandler(async (req, res) => {
  const offerDoc = await offerService.createOffer(req.user, req.params.id, req.body);
  return ApiResponse.success(res, {
    statusCode: 201,
    message: 'Offer sent successfully',
    data: offerDoc,
  });
});

export const withdrawOffer = asyncHandler(async (req, res) => {
  const offerDoc = await offerService.withdrawOffer(req.user, req.params.id);
  return ApiResponse.success(res, {
    message: 'Offer withdrawn successfully',
    data: offerDoc,
  });
});

export const acceptOffer = asyncHandler(async (req, res) => {
  const bookingMode = req.bookingMode || 'standard';
  const { booking, paymentUrl } = await offerService.acceptOfferAndPay(req.user, req.params.id, {
    bookingMode,
  });
  return ApiResponse.success(res, {
    message: 'Offer accepted successfully',
    data: { ...(booking.toJSON ? booking.toJSON() : booking), paymentUrl },
  });
});

export const rejectOffer = asyncHandler(async (req, res) => {
  const offerDoc = await offerService.rejectOffer(req.user, req.params.id);
  return ApiResponse.success(res, {
    message: 'Offer rejected successfully',
    data: offerDoc,
  });
});

export const getOffersForRequest = asyncHandler(async (req, res) => {
  const offers = await offerService.getOffersForRequest(req.user, req.params.id);
  return ApiResponse.success(res, {
    message: 'Offers retrieved successfully',
    data: offers,
  });
});

export const getMyOffers = asyncHandler(async (req, res) => {
  const result = await offerService.getMyOffers(req.user, req.query);
  return ApiResponse.success(res, {
    message: 'Your offers retrieved successfully',
    data: result.items,
    meta: result.meta,
  });
});

export const getCompetingOffers = asyncHandler(async (req, res) => {
  const offers = await offerService.getCompetingOffers(req.user, req.params.id);
  return ApiResponse.success(res, {
    message: 'Competing offers retrieved successfully',
    data: offers,
  });
});

export default {
  getMyOffers,
  getCompetingOffers,
  createOffer,
  withdrawOffer,
  acceptOffer,
  rejectOffer,
  getOffersForRequest,
};
