import { ImageGenerationProvider } from './image-generation.interface.js';
import { buildTryOnPrompt } from './gemini-image.provider.js';
import env from '../../../config/env.config.js';
import { logger } from '../../../config/logger.config.js';

const OPENROUTER_IMAGES_ENDPOINT = 'https://openrouter.ai/api/v1/images';

export class OpenRouterImageProvider extends ImageGenerationProvider {
  /**
   * Generates a virtual try-on composite using OpenRouter's dedicated Image API.
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
    timeoutMs = env.AI_TRY_ON_TIMEOUT_MS || 60_000,
  }) {
    if (!personImageBuffer || !Buffer.isBuffer(personImageBuffer)) {
      throw new ApiError(400, 'personImageBuffer must be a valid Buffer');
    }

    if (!Array.isArray(garmentImages) || garmentImages.length === 0) {
      throw new ApiError(400, 'garmentImages must contain at least 1 garment');
    }

    const apiKey = env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new ApiError(500, 'OPENROUTER_API_KEY is not configured');
    }

    const model = env.AI_TRY_ON_MODEL || 'google/gemini-3.1-flash-lite-image';
    const [w, h] = String(resolution).split('x').map(Number);
    const width = Number.isInteger(w) && w > 0 ? w : 1024;
    const height = Number.isInteger(h) && h > 0 ? h : 1024;

    const promptText = buildTryOnPrompt({ garments: garmentImages, promptVersion });

    // Assemble input_references adhering strictly to OpenRouter's validated schema:
    // Reference 1: Target person / Shape Model
    // References 2..N: Garment images
    const inputReferences = [
      {
        type: 'image_url',
        image_url: {
          url: `data:${personMimeType};base64,${personImageBuffer.toString('base64')}`,
        },
      },
      ...garmentImages.map((g) => ({
        type: 'image_url',
        image_url: {
          url: `data:${g.mimeType || 'image/jpeg'};base64,${g.buffer.toString('base64')}`,
        },
      })),
    ];

    const payload = {
      model,
      prompt: promptText,
      aspect_ratio: '1:1',
      input_references: inputReferences,
    };

    const startTime = Date.now();
    logger.info(
      `[OpenRouterImageProvider] Initiating try-on image generation (model=${model}, garments=${garmentImages.length}, references=${inputReferences.length})`
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(OPENROUTER_IMAGES_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://murafiq.dev',
          'X-Title': 'Murafiq Virtual Try-On',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError' || err.code === 'ETIMEDOUT') {
        throw new ApiError(504, `OpenRouter image generation timed out after ${timeoutMs}ms`);
      }
      throw new ApiError(502, `Network error communicating with OpenRouter: ${err.message}`);
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      let errorBody = {};
      try {
        errorBody = await response.json();
      } catch {
        // Ignored, fallback to status text
      }

      const rawMessage = errorBody?.error?.message || response.statusText || 'Unknown error';
      // Sanitize message to prevent any accidental token or sensitive information leakage
      const sanitizedMessage = String(rawMessage).replace(/Bearer\s+[a-zA-Z0-9_\-.]+/gi, 'Bearer [REDACTED]');

      logger.warn(
        `[OpenRouterImageProvider] Generation failed with HTTP ${response.status}: ${sanitizedMessage}`
      );

      if (response.status === 401 || response.status === 403) {
        throw new ApiError(response.status, `OpenRouter authentication failure: ${sanitizedMessage}`);
      }

      if (response.status === 402) {
        throw new ApiError(402, `OpenRouter payment/credit error: ${sanitizedMessage}`);
      }

      if (response.status === 429) {
        throw new ApiError(429, `OpenRouter rate limit exceeded: ${sanitizedMessage}`);
      }

      throw new ApiError(
        response.status >= 500 ? 502 : response.status,
        `OpenRouter image generation failed (${response.status}): ${sanitizedMessage}`
      );
    }

    let jsonResponse;
    try {
      jsonResponse = await response.json();
    } catch (err) {
      throw new ApiError(502, `Failed to parse OpenRouter response: ${err.message}`);
    }

    const dataItems = jsonResponse?.data;
    if (!Array.isArray(dataItems) || dataItems.length === 0) {
      throw new ApiError(502, 'OpenRouter returned empty data array for generated image');
    }

    const primaryImage = dataItems[0];
    let imageBuffer;
    let mimeType = primaryImage.media_type || 'image/jpeg';

    if (primaryImage.b64_json) {
      imageBuffer = Buffer.from(primaryImage.b64_json, 'base64');
    } else if (primaryImage.url) {
      // If a URL was returned instead of base64 bytes, fetch the binary image
      try {
        const imgRes = await fetch(primaryImage.url, {
          signal: globalThis.AbortSignal?.timeout?.(15_000),
        });
        if (!imgRes.ok) {
          throw new Error(`Failed to fetch image URL: HTTP ${imgRes.status}`);
        }
        imageBuffer = Buffer.from(await imgRes.arrayBuffer());
        const fetchedMime = imgRes.headers.get('content-type');
        if (fetchedMime) mimeType = fetchedMime;
      } catch (fetchErr) {
        throw new ApiError(502, `Failed to retrieve image from OpenRouter URL: ${fetchErr.message}`);
      }
    } else {
      throw new ApiError(502, 'OpenRouter response missing both b64_json and url fields');
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      throw new ApiError(502, 'OpenRouter produced zero-byte image buffer');
    }

    logger.info(
      `[OpenRouterImageProvider] Successfully generated try-on image (${imageBuffer.length} bytes, ${latencyMs}ms)`
    );

    return {
      imageBuffer,
      mimeType,
      width,
      height,
      promptVersion,
      provider: 'openrouter',
      latencyMs,
    };
  }
}

export const openrouterImageProvider = new OpenRouterImageProvider();
export default openrouterImageProvider;
