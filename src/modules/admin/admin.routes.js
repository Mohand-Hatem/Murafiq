import express from 'express';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import { restrictTo } from '../../common/middlewares/rbac.middleware.js';
import validate from '../../common/middlewares/validate.middleware.js';
import { ROLES } from '../../common/constants/roles.constant.js';
import { rejectVerificationSchema } from './admin.validator.js';
import adminController from './admin.controller.js';

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
  adminController.approveVerification
);

router.patch(
  '/verifications/:userId/reject',
  restrictTo(ROLES.ADMIN, ROLES.OPERATOR),
  validate(rejectVerificationSchema),
  adminController.rejectVerification
);

export default router;
