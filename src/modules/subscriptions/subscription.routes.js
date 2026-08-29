import express from 'express';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import validate from '../../common/middlewares/validate.middleware.js';
import { subscribeSchema, planQuerySchema } from './subscription.validator.js';
import * as subscriptionController from './subscription.controller.js';

const router = express.Router();

// Public / optional auth plan catalogue
router.get('/plans', validate(planQuerySchema, 'query'), subscriptionController.getPlans);

// Authenticated subscription management
router.use(authMiddleware);

router.get('/me', subscriptionController.getMySubscription);
router.get('/me/entitlements', subscriptionController.getMyEntitlements);
router.post('/subscribe', validate(subscribeSchema), subscriptionController.subscribe);
router.post('/cancel', subscriptionController.cancel);

export default router;
