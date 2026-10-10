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
  if (err.code === 'ETIMEDOUT' || err.isLocalTimeout) return false;
  const status = err.status || err.statusCode || err.response?.status;
  if ([429, 500, 502, 503].includes(status)) return true;

  const message = String(err.message || '').toLowerCase();
  return (
    message.includes('resource_exhausted') ||
    message.includes('unavailable') ||
    message.includes('rate limit') ||
    message.includes('econnreset') ||
    message.includes('fetch failed')
  );
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
  const overallDeadline = startTime + timeoutMs;
  let lastError = null;

  // Single retry on transient failure
  for (let attempt = 1; attempt <= 2; attempt++) {
    const remainingBudgetMs = overallDeadline - Date.now();
    if (remainingBudgetMs <= 500) {
      const timeoutErr = new Error(`LLM provider call timed out after ${timeoutMs}ms`);
      timeoutErr.code = 'ETIMEDOUT';
      timeoutErr.isLocalTimeout = true;
      lastError = timeoutErr;
      break;
    }

    const abortController = new AbortController();
    let timeoutTimer;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutTimer = setTimeout(() => {
        try {
          abortController.abort();
        } catch {
          // ignore
        }
        const err = new Error(`LLM provider call timed out after ${remainingBudgetMs}ms`);
        err.code = 'ETIMEDOUT';
        err.isLocalTimeout = true;
        reject(err);
      }, remainingBudgetMs);
    });

    try {
      const callConfig = {
        ...config,
        abortSignal: abortController.signal,
      };

      const generatePromise = ai.models.generateContent({
        model,
        contents,
        config: callConfig,
      });

      const response = await Promise.race([generatePromise, timeoutPromise]);
      clearTimeout(timeoutTimer);

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

      return {
        data: parsedData,
        usage: {
          inputTokens,
          outputTokens,
        },
        latencyMs,
      };
    } catch (err) {
      clearTimeout(timeoutTimer);
      try {
        abortController.abort();
      } catch {
        // ignore
      }
      lastError = err;
      const transient = isTransientError(err);
      const remainingTime = overallDeadline - Date.now();

      if (attempt === 1 && transient && remainingTime > 2500) {
        logger.warn(`LLM provider call transient error (attempt 1/2), retrying: ${err.message}`);
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

  if (lastError?.code === 'ETIMEDOUT' || lastError?.isLocalTimeout || lastError?.name === 'AbortError') {
    throw new ApiError(504, `AI provider request timed out after ${timeoutMs}ms`);
  }

  throw new ApiError(502, 'AI provider is temporarily unavailable. Please try again shortly.');
};

export default {
  complete,
  resolveModel,
  getGenAiClient,
  setGenAiClient,
};
