import crypto from 'node:crypto';
import { requestContext } from '../utils/request-context.js';

const MAX_REQUEST_ID_LENGTH = 128;
const SAFE_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Validates and bounds an incoming request identifier.
 * Ensures the value is non-empty, <= 128 characters, and strictly alphanumeric with hyphens/underscores
 * to protect against CRLF log injection and header tampering.
 *
 * @param {unknown} rawId
 * @returns {string} Sanitized ID or freshly generated UUID
 */
export const sanitizeRequestId = (rawId) => {
  if (
    typeof rawId === 'string' &&
    rawId.length > 0 &&
    rawId.length <= MAX_REQUEST_ID_LENGTH &&
    SAFE_REQUEST_ID_REGEX.test(rawId)
  ) {
    return rawId;
  }
  return crypto.randomUUID();
};

/**
 * Express middleware for request correlation tracking.
 * - Extracts or generates safe X-Request-Id
 * - Injects X-Request-Id header on response
 * - Sets req.id for downstream handlers
 * - Runs downstream pipeline inside AsyncLocalStorage context
 */
export const correlationIdMiddleware = (req, res, next) => {
  const rawId = req.headers['x-request-id'] || req.headers['x-correlation-id'];
  const requestId = sanitizeRequestId(rawId);

  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);

  requestContext.run({ requestId, source: 'http' }, () => {
    next();
  });
};

export default correlationIdMiddleware;
