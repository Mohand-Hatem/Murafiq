import express from 'express';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import reviewController from './review.controller.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/mine', reviewController.getMyReviews);

export default router;
