import { logger } from '../../config/logger.config.js';

/**
 * Wraps an asynchronous event listener with error interception.
 * Prevents unhandled Promise rejections from crashing the Node.js process
 * while preserving full error stack and payload observability.
 *
 * @param {string} listenerName - Human-readable identifier for telemetry
 * @param {Function} handler - The async callback function (payload) => Promise<void>
 * @returns {Function} Safe event listener callback
 */
export const safeListener = (listenerName, handler) => {
  return async (...args) => {
    try {
      await handler(...args);
    } catch (err) {
      logger.error(`[EventBus] Error in listener '${listenerName}':`, {
        error: err.message,
        stack: err.stack,
        args,
      });
    }
  };
};

export default safeListener;
