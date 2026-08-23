import express from 'express';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import { restrictTo } from '../../common/middlewares/rbac.middleware.js';
import validate from '../../common/middlewares/validate.middleware.js';
import { ROLES } from '../../common/constants/roles.constant.js';
import {
  checkInSchema,
  confirmCompletionSchema,
  disputeSchema,
  cancelBookingSchema,
} from './booking.validator.js';
import bookingController from './booking.controller.js';
import { createReviewSchema } from '../reviews/review.validator.js';
import reviewController from '../reviews/review.controller.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/mine', restrictTo(ROLES.CLIENT), bookingController.getMine);
router.get('/stylist', restrictTo(ROLES.STYLIST), bookingController.getStylistBookings);
router.get('/:id', bookingController.getById);

router.patch('/:id/check-in', validate(checkInSchema), bookingController.checkIn);
router.patch('/:id/confirm-completion', validate(confirmCompletionSchema), bookingController.confirmCompletion);
router.post('/:id/dispute', validate(disputeSchema), bookingController.fileDispute);
router.patch('/:id/cancel', validate(cancelBookingSchema), bookingController.cancelBooking);

// Two-way review submission for completed booking
router.post('/:bookingId/review', validate(createReviewSchema), reviewController.createBookingReview);

export default router;
