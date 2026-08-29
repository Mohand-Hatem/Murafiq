import express from 'express';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import { restrictTo } from '../../common/middlewares/rbac.middleware.js';
import validate from '../../common/middlewares/validate.middleware.js';
import { ROLES } from '../../common/constants/roles.constant.js';
import {
  approveVerificationSchema,
  rejectVerificationSchema,
  resolveDisputeSchema,
  resolveNoShowSchema,
  suspendUserSchema,
  reactivateUserSchema,
  restrictUserSchema,
  blockUserSchema,
  unblockUserSchema,
} from './admin.validator.js';
import adminController from './admin.controller.js';
import { hideReviewSchema } from '../reviews/review.validator.js';
import reviewController from '../reviews/review.controller.js';
import auditLogController from '../audit-log/audit-log.controller.js';

const router = express.Router();

router.use(authMiddleware);

// Identity verification review routes (accessible to both Admin and Operator)
router.get(
  '/verifications',
  restrictTo(ROLES.ADMIN, ROLES.OPERATOR),
  adminController.getVerifications
);

router.patch(
  '/verifications/:userId/approve',
  restrictTo(ROLES.ADMIN, ROLES.OPERATOR),
  validate(approveVerificationSchema),
  adminController.approveVerification
);

router.patch(
  '/verifications/:userId/reject',
  restrictTo(ROLES.ADMIN, ROLES.OPERATOR),
  validate(rejectVerificationSchema),
  adminController.rejectVerification
);

// User management & moderation (Admin only)
router.get(
  '/users',
  restrictTo(ROLES.ADMIN),
  adminController.getAllUsers
);

router.patch(
  '/users/:id/suspend',
  restrictTo(ROLES.ADMIN),
  validate(suspendUserSchema),
  adminController.suspendUser
);

router.patch(
  '/users/:id/reactivate',
  restrictTo(ROLES.ADMIN),
  validate(reactivateUserSchema),
  adminController.reactivateUser
);

router.route('/users/:id/block')
  .post(restrictTo(ROLES.ADMIN), validate(blockUserSchema), adminController.blockUser)
  .patch(restrictTo(ROLES.ADMIN), validate(blockUserSchema), adminController.blockUser);

router.route('/users/:id/unblock')
  .post(restrictTo(ROLES.ADMIN), validate(unblockUserSchema), adminController.unblockUser)
  .patch(restrictTo(ROLES.ADMIN), validate(unblockUserSchema), adminController.unblockUser);

router.patch(
  '/users/:id/restrict',
  restrictTo(ROLES.ADMIN),
  validate(restrictUserSchema),
  adminController.restrictUser
);

router.patch(
  '/users/:id/unrestrict',
  restrictTo(ROLES.ADMIN),
  adminController.unrestrictUser
);

router.patch(
  '/users/:id/revoke-sessions',
  restrictTo(ROLES.ADMIN),
  adminController.revokeUserSessions
);

// Dispute management (Admin only)
router.get(
  '/bookings/disputed',
  restrictTo(ROLES.ADMIN),
  adminController.getDisputedBookings
);

router.patch(
  '/bookings/:id/resolve-dispute',
  restrictTo(ROLES.ADMIN),
  validate(resolveDisputeSchema),
  adminController.resolveDispute
);

// Arbitration of a CONTESTED no-show. An uncontested report settles on its own via the
// response window / auto-resolution sweep and never reaches this endpoint.
router.patch(
  '/bookings/:id/resolve-no-show',
  restrictTo(ROLES.ADMIN),
  validate(resolveNoShowSchema),
  adminController.resolveNoShow
);

// Review moderation (Admin only)
router.patch(
  '/reviews/:id/hide',
  restrictTo(ROLES.ADMIN),
  validate(hideReviewSchema),
  reviewController.hideReview
);

// Financial Ledger Statements & Reconciliation (Admin only)
router.get(
  '/ledger/statements',
  restrictTo(ROLES.ADMIN),
  adminController.getLedgerStatements
);

router.get(
  '/ledger/reconciliation',
  restrictTo(ROLES.ADMIN),
  adminController.runLedgerReconciliation
);

// Audit logs (Admin only)
router.get(
  '/audit-logs',
  restrictTo(ROLES.ADMIN),
  auditLogController.getAuditLogs
);

// Dashboard statistics (Admin only)
router.get(
  '/dashboard/stats',
  restrictTo(ROLES.ADMIN),
  adminController.getDashboardStats
);

export default router;

