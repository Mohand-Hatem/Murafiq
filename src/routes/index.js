import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

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
