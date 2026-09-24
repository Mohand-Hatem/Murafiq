import express from 'express';
import mongoose from 'mongoose';
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
import aiRoutes from '../modules/ai/ai.routes.js';
import { isFirebaseConnected } from '../config/firebase.config.js';
import { isRedisConnected } from '../config/redis.config.js';

// Demo-scoped subscription routes: read-only plan and entitlement inspection only (no commerce or checkout)
import authMiddleware from '../common/middlewares/auth.middleware.js';
import validate from '../common/middlewares/validate.middleware.js';
import { planQuerySchema } from '../modules/subscriptions/subscription.validator.js';
import * as subscriptionController from '../modules/subscriptions/subscription.controller.js';

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
router.use('/stylists', stylistRoutes);
router.use('/requests', requestRoutes);
router.use('/offers', offerRoutes);
router.use('/bookings', bookingRoutes);
router.use('/chat', chatRoutes);
router.use('/notifications', notificationRoutes);
router.use('/reviews', reviewRoutes);
router.use('/uploads', uploadRoutes);
router.use('/wardrobe', wardrobeRoutes);
router.use('/ai', aiRoutes);

// Demo Subscriptions: Read-only plan catalog & entitlement inspection only.
// Mutating/checkout routes (/checkout, /subscribe, /cancel, /orders, /webhook) are omitted.
const demoSubscriptionRoutes = express.Router();
demoSubscriptionRoutes.get('/plans', validate(planQuerySchema), subscriptionController.getPlans);
demoSubscriptionRoutes.get('/me', authMiddleware, subscriptionController.getMySubscription);
demoSubscriptionRoutes.get('/me/entitlements', authMiddleware, subscriptionController.getMyEntitlements);
router.use('/subscriptions', demoSubscriptionRoutes);

// Note: /payments, /payouts, /coupons, and /admin are completely omitted from /api/demo.
// Unmounted routes naturally return 404 via the central not-found middleware.

// Health check endpoint for /api/demo
router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const isMongoConnected = mongoose.connection.readyState === 1;
    const firebaseStatus = isFirebaseConnected ? 'connected' : 'unavailable';
    const redisStatus = isRedisConnected() ? 'connected' : 'unavailable';

    if (!isMongoConnected) {
      return res.status(503).json({
        success: false,
        status: 'unhealthy',
        mongo: 'disconnected',
        firebase: firebaseStatus,
        redis: redisStatus,
      });
    }

    return ApiResponse.success(res, {
      message: 'Demo server is healthy',
      data: {
        status: 'healthy',
        mongo: 'connected',
        firebase: firebaseStatus,
        redis: redisStatus,
      },
    });
  })
);

export default router;
