import { ImageGenerationProvider } from './image-generation.interface.js';
import { getGenAiClient } from './llm.provider.js';
import env from '../../../config/env.config.js';
import { logger } from '../../../config/logger.config.js';

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

const executeWithTimeout = (promise, ms) => {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Image generation call timed out after ${ms}ms`);
      err.code = 'ETIMEDOUT';
      reject(err);
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
};

/**
 * Builds the strictly server-controlled prompt for Gemini Virtual Try-On.
 *
 * @param {Object} params
 * @param {Array} params.garments
 * @param {string} [params.promptVersion='v1']
 * @returns {string}
 */
export const buildTryOnPrompt = ({ garments = [], promptVersion = 'v1' }) => {
  const garmentDescriptions = garments
    .map((g, idx) => `Garment ${idx + 1} (${g.slot || 'item'}): ${g.label || 'clothing article'}`)
    .join('\n');

  return `Task: High-fidelity Photorealistic Virtual Try-On Composite (Version: ${promptVersion})
Reference Image 1: The target person (Shape Model). Maintain exact facial identity, head/body proportions, skin tone, hairstyle, and body structure.
The subsequent reference images show the exact garment(s) to be worn by the person:
${garmentDescriptions}

Instructions:
1. Dress the person from Reference Image 1 in the exact garment(s) provided.
2. Realistically drape each garment over the body, matching natural wrinkles, seams, fabric weight, tension, and shadows.
3. Preserve all garment details accurately: colors, patterns, textures, necklines, sleeves, hems, and brand emblems.
4. If multiple garments are provided, layer them logically (e.g. top under outerwear).
5. Output a clean, full-body portrait on a neutral, well-lit studio backdrop.
6. The resulting image must be clean, modest, dignified, and natural-looking.`;
};

export class GeminiImageProvider extends ImageGenerationProvider {
  /**
   * Generates a virtual try-on image using Google Gemini / Imagen models.
   *
   * @param {import('./image-generation.interface.js').TryOnGenerationInput} input
   * @returns {Promise<import('./image-generation.interface.js').TryOnGenerationResult>}
   */
  async generateTryOn({
    personImageBuffer,
    personMimeType = 'image/jpeg',
    garmentImages = [],
    promptVersion = 'v1',
    resolution = '1024x1024',
    timeoutMs = 60_000,
  }) {
    if (!personImageBuffer || !Buffer.isBuffer(personImageBuffer)) {
      throw new ApiError(400, 'personImageBuffer must be a valid Buffer');
    }

    if (!Array.isArray(garmentImages) || garmentImages.length === 0) {
      throw new ApiError(400, 'garmentImages must contain at least 1 garment');
    }

    const ai = getGenAiClient();
    const model = env.AI_MODEL_IMAGE || 'gemini-3.1-flash-lite-image';
    const [w, h] = String(resolution).split('x').map(Number);
    const width = Number.isInteger(w) && w > 0 ? w : 1024;
    const height = Number.isInteger(h) && h > 0 ? h : 1024;

    const promptText = buildTryOnPrompt({ garments: garmentImages, promptVersion });

    // Assemble multimodal parts: text prompt + person image + garment images
    const parts = [
      { text: promptText },
      {
        inlineData: {
          data: personImageBuffer.toString('base64'),
          mimeType: personMimeType || 'image/jpeg',
        },
      },
      ...garmentImages.map((g) => ({
        inlineData: {
          data: g.buffer.toString('base64'),
          mimeType: g.mimeType || 'image/jpeg',
        },
      })),
    ];

    const startTime = Date.now();
    let lastError = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        let resultBuffer = null;

        // Try generateContent with image output modality if available
        if (typeof ai.models.generateContent === 'function') {
          const response = await executeWithTimeout(
            ai.models.generateContent({
              model,
              contents: [{ role: 'user', parts }],
            }),
            timeoutMs
          );

          // Check for image data in candidates
          const candidates = response?.candidates || [];
          for (const candidate of candidates) {
            const resParts = candidate?.content?.parts || [];
            for (const part of resParts) {
              if (part?.inlineData?.data) {
                resultBuffer = Buffer.from(part.inlineData.data, 'base64');
                break;
              }
            }
            if (resultBuffer) break;
          }
        }

        // Fallback: If generateImages is provided on the SDK
        if (!resultBuffer && typeof ai.models.generateImages === 'function') {
          const imgResponse = await executeWithTimeout(
            ai.models.generateImages({
              model,
              prompt: promptText,
              config: {
                numberOfImages: 1,
                outputMimeType: 'image/jpeg',
                aspectRatio: '1:1',
              },
            }),
            timeoutMs
          );

          const generated = imgResponse?.generatedImages?.[0]?.image?.imageBytes;
          if (generated) {
            resultBuffer = Buffer.from(generated, 'base64');
          }
        }

        if (!resultBuffer) {
          throw new ApiError(502, 'AI image provider did not return image data');
        }

        const latencyMs = Date.now() - startTime;

        return {
          imageBuffer: resultBuffer,
          mimeType: 'image/jpeg',
          width,
          height,
          promptVersion,
          provider: 'gemini',
          latencyMs,
        };
      } catch (err) {
        lastError = err;
        const transient = isTransientError(err);

        if (attempt === 1 && transient) {
          logger.warn(`Gemini image generation transient error (attempt 1/2), retrying: ${err.message}`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        break;
      }
    }

    const latencyMs = Date.now() - startTime;
    logger.error('Gemini image generation failed closed:', {
      model,
      latencyMs,
      error: lastError?.message,
      code: lastError?.code,
    });

    if (lastError instanceof ApiError) {
      throw lastError;
    }

    if (lastError?.code === 'ETIMEDOUT') {
      throw new ApiError(504, `Image generation timed out after ${timeoutMs}ms`);
    }

    throw new ApiError(502, `AI image generation failed: ${lastError?.message || 'Unknown error'}`);
  }
}

export const geminiImageProvider = new GeminiImageProvider();
export default geminiImageProvider;
