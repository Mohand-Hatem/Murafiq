import express from 'express';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import { restrictTo } from '../../common/middlewares/rbac.middleware.js';
import validate from '../../common/middlewares/validate.middleware.js';
import { ROLES } from '../../common/constants/roles.constant.js';
import { createRequestSchema, editRequestSchema } from './request.validator.js';
import requestController from './request.controller.js';

const router = express.Router();

router.use(authMiddleware);

// Client-only request creation & lifecycle management
router.post('/', restrictTo(ROLES.CLIENT), validate(createRequestSchema), requestController.createRequest);
router.get('/mine', restrictTo(ROLES.CLIENT), requestController.getMine);
router.patch('/:id', restrictTo(ROLES.CLIENT), validate(editRequestSchema), requestController.editRequest);
router.patch('/:id/reactivate', restrictTo(ROLES.CLIENT), requestController.reactivateRequest);
router.patch('/:id/close', restrictTo(ROLES.CLIENT), requestController.closeRequest);
router.patch('/:id/cancel', restrictTo(ROLES.CLIENT), requestController.cancelRequest);

// Stylist-only incoming requests, broadcast feed & decline
router.get('/feed', restrictTo(ROLES.STYLIST), requestController.getBroadcastFeed);
router.get('/incoming', restrictTo(ROLES.STYLIST), requestController.getIncoming);
router.patch('/:id/decline', restrictTo(ROLES.STYLIST), requestController.declineRequest);

export default router;
