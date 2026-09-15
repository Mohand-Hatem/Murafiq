import crypto from 'crypto';
import env from '../../../config/env.config.js';
import { logger } from '../../../config/logger.config.js';

/**
 * Generates a unique trace identifier for an AI pipeline request.
 * @returns {string} UUID v4 string
 */
export const createTraceId = () => crypto.randomUUID();

/**
 * Computes a salted pseudonym for userId compliant with Egyptian PDPL data minimization.
 * Never leaks the actual userId across log streams.
 *
 * @param {string|Object} userId
 * @returns {string} 16-character hex digest
 */
export const hashUserId = (userId) => {
  if (!userId) return null;
  const salt = env.JWT_ACCESS_SECRET || 'murafiq_ai_trace_salt';
  return crypto.createHmac('sha256', salt).update(String(userId)).digest('hex').slice(0, 16);
};

/**
 * Estimates USD cost for token consumption.
 * Rates for gemini-3.1-flash-lite:
 * Input: $0.075 / 1M tokens ($0.000000075 / token)
 * Output: $0.30 / 1M tokens ($0.00000030 / token)
 *
 * @param {number} [inputTokens=0]
 * @param {number} [outputTokens=0]
 * @param {string} [_model='gemini-3.1-flash-lite']
 * @returns {number} Cost in USD rounded to 6 decimal places
 */
export const calculateCostUsd = (inputTokens = 0, outputTokens = 0, _model = 'gemini-3.1-flash-lite') => {
  const inCost = (Number(inputTokens) || 0) * 0.000000075;
  const outCost = (Number(outputTokens) || 0) * 0.0000003;
  return Number((inCost + outCost).toFixed(6));
};

/**
 * Emits a structured telemetry log line into Winston per AI pipeline step.
 *
 * PRIVACY INVARIANT (Egyptian PDPL Compliance):
 * Strictly excludes raw user messages, user queries, images, and Cloudinary URLs.
 *
 * @param {Object} entry
 * @param {string} entry.traceId
 * @param {string} entry.step - Pipeline step name (e.g. 'intent', 'compose', 'refusal')
 * @param {string} [entry.model='gemini-3.1-flash-lite']
 * @param {string} [entry.promptVersion='v1.0.0']
 * @param {number} [entry.inputTokens=0]
 * @param {number} [entry.outputTokens=0]
 * @param {number} [entry.latencyMs=0]
 * @param {string|Object} [entry.userId]
 * @param {string} [entry.eventType]
 * @param {boolean} [entry.inDomain]
 * @param {string} [entry.sufficiency]
 * @param {string} [entry.refusalCategory]
 * @returns {Object} The sanitized telemetry payload
 */
export const logTraceStep = (entry = {}) => {
  const {
    traceId,
    step,
    model = env.AI_MODEL_REASONING || 'gemini-3.1-flash-lite',
    promptVersion = 'v1.0.0',
    inputTokens = 0,
    outputTokens = 0,
    latencyMs = 0,
    userId,
    eventType,
    inDomain,
    sufficiency,
    refusalCategory,
    groundedQueriesCount,
  } = entry;

  const payload = {
    traceId: traceId || createTraceId(),
    step: String(step || 'unknown'),
    model: String(model),
    promptVersion: String(promptVersion),
    inputTokens: Number(inputTokens) || 0,
    outputTokens: Number(outputTokens) || 0,
    latencyMs: Number(latencyMs) || 0,
    costUsd: calculateCostUsd(inputTokens, outputTokens, model),
    hashedUserId: userId ? hashUserId(userId) : null,
    eventType: eventType ? String(eventType) : null,
    inDomain: inDomain !== undefined && inDomain !== null ? Boolean(inDomain) : null,
    sufficiency: sufficiency ? String(sufficiency) : null,
    refusalCategory: refusalCategory ? String(refusalCategory) : null,
    groundedQueriesCount: typeof groundedQueriesCount === 'number' ? groundedQueriesCount : 0,
  };

  logger.info(`[AI_TRACE] ${JSON.stringify(payload)}`);
  return payload;
};

export default {
  createTraceId,
  hashUserId,
  calculateCostUsd,
  logTraceStep,
};
