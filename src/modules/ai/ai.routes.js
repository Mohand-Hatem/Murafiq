import express from 'express';
import * as aiController from './ai.controller.js';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import { restrictTo } from '../../common/middlewares/rbac.middleware.js';
import validate from '../../common/middlewares/validate.middleware.js';
import { stylistRequestSchema } from './ai.validator.js';
import tryOnGuard from './middlewares/try-on-guard.middleware.js';
import { createShapeModelSchema } from './shape-model/shape-model.validator.js';
import * as shapeModelController from './shape-model/shape-model.controller.js';
import {
  createTryOnSchema,
  tryOnIdParamSchema,
  listTryOnSchema,
} from './try-on/try-on.validator.js';
import * as tryOnController from './try-on/try-on.controller.js';

const router = express.Router();

// AI Stylist
router.post(
  '/stylist',
  authMiddleware,
  restrictTo('client'),
  validate(stylistRequestSchema),
  aiController.handleStylistRequest
);

// Virtual Try-On — Shape Model Subsystem
router.post(
  '/shape-model',
  tryOnGuard,
  authMiddleware,
  restrictTo('client'),
  validate(createShapeModelSchema),
  shapeModelController.createShapeModel
);

router.get(
  '/shape-model',
  tryOnGuard,
  authMiddleware,
  restrictTo('client'),
  shapeModelController.getActiveShapeModel
);

router.delete(
  '/shape-model',
  tryOnGuard,
  authMiddleware,
  restrictTo('client'),
  shapeModelController.deleteShapeModel
);

// Virtual Try-On — Try-On Subsystem
router.post(
  '/try-on',
  tryOnGuard,
  authMiddleware,
  restrictTo('client'),
  validate(createTryOnSchema),
  tryOnController.createTryOn
);

router.get(
  '/try-on/:id',
  tryOnGuard,
  authMiddleware,
  restrictTo('client'),
  validate(tryOnIdParamSchema),
  tryOnController.getTryOnById
);

router.get(
  '/try-on',
  tryOnGuard,
  authMiddleware,
  restrictTo('client'),
  validate(listTryOnSchema),
  tryOnController.listTryOns
);

router.delete(
  '/try-on/:id',
  tryOnGuard,
  authMiddleware,
  restrictTo('client'),
  validate(tryOnIdParamSchema),
  tryOnController.deleteTryOn
);

export default router;
