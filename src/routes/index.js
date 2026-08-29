import express from 'express';
import mongoose from 'mongoose';
import authRoutes from '../modules/auth/auth.routes.js';
import userRoutes from '../modules/users/user.routes.js';
import adminRoutes from '../modules/admin/admin.routes.js';
import stylistRoutes from '../modules/stylists/stylist.routes.js';
import requestRoutes from '../modules/requests/request.routes.js';
import offerRoutes from '../modules/offers/offer.routes.js';
import bookingRoutes from '../modules/bookings/booking.routes.js';
import paymentRoutes from '../modules/payments/payment.routes.js';
import chatRoutes from '../modules/chat/chat.routes.js';
import notificationRoutes from '../modules/notifications/notification.routes.js';
import reviewRoutes from '../modules/reviews/review.routes.js';
import uploadRoutes from '../modules/uploads/upload.routes.js';
import couponRoutes from '../modules/coupons/coupon.routes.js';
import payoutRoutes from '../modules/payouts/payout.routes.js';
import subscriptionRoutes from '../modules/subscriptions/subscription.routes.js';
import moderationRoutes from '../modules/moderation/moderation.routes.js';
import locationRoutes from '../modules/users/location.routes.js';
import { isFirebaseConnected } from '../config/firebase.config.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/locations', locationRoutes);
router.use('/admin/moderation', moderationRoutes);
router.use('/admin', adminRoutes);
router.use('/stylists', stylistRoutes);
router.use('/requests', requestRoutes);
router.use('/offers', offerRoutes);
router.use('/bookings', bookingRoutes);
router.use('/payments', paymentRoutes);
router.use('/chat', chatRoutes);
router.use('/notifications', notificationRoutes);
router.use('/reviews', reviewRoutes);
router.use('/uploads', uploadRoutes);
router.use('/payouts', payoutRoutes);
router.use('/coupons', couponRoutes);
router.use('/subscriptions', subscriptionRoutes);

// Health check endpoint demonstrating global asyncHandler and ApiResponse without repetitive imports
router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const isMongoConnected = mongoose.connection.readyState === 1;
    const firebaseStatus = isFirebaseConnected ? 'connected' : 'unavailable';
    const redisStatus = 'not_configured';

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
      message: 'Server is healthy',
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
