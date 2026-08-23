import express from 'express';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import validate from '../../common/middlewares/validate.middleware.js';
import { notificationIdSchema, deviceTokenSchema } from './notification.validator.js';
import notificationController from './notification.controller.js';

const router = express.Router();

// All notification routes require an authenticated user
router.use(authMiddleware);

router.get('/', notificationController.getMyNotifications);
router.get('/unread-count', notificationController.getUnreadCount);
router.patch('/read-all', notificationController.markAllAsRead);
router.patch('/:id/read', validate(notificationIdSchema), notificationController.markAsRead);
router.post('/device-token', validate(deviceTokenSchema), notificationController.registerDeviceToken);
router.delete('/device-token', validate(deviceTokenSchema), notificationController.removeDeviceToken);

export default router;
