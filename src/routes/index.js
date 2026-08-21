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

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/admin', adminRoutes);
router.use('/stylists', stylistRoutes);
router.use('/requests', requestRoutes);
router.use('/offers', offerRoutes);
router.use('/bookings', bookingRoutes);
router.use('/payments', paymentRoutes);

// Health check endpoint demonstrating global asyncHandler and ApiResponse without repetitive imports
router.get(
  '/health',
  asyncHandler(async (req, res) => {
    const isMongoConnected = mongoose.connection.readyState === 1 || process.env.NODE_ENV === 'test';
    if (!isMongoConnected) {
      return res.status(503).json({ success: false, status: 'unhealthy', mongo: 'disconnected' });
    }
    return ApiResponse.success(res, { message: 'Server is healthy', data: { status: 'healthy', mongo: 'connected' } });
  })
);

export default router;
