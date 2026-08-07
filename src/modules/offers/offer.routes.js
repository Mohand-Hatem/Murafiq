import express from 'express';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import { restrictTo } from '../../common/middlewares/rbac.middleware.js';
import validate from '../../common/middlewares/validate.middleware.js';
import { ROLES } from '../../common/constants/roles.constant.js';
import { createOfferSchema } from './offer.validator.js';
import offerController from './offer.controller.js';

const router = express.Router();

router.use(authMiddleware);

// Stylist-only offer creation on a specific request
router.post('/requests/:id', restrictTo(ROLES.STYLIST), validate(createOfferSchema), offerController.createOffer);

// Client-only offer acceptance & rejection
router.patch('/:id/accept', restrictTo(ROLES.CLIENT), offerController.acceptOffer);
router.patch('/:id/reject', restrictTo(ROLES.CLIENT), offerController.rejectOffer);

export default router;
