import express from 'express';
import authMiddleware from '../../common/middlewares/auth.middleware.js';
import validate from '../../common/middlewares/validate.middleware.js';
import { webhookRateLimiter } from '../../common/middlewares/auth-rate-limiter.middleware.js';
import { subscribeSchema, checkoutSchema, planQuerySchema } from './subscription.validator.js';
import * as subscriptionController from './subscription.controller.js';

const router = express.Router();

// Public / optional auth plan catalogue
router.get('/plans', validate(planQuerySchema, 'query'), subscriptionController.getPlans);

// Public Webhook callback from Paymob / payment provider with dedicated rate limiting
router.post('/webhook', webhookRateLimiter, subscriptionController.webhook);

// Authenticated subscription management
router.use(authMiddleware);

router.get('/me', subscriptionController.getMySubscription);
router.get('/me/entitlements', subscriptionController.getMyEntitlements);
router.post('/checkout', validate(checkoutSchema), subscriptionController.checkout);
router.post('/subscribe', validate(subscribeSchema), subscriptionController.subscribe);
router.post('/cancel', subscriptionController.cancel);

export default router;

