import express from 'express';
import * as aiController from './ai.controller.js';
import * as wardrobeController from '../wardrobe/wardrobe.controller.js';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import { restrictTo } from '../../common/middlewares/rbac.middleware.js';
import validate from '../../common/middlewares/validate.middleware.js';
import {
  stylistRequestSchema,
  requestIdParamSchema,
  stylistFeedbackSchema,
  createConversationSchema,
  conversationIdParamSchema,
  listConversationsSchema,
  listMessagesSchema,
  outfitIdParamSchema,
  listOutfitsSchema,
  // updatePreferencesSchema,
} from './ai.validator.js';
import { saveFromChatSchema } from '../wardrobe/wardrobe.validator.js';
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

// ── AI Stylist & Requests ───────────────────────────────────────────
router.post(
  '/stylist',
  authMiddleware,
  restrictTo('client'),
  validate(stylistRequestSchema),
  aiController.handleStylistRequest
);

router.get(
  '/stylist/requests/:requestId',
  authMiddleware,
  restrictTo('client'),
  validate(requestIdParamSchema),
  aiController.getStylistRequestStatus
);

router.post(
  '/stylist/requests/:requestId/cancel',
  authMiddleware,
  restrictTo('client'),
  validate(requestIdParamSchema),
  aiController.cancelStylistRequest
);

router.post(
  '/stylist/feedback',
  authMiddleware,
  restrictTo('client'),
  validate(stylistFeedbackSchema),
  aiController.submitStylistFeedback
);

// ── Wardrobe Save From Chat ─────────────────────────────────────────
router.post(
  '/wardrobe/from-chat',
  authMiddleware,
  restrictTo('client'),
  validate(saveFromChatSchema),
  wardrobeController.saveFromChat
);

// ── Conversations ───────────────────────────────────────────────────
router.post(
  '/conversations',
  authMiddleware,
  restrictTo('client'),
  validate(createConversationSchema),
  aiController.createConversation
);

router.get(
  '/conversations',
  authMiddleware,
  restrictTo('client'),
  validate(listConversationsSchema),
  aiController.listConversations
);

router.get(
  '/conversations/:conversationId',
  authMiddleware,
  restrictTo('client'),
  validate(conversationIdParamSchema),
  aiController.getConversation
);

router.get(
  '/conversations/:conversationId/messages',
  authMiddleware,
  restrictTo('client'),
  validate(listMessagesSchema),
  aiController.getConversationMessages
);

router.delete(
  '/conversations/:conversationId',
  authMiddleware,
  restrictTo('client'),
  validate(conversationIdParamSchema),
  aiController.deleteConversation
);

// ── Outfits History ─────────────────────────────────────────────────
router.get(
  '/outfits',
  authMiddleware,
  restrictTo('client'),
  validate(listOutfitsSchema),
  aiController.listOutfits
);

router.get(
  '/outfits/:outfitId',
  authMiddleware,
  restrictTo('client'),
  validate(outfitIdParamSchema),
  aiController.getOutfit
);

router.delete(
  '/outfits/:outfitId',
  authMiddleware,
  restrictTo('client'),
  validate(outfitIdParamSchema),
  aiController.deleteOutfit
);

// ── Preferences (FUTURE FEATURE — INACTIVE IN PHASE 15) ──────────────
// router.get(
//   '/preferences',
//   authMiddleware,
//   restrictTo('client'),
//   aiController.getUserPreferences
// );
//
// router.patch(
//   '/preferences',
//   authMiddleware,
//   restrictTo('client'),
//   validate(updatePreferencesSchema),
//   aiController.updateUserPreferences
// );

// ── Virtual Try-On — Shape Model Subsystem ───────────────────────────
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

// ── Virtual Try-On — Try-On Subsystem ────────────────────────────────
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
