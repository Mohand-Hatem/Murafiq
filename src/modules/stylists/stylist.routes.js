import express from 'express';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import { restrictTo } from '../../common/middlewares/rbac.middleware.js';
import validate from '../../common/middlewares/validate.middleware.js';
import { ROLES } from '../../common/constants/roles.constant.js';
import {
  createStylistProfileSchema,
  updateStylistProfileSchema,
} from './stylist.validator.js';
import stylistController from './stylist.controller.js';

const router = express.Router();

// Public routes
router.get('/', stylistController.searchStylists);
router.get('/me/profile', authMiddleware, restrictTo(ROLES.STYLIST), stylistController.getOwnProfile);
router.get('/me/payouts', authMiddleware, restrictTo(ROLES.STYLIST), stylistController.getOwnPayouts);
router.get('/:id', stylistController.getPublicProfileById);
router.get('/:id/reviews', stylistController.getStylistReviews);

// Protected routes (require auth)
router.use(authMiddleware);

// Stylist-only profile management
router.post(
  '/profile',
  restrictTo(ROLES.STYLIST),
  validate(createStylistProfileSchema),
  stylistController.createProfile
);
router.patch(
  '/profile',
  restrictTo(ROLES.STYLIST),
  validate(updateStylistProfileSchema),
  stylistController.updateProfile
);

export default router;
