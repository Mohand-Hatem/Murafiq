import express from 'express';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import { restrictTo } from '../../common/middlewares/rbac.middleware.js';
import validate from '../../common/middlewares/validate.middleware.js';
import { ROLES } from '../../common/constants/roles.constant.js';
import { addBlockedDomainSchema, getModerationEventsSchema } from './moderation.validator.js';
import {
  addBlockedWordSchema,
  addBlockedWordsBulkSchema,
  getBlockedWordsSchema,
  deleteBlockedWordSchema,
} from './blocked-word.validator.js';
import moderationController from './moderation.controller.js';

const router = express.Router();

router.use(authMiddleware);

// Flagged moderation events queue (accessible to Admin and Operator)
router.get(
  '/events',
  restrictTo(ROLES.ADMIN, ROLES.OPERATOR),
  validate(getModerationEventsSchema, 'query'),
  moderationController.getEvents
);
router.post(
  '/events/:id/confirm',
  restrictTo(ROLES.ADMIN, ROLES.OPERATOR),
  moderationController.confirmEvent
);
router.post(
  '/events/:id/overturn',
  restrictTo(ROLES.ADMIN, ROLES.OPERATOR),
  moderationController.overturnEvent
);

// Blocked domain and policy violation administration (Admin only)
router.get('/blocked-domains', restrictTo(ROLES.ADMIN), moderationController.getBlockedDomains);
router.post('/blocked-domains', restrictTo(ROLES.ADMIN), validate(addBlockedDomainSchema), moderationController.addBlockedDomain);
router.delete('/blocked-domains/:id', restrictTo(ROLES.ADMIN), moderationController.deleteBlockedDomain);

// Blocked word administration (Admin only)
router.get(
  '/blocked-words',
  restrictTo(ROLES.ADMIN),
  validate(getBlockedWordsSchema, 'query'),
  moderationController.getBlockedWords
);
router.post(
  '/blocked-words',
  restrictTo(ROLES.ADMIN),
  validate(addBlockedWordSchema),
  moderationController.addBlockedWord
);
router.post(
  '/blocked-words/bulk',
  restrictTo(ROLES.ADMIN),
  validate(addBlockedWordsBulkSchema),
  moderationController.addBlockedWordsBulk
);
router.delete(
  '/blocked-words/:id',
  restrictTo(ROLES.ADMIN),
  validate(deleteBlockedWordSchema),
  moderationController.deleteBlockedWord
);

router.patch('/violations/:id/forgive', restrictTo(ROLES.ADMIN), moderationController.forgiveViolationStrike);

export default router;
