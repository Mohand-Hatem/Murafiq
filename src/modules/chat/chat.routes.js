import express from 'express';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import validate from '../../common/middlewares/validate.middleware.js';
import { getMessagesSchema, sendMessageSchema } from './chat.validator.js';
import chatController from './chat.controller.js';

const router = express.Router();

// All chat routes require an authenticated user
router.use(authMiddleware);

router.post('/token', chatController.getChatToken);
router.get('/:conversationId/messages', validate(getMessagesSchema), chatController.getMessages);
router.post('/:conversationId/messages', validate(sendMessageSchema), chatController.sendMessage);

export default router;
