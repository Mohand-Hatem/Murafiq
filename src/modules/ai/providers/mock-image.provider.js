import sharp from 'sharp';
import { ImageGenerationProvider } from './image-generation.interface.js';

let simulatedError = null;
let simulatedDelayMs = 0;

export class MockImageProvider extends ImageGenerationProvider {
  /**
   * Generates a deterministic synthetic JPEG try-on image buffer using Sharp.
   *
   * @param {import('./image-generation.interface.js').TryOnGenerationInput} input
   * @returns {Promise<import('./image-generation.interface.js').TryOnGenerationResult>}
   */
  async generateTryOn({
    personImageBuffer,
    personMimeType = 'image/jpeg', // eslint-disable-line no-unused-vars
    garmentImages = [],
    promptVersion = 'v1',
    resolution = '1024x1024',
  }) {
    const startTime = Date.now();

    if (simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, simulatedDelayMs));
    }

    if (simulatedError) {
      const err = simulatedError;
      throw err;
    }

    if (!personImageBuffer || !Buffer.isBuffer(personImageBuffer)) {
      throw new Error('personImageBuffer must be a valid Buffer');
    }

    if (!Array.isArray(garmentImages) || garmentImages.length === 0) {
      throw new Error('garmentImages must contain at least 1 garment');
    }

    for (const garment of garmentImages) {
      if (!garment.buffer || !Buffer.isBuffer(garment.buffer)) {
        throw new Error('Each garment in garmentImages must have a valid buffer Buffer');
      }
    }

    const [w, h] = String(resolution).split('x').map(Number);
    const width = Number.isInteger(w) && w > 0 ? w : 1024;
    const height = Number.isInteger(h) && h > 0 ? h : 1024;

    // Create authentic visual composite preview using Sharp
    const composites = [];

    // 1. Resize and place the person/shape-model image on the left/center
    try {
      const personWidth = Math.floor(width * 0.65);
      const personHeight = height - 60;
      const resizedPerson = await sharp(personImageBuffer)
        .resize(personWidth, personHeight, { fit: 'inside' })
        .toBuffer();

      composites.push({
        input: resizedPerson,
        top: 30,
        left: 30,
      });
    } catch (_err) {
      // fallback gracefully if corrupt buffer
    }

    // 2. Lay out garment thumbnails along the right column
    const thumbSize = Math.min(220, Math.floor((height - 80) / Math.max(garmentImages.length, 1)));
    let currentTop = 30;
    const rightLeft = Math.floor(width * 0.72);

    for (const garment of garmentImages) {
      if (garment?.buffer && Buffer.isBuffer(garment.buffer)) {
        try {
          const thumb = await sharp(garment.buffer)
            .resize(thumbSize, thumbSize, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
            .toBuffer();

          composites.push({
            input: thumb,
            top: currentTop,
            left: rightLeft,
          });

          currentTop += thumbSize + 15;
        } catch (_err) {
          // continue with remaining
        }
      }
    }

    let pipeline = sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 245, g: 245, b: 247 },
      },
    });

    if (composites.length > 0) {
      pipeline = pipeline.composite(composites);
    }

    const imageBuffer = await pipeline.jpeg({ quality: 90 }).toBuffer();

    const latencyMs = Date.now() - startTime;

    return {
      imageBuffer,
      mimeType: 'image/jpeg',
      width,
      height,
      promptVersion,
      provider: 'mock',
      latencyMs,
    };
  }

  /**
   * For testing: configure simulated failure.
   * @param {Error|null} error
   */
  setSimulatedError(error) {
    simulatedError = error;
  }

  /**
   * For testing: configure simulated latency delay.
   * @param {number} ms
   */
  setSimulatedDelay(ms) {
    simulatedDelayMs = ms;
  }

  /**
   * Reset mock overrides.
   */
  reset() {
    simulatedError = null;
    simulatedDelayMs = 0;
  }
}

export const mockImageProvider = new MockImageProvider();
export default mockImageProvider;
