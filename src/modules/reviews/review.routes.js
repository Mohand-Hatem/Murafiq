import express from 'express';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import reviewController from './review.controller.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/mine', reviewController.getMyReviews);
router.get('/booking/:bookingId', reviewController.getBookingReviews);
router.get('/stylist/:id', reviewController.getStylistReviews);
router.get('/client/:id', reviewController.getClientReviews);

export default router;
