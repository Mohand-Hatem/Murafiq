import paymentService from './payment.service.js';
import { toPublicPaymentDto } from './payment.dto.js';

export const initializePayment = asyncHandler(async (req, res) => {
  const { paymentUrl, clientSecret, payment } = await paymentService.initializePayment(
    req.user,
    req.params.bookingId,
    { couponCode: req.body?.couponCode || null }
  );

  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Payment initialized successfully',
    data: {
      paymentUrl,
      clientSecret,
      payment: toPublicPaymentDto(payment),
    },
  });
});

export const handleWebhook = asyncHandler(async (req, res) => {
  const result = await paymentService.handleWebhook(req.body, req.query);

  const data = result?.order ? result : toPublicPaymentDto(result);

  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Webhook processed successfully',
    data,
  });
});

export const getPaymentStatus = asyncHandler(async (req, res) => {
  const payment = await paymentService.getPaymentStatus(req.user, req.params.bookingId);

  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Payment status retrieved successfully',
    data: toPublicPaymentDto(payment),
  });
});

export const getClientHistory = asyncHandler(async (req, res) => {
  const { payments, meta } = await paymentService.getClientHistory(req.user, req.query);

  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Payment history retrieved successfully',
    data: payments.map(toPublicPaymentDto),
    meta,
  });
});

export const processRefund = asyncHandler(async (req, res) => {
  const payment = await paymentService.processRefund({
    bookingId: req.params.bookingId,
    refundPercentage: req.body?.refundPercentage,
    reason: req.body?.reason,
    // See payment.validator.js refundPaymentSchema — an explicit admin choice, not a
    // silently changed default. Undefined here means processRefund's own default (0)
    // applies exactly as before. See docs/AUDIT_2026_09_FULL_SYSTEM.md finding X21.
    stylistPayoutOverrideAmount: req.body?.stylistPayoutOverrideAmount,
  });

  return ApiResponse.success(res, {
    statusCode: 200,
    message: 'Payment refunded successfully',
    data: toPublicPaymentDto(payment),
  });
});

export default {
  initializePayment,
  handleWebhook,
  getPaymentStatus,
  getClientHistory,
  processRefund,
};
