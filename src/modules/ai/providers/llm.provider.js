import { GoogleGenAI } from '@google/genai';
import env from '../../../config/env.config.js';
import { logger } from '../../../config/logger.config.js';

let genAiClient = null;

/**
 * Lazily initializes and caches the GoogleGenAI instance.
 * @returns {GoogleGenAI}
 */
export const getGenAiClient = () => {
  if (!genAiClient) {
    genAiClient = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }
  return genAiClient;
};

/**
 * Overrides the cached client instance (primarily for testing and mock injection).
 * @param {Object|null} client
 */
export const setGenAiClient = (client) => {
  genAiClient = client;
};

/**
 * Checks whether an error is transient (e.g. rate limit, temporary server error, network timeout).
 * @param {Error|Object} err
 * @returns {boolean}
 */
const isTransientError = (err) => {
  if (!err) return false;
  const status = err.status || err.statusCode || err.response?.status;
  if ([429, 500, 502, 503, 504].includes(status)) return true;

  const message = String(err.message || '').toLowerCase();
  return (
    message.includes('resource_exhausted') ||
    message.includes('unavailable') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('etimedout') ||
    message.includes('econnreset') ||
    message.includes('fetch failed') ||
    message.includes('rate limit')
  );
};

/**
 * Executes a promise with an enforced timeout cutoff.
 * @param {Promise} promise
 * @param {number} ms
 * @returns {Promise}
 */
const executeWithTimeout = (promise, ms) => {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`LLM provider call timed out after ${ms}ms`);
      err.code = 'ETIMEDOUT';
      reject(err);
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
};

/**
 * Resolves the configured model ID according to the task type.
 * Default is gemini-3.1-flash-lite via env configuration.
 *
 * @param {'reasoning'|'vision'} task
 * @returns {string}
 */
export const resolveModel = (task = 'reasoning') => {
  if (task === 'vision') {
    return env.AI_MODEL_VISION || 'gemini-3.1-flash-lite';
  }
  return env.AI_MODEL_REASONING || 'gemini-3.1-flash-lite';
};

/**
 * Primary LLM completion seam for the AI module.
 * The only file in the AI module that calls @google/genai.
 *
 * @param {Object} params
 * @param {'reasoning'|'vision'} [params.task='reasoning']
 * @param {string} [params.systemPrompt]
 * @param {Array|Object|string} params.userParts
 * @param {Object} [params.responseSchema]
 * @param {number} [params.temperature=0.2]
 * @param {number} [params.timeoutMs=15000]
 * @returns {Promise<{ data: Object, usage: { inputTokens: number, outputTokens: number }, latencyMs: number }>}
 */
export const complete = async ({
  task = 'reasoning',
  systemPrompt,
  userParts = [],
  responseSchema,
  tools = null,
  temperature = 0.2,
  timeoutMs = 15_000,
}) => {
  const model = resolveModel(task);
  const ai = getGenAiClient();

  const parts = Array.isArray(userParts)
    ? userParts.map((p) => (typeof p === 'string' ? { text: p } : p))
    : typeof userParts === 'string'
    ? [{ text: userParts }]
    : [userParts];

  const contents = [
    {
      role: 'user',
      parts,
    },
  ];

  const config = {
    temperature,
    responseMimeType: 'application/json',
  };

  if (systemPrompt) {
    config.systemInstruction = systemPrompt;
  }

  if (responseSchema) {
    config.responseSchema = responseSchema;
  }

  if (tools) {
    config.tools = tools;
  }

  const startTime = Date.now();
  let lastError = null;

  // Single retry on transient failure
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await executeWithTimeout(
        ai.models.generateContent({
          model,
          contents,
          config,
        }),
        timeoutMs
      );

      const latencyMs = Date.now() - startTime;
      const rawText = response?.text?.trim() || '';

      if (!rawText) {
        throw new ApiError(502, 'AI provider returned an empty response');
      }

      let parsedData;
      try {
        parsedData = JSON.parse(rawText);
      } catch (parseErr) {
        logger.error('LLM provider non-JSON output:', { rawText, error: parseErr.message });
        throw new ApiError(502, 'AI provider returned malformed JSON');
      }

      const inputTokens = response?.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response?.usageMetadata?.candidatesTokenCount || 0;
      const groundingMetadata = response?.candidates?.[0]?.groundingMetadata || null;

      return {
        data: parsedData,
        usage: {
          inputTokens,
          outputTokens,
        },
        groundingMetadata,
        latencyMs,
      };
    } catch (err) {
      lastError = err;
      const transient = isTransientError(err);

      if (attempt === 1 && transient) {
        logger.warn(`LLM provider call transient error (attempt 1/2), retrying: ${err.message}`);
        // Backoff before retry to allow rate-limit window to clear
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }

      break;
    }
  }

  const latencyMs = Date.now() - startTime;
  logger.error('LLM provider call failed closed:', {
    model,
    task,
    latencyMs,
    error: lastError?.message,
    code: lastError?.code,
    status: lastError?.status,
  });

  if (lastError instanceof ApiError) {
    throw lastError;
  }

  if (lastError?.code === 'ETIMEDOUT') {
    throw new ApiError(504, `AI provider request timed out after ${timeoutMs}ms`);
  }

  throw new ApiError(502, `AI provider unavailable or failed: ${lastError?.message || 'Unknown error'}`);
};

export default {
  complete,
  resolveModel,
  getGenAiClient,
  setGenAiClient,
};
