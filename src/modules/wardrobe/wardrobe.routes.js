import express from 'express';
import * as wardrobeController from './wardrobe.controller.js';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import { restrictTo } from '../../common/middlewares/rbac.middleware.js';
import validate from '../../common/middlewares/validate.middleware.js';
import {
  createWardrobeItemSchema,
  updateWardrobeItemSchema,
  wardrobeQuerySchema,
} from './wardrobe.validator.js';

const router = express.Router();

// All wardrobe routes require authentication and are strictly client-only
router.use(authMiddleware);
router.use(restrictTo('client'));

router.post(
  '/',
  validate(createWardrobeItemSchema),
  wardrobeController.createWardrobeItem
);

router.get(
  '/mine',
  validate(wardrobeQuerySchema),
  wardrobeController.getMyWardrobe
);

router.get(
  '/:id',
  wardrobeController.getWardrobeItemById
);

router.patch(
  '/:id',
  validate(updateWardrobeItemSchema),
  wardrobeController.updateWardrobeItem
);

router.delete(
  '/:id',
  wardrobeController.deleteWardrobeItem
);

export default router;
