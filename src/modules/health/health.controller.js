import mongoose from 'mongoose';
import { isFirebaseConnected } from '../../config/firebase.config.js';
import { checkRedisHealth, isRedisConnected } from '../../config/redis.config.js';

/**
 * Health check controller.
 *
 * Readiness semantics:
 * - Mongo unavailable (readyState !== 1) -> HTTP 503 Service Unavailable
 * - Redis unavailable                   -> HTTP 200 OK with degraded status
 * - Firebase unavailable                -> HTTP 200 OK with degraded status
 * - All dependencies connected          -> HTTP 200 OK with healthy status
 */
export const getHealth = asyncHandler(async (req, res) => {
  const isMongoConnected = mongoose.connection.readyState === 1;
  const firebaseStatus = isFirebaseConnected ? 'connected' : 'unavailable';

  let redisStatus = 'unavailable';
  if (isRedisConnected()) {
    const isHealthy = await checkRedisHealth();
    redisStatus = isHealthy ? 'connected' : 'unavailable';
  }

  if (!isMongoConnected) {
    return res.status(503).json({
      success: false,
      status: 'unhealthy',
      mongo: 'disconnected',
      firebase: firebaseStatus,
      redis: redisStatus,
    });
  }

  const isDegraded = firebaseStatus !== 'connected' || redisStatus !== 'connected';
  const isDemo = req.baseUrl?.includes('demo') || req.originalUrl?.includes('/demo');
  const serverPrefix = isDemo ? 'Demo server' : 'Server';
  const overallStatus = isDemo ? 'healthy' : (isDegraded ? 'degraded' : 'healthy');

  return ApiResponse.success(res, {
    message: `${serverPrefix} is healthy`,
    data: {
      status: overallStatus,
      mongo: 'connected',
      firebase: firebaseStatus,
      redis: redisStatus,
    },
  });
});

export default { getHealth };
