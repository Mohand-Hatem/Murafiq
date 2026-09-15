import express from 'express';
import authMiddleware from '../../../common/middlewares/auth.middleware.js';
import { restrictTo } from '../../../common/middlewares/rbac.middleware.js';
import validate from '../../../common/middlewares/validate.middleware.js';
import tryOnGuard from '../middlewares/try-on-guard.middleware.js';
import {
  createTryOnSchema,
  tryOnIdParamSchema,
  listTryOnSchema,
} from './try-on.validator.js';
import * as tryOnController from './try-on.controller.js';

const router = express.Router();

// Apply kill-switch, authentication, and client role check to all Try-On routes
router.use(tryOnGuard);
router.use(authMiddleware);
router.use(restrictTo('client'));

router.post(
  '/',
  validate(createTryOnSchema),
  tryOnController.createTryOn
);

router.get(
  '/:id',
  validate(tryOnIdParamSchema),
  tryOnController.getTryOnById
);

router.get(
  '/',
  validate(listTryOnSchema),
  tryOnController.listTryOns
);

router.delete(
  '/:id',
  validate(tryOnIdParamSchema),
  tryOnController.deleteTryOn
);

export default router;
