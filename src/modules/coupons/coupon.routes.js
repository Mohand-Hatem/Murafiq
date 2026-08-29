import express from 'express';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import { restrictTo } from '../../common/middlewares/rbac.middleware.js';
import validate from '../../common/middlewares/validate.middleware.js';
import { ROLES } from '../../common/constants/roles.constant.js';
import { validateCouponSchema, listMyCouponsSchema, issueCouponSchema } from './coupon.validator.js';
import couponController from './coupon.controller.js';

const router = express.Router();

router.use(authMiddleware);

// A user's own coupons
router.get('/mine', validate(listMyCouponsSchema), couponController.getMyCoupons);

// Check a coupon against a specific booking without consuming it. The discount is
// computed server-side from the booking's stored price.
router.post('/validate', validate(validateCouponSchema), couponController.validateCoupon);

// Manual issuance (promotional). Compensation coupons are issued automatically by the
// no-show / late-cancellation flows, not through this endpoint.
router.post('/', restrictTo(ROLES.ADMIN), validate(issueCouponSchema), couponController.issueCoupon);

export default router;
