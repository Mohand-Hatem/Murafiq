import payoutService from './payout.service.js';

export const getPayoutAccount = asyncHandler(async (req, res) => {
  const account = await payoutService.getPayoutAccount(req.user._id);
  return ApiResponse.success(res, {
    message: 'Payout account retrieved successfully',
    data: account,
  });
});

export const updatePayoutAccount = asyncHandler(async (req, res) => {
  const updated = await payoutService.updatePayoutAccount(req.user._id, req.body);
  return ApiResponse.success(res, {
    message: 'Payout account updated successfully',
    data: updated,
  });
});

export const getStylistPayouts = asyncHandler(async (req, res) => {
  const { payouts, meta } = await payoutService.getStylistPayouts(req.user._id, req.query);
  return ApiResponse.success(res, {
    message: 'Stylist payouts retrieved successfully',
    data: payouts,
    meta,
  });
});

export const getPendingBalances = asyncHandler(async (_req, res) => {
  const summary = await payoutService.getPendingBalancesSummary();
  return ApiResponse.success(res, {
    message: 'Pending payout balances retrieved successfully',
    data: summary,
  });
});

export const getAllPayouts = asyncHandler(async (req, res) => {
  const { payouts, meta } = await payoutService.getAllPayouts(req.query);
  return ApiResponse.success(res, {
    message: 'All payouts retrieved successfully',
    data: payouts,
    meta,
  });
});

export const createBatchPayouts = asyncHandler(async (req, res) => {
  const payouts = await payoutService.createBatchPayouts(req.user._id, req.body);
  return ApiResponse.created(res, {
    message: `Batch payout created: ${payouts.length} disbursements generated`,
    data: payouts,
  });
});

export const markProcessing = asyncHandler(async (req, res) => {
  const updated = await payoutService.markProcessing(req.params.id, req.user._id);
  return ApiResponse.success(res, {
    message: 'Payout marked as processing',
    data: updated,
  });
});

export const markPaid = asyncHandler(async (req, res) => {
  const updated = await payoutService.markPaid(req.params.id, req.user._id, req.body);
  return ApiResponse.success(res, {
    message: 'Payout marked as paid',
    data: updated,
  });
});

export const markFailed = asyncHandler(async (req, res) => {
  const updated = await payoutService.markFailed(req.params.id, req.user._id, req.body);
  return ApiResponse.success(res, {
    message: 'Payout marked as failed',
    data: updated,
  });
});

export default {
  getPayoutAccount,
  updatePayoutAccount,
  getStylistPayouts,
  getPendingBalances,
  getAllPayouts,
  createBatchPayouts,
  markProcessing,
  markPaid,
  markFailed,
};
