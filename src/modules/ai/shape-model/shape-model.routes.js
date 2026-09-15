import express from 'express';
import authMiddleware from '../../../common/middlewares/auth.middleware.js';
import { restrictTo } from '../../../common/middlewares/rbac.middleware.js';
import validate from '../../../common/middlewares/validate.middleware.js';
import tryOnGuard from '../middlewares/try-on-guard.middleware.js';
import { createShapeModelSchema } from './shape-model.validator.js';
import * as shapeModelController from './shape-model.controller.js';

const router = express.Router();

// Apply kill-switch, authentication, and client role check to all shape model routes
router.use(tryOnGuard);
router.use(authMiddleware);
router.use(restrictTo('client'));

router.post(
  '/',
  validate(createShapeModelSchema),
  shapeModelController.createShapeModel
);

router.get(
  '/',
  shapeModelController.getActiveShapeModel
);

router.delete(
  '/',
  shapeModelController.deleteShapeModel
);

export default router;
