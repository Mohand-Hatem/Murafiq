import express from 'express';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import { restrictTo } from '../../common/middlewares/rbac.middleware.js';
import validate from '../../common/middlewares/validate.middleware.js';
import { ROLES } from '../../common/constants/roles.constant.js';
import payoutController from './payout.controller.js';
import {
  updatePayoutAccountSchema,
  batchPayoutSchema,
  markPaidSchema,
  markFailedSchema,
  payoutIdParamSchema,
} from './payout.validator.js';

const router = express.Router();
router.use(authMiddleware);

// Stylist self-serve routes
router.get('/account', restrictTo(ROLES.STYLIST), payoutController.getPayoutAccount);
router.patch(
  '/account',
  restrictTo(ROLES.STYLIST),
  validate(updatePayoutAccountSchema),
  payoutController.updatePayoutAccount
);
router.get('/mine', restrictTo(ROLES.STYLIST), payoutController.getStylistPayouts);

// Admin disbursement routes
router.get('/admin/pending-balances', restrictTo(ROLES.ADMIN), payoutController.getPendingBalances);
router.get('/admin', restrictTo(ROLES.ADMIN), payoutController.getAllPayouts);
router.post(
  '/admin/batch',
  restrictTo(ROLES.ADMIN),
  validate(batchPayoutSchema),
  payoutController.createBatchPayouts
);
router.patch(
  '/admin/:id/mark-processing',
  restrictTo(ROLES.ADMIN),
  validate(payoutIdParamSchema),
  payoutController.markProcessing
);
router.patch(
  '/admin/:id/mark-paid',
  restrictTo(ROLES.ADMIN),
  validate(markPaidSchema),
  payoutController.markPaid
);
router.patch(
  '/admin/:id/mark-failed',
  restrictTo(ROLES.ADMIN),
  validate(markFailedSchema),
  payoutController.markFailed
);

export default router;
