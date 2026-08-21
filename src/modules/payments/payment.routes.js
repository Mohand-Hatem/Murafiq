import express from 'express';
import * as paymentController from './payment.controller.js';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import { restrictTo } from '../../common/middlewares/rbac.middleware.js';
import validate from '../../common/middlewares/validate.middleware.js';
import { ROLES } from '../../common/constants/roles.constant.js';
import {
  initializePaymentSchema,
  getPaymentStatusSchema,
  refundPaymentSchema,
} from './payment.validator.js';

const router = express.Router();

// Public Webhook callback from Paymob / payment provider
router.post('/callback', paymentController.handleWebhook);

// Client-initiated payment initialization
router.post(
  '/:bookingId/initialize',
  authMiddleware,
  restrictTo(ROLES.CLIENT),
  validate(initializePaymentSchema),
  paymentController.initializePayment
);

// Payment status check
router.get(
  '/:bookingId/status',
  authMiddleware,
  validate(getPaymentStatusSchema),
  paymentController.getPaymentStatus
);

// Client payment history
router.get(
  '/history',
  authMiddleware,
  restrictTo(ROLES.CLIENT),
  paymentController.getClientHistory
);

// Admin-triggered refund
router.post(
  '/:bookingId/refund',
  authMiddleware,
  restrictTo(ROLES.ADMIN),
  validate(refundPaymentSchema),
  paymentController.processRefund
);

export default router;
