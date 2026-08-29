import express from 'express';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import validate from '../../common/middlewares/validate.middleware.js';
import { reportMessageSchema, getMessagesSchema, sendMessageSchema } from './chat.validator.js';
import chatController from './chat.controller.js';

const router = express.Router();

// All chat routes require an authenticated user
router.use(authMiddleware);

router.post('/token', chatController.getChatToken);
router.get('/:conversationId/messages', validate(getMessagesSchema), chatController.getMessages);
router.post('/:conversationId/messages', validate(sendMessageSchema), chatController.sendMessage);

// Viewer-initiated report. With no ML classifier in the pipeline, this is the only
// cover for threats, insults and harassment — see §I.2. It records a PENDING event for
// admin review and never enforces on its own.
router.post(
  '/:conversationId/report',
  validate(reportMessageSchema),
  chatController.reportMessage
);

export default router;
