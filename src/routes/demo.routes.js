import express from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import userRoutes from '../modules/users/user.routes.js';
import locationRoutes from '../modules/users/location.routes.js';
import stylistRoutes from '../modules/stylists/stylist.routes.js';
import requestRoutes from '../modules/requests/request.routes.js';
import offerRoutes from '../modules/offers/offer.routes.js';
import bookingRoutes from '../modules/bookings/booking.routes.js';
import chatRoutes from '../modules/chat/chat.routes.js';
import notificationRoutes from '../modules/notifications/notification.routes.js';
import reviewRoutes from '../modules/reviews/review.routes.js';
import uploadRoutes from '../modules/uploads/upload.routes.js';
import wardrobeRoutes from '../modules/wardrobe/wardrobe.routes.js';
import { getHealth } from '../modules/health/health.controller.js';

import authMiddleware from '../common/middlewares/auth.middleware.js';
import { restrictTo } from '../common/middlewares/rbac.middleware.js';
import validate from '../common/middlewares/validate.middleware.js';
import { planQuerySchema } from '../modules/subscriptions/subscription.validator.js';
import * as subscriptionController from '../modules/subscriptions/subscription.controller.js';
import * as aiController from '../modules/ai/ai.controller.js';
import * as wardrobeController from '../modules/wardrobe/wardrobe.controller.js';
import {
  stylistRequestSchema,
  requestIdParamSchema,
  stylistFeedbackSchema,
  createConversationSchema,
  conversationIdParamSchema,
  listConversationsSchema,
  listMessagesSchema,
} from '../modules/ai/ai.validator.js';
import { saveFromChatSchema } from '../modules/wardrobe/wardrobe.validator.js';

import notFoundMiddleware from '../common/middlewares/not-found.middleware.js';

const router = express.Router();

// Tag all requests under /api/demo with bookingMode: 'demo'
router.use((req, _res, next) => {
  req.bookingMode = 'demo';
  next();
});

// Shared Modules mounted for Demo trial release
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/locations', locationRoutes);
// Stylist payouts query is omitted in demo trial release (COD mode has no platform disbursements)
router.use('/stylists/me/payouts', notFoundMiddleware);
router.use('/stylists', stylistRoutes);
router.use('/requests', requestRoutes);
router.use('/offers', offerRoutes);
router.use('/bookings', bookingRoutes);
router.use('/chat', chatRoutes);
router.use('/notifications', notificationRoutes);
router.use('/reviews', reviewRoutes);
router.use('/uploads', uploadRoutes);
router.use('/wardrobe', wardrobeRoutes);
 
// Demo AI: Free-tier conversational styling and chat history only.
// Paid-only features (Virtual Try-On, Shape Models, and Outfits catalog) are omitted.
const demoAiRoutes = express.Router();
demoAiRoutes.post('/stylist', authMiddleware, restrictTo('client'), validate(stylistRequestSchema), aiController.handleStylistRequest);
demoAiRoutes.get('/stylist/requests/:requestId', authMiddleware, restrictTo('client'), validate(requestIdParamSchema), aiController.getStylistRequestStatus);
demoAiRoutes.post('/stylist/requests/:requestId/cancel', authMiddleware, restrictTo('client'), validate(requestIdParamSchema), aiController.cancelStylistRequest);
demoAiRoutes.post('/stylist/feedback', authMiddleware, restrictTo('client'), validate(stylistFeedbackSchema), aiController.submitStylistFeedback);
demoAiRoutes.post('/wardrobe/from-chat', authMiddleware, restrictTo('client'), validate(saveFromChatSchema), wardrobeController.saveFromChat);
demoAiRoutes.post('/conversations', authMiddleware, restrictTo('client'), validate(createConversationSchema), aiController.createConversation);
demoAiRoutes.get('/conversations', authMiddleware, restrictTo('client'), validate(listConversationsSchema), aiController.listConversations);
demoAiRoutes.get('/conversations/:conversationId', authMiddleware, restrictTo('client'), validate(conversationIdParamSchema), aiController.getConversation);
demoAiRoutes.get('/conversations/:conversationId/messages', authMiddleware, restrictTo('client'), validate(listMessagesSchema), aiController.getConversationMessages);
demoAiRoutes.delete('/conversations/:conversationId', authMiddleware, restrictTo('client'), validate(conversationIdParamSchema), aiController.deleteConversation);
router.use('/ai', demoAiRoutes);

// Demo Subscriptions: Read-only plan catalog & entitlement inspection only.
// Mutating/checkout routes (/checkout, /subscribe, /cancel, /orders, /webhook) are omitted.
const demoSubscriptionRoutes = express.Router();
demoSubscriptionRoutes.get('/plans', validate(planQuerySchema), subscriptionController.getPlans);
demoSubscriptionRoutes.get('/me', authMiddleware, subscriptionController.getMySubscription);
demoSubscriptionRoutes.get('/me/entitlements', authMiddleware, subscriptionController.getMyEntitlements);
router.use('/subscriptions', demoSubscriptionRoutes);

// Note: /payments, /payouts, /coupons, /admin, /stylists/me/payouts, and paid-only AI (/try-on, /shape-model, /outfits) are completely omitted from /api/demo.
// Unmounted routes naturally return 404 via the central not-found middleware.

// Health check endpoint for /api/demo
router.get('/health', getHealth);

export default router;
