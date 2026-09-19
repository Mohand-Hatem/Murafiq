/**
 * Image Generation Provider Interface definition for Phase 15F Virtual Try-On.
 *
 * All image generation providers (Gemini, Mock, etc.) must implement this interface.
 *
 * @typedef {Object} GarmentImageInput
 * @property {Buffer} buffer - Raw garment image buffer
 * @property {string} mimeType - e.g. 'image/jpeg', 'image/png'
 * @property {string} [slot] - e.g. 'top', 'bottom', 'outerwear', 'shoes'
 * @property {string} [label] - Optional garment description or title
 *
 * @typedef {Object} TryOnGenerationInput
 * @property {Buffer} personImageBuffer - Full-body photo buffer of the user (shape model)
 * @property {string} [personMimeType='image/jpeg'] - MIME type of the person image
 * @property {GarmentImageInput[]} garmentImages - Array of 1 to 4 garment images
 * @property {string} [promptVersion='v1'] - Server-controlled prompt template version
 * @property {'512x512'|'1024x1024'} [resolution='1024x1024'] - Requested output resolution
 *
 * @typedef {Object} TryOnGenerationResult
 * @property {Buffer} imageBuffer - Generated try-on composite image buffer
 * @property {string} mimeType - e.g. 'image/jpeg'
 * @property {number} width - e.g. 1024
 * @property {number} height - e.g. 1024
 * @property {string} promptVersion - Version used
 * @property {string} provider - 'gemini' | 'mock'
 * @property {number} latencyMs - Generation duration in milliseconds
 */

export class ImageGenerationProvider {
  /**
   * Generates a virtual try-on image composite.
   *
   * @param {TryOnGenerationInput} input
   * @returns {Promise<TryOnGenerationResult>}
   */
  async generateTryOn(input) { // eslint-disable-line no-unused-vars
    throw new Error('generateTryOn() must be implemented by provider');
  }
}

export default ImageGenerationProvider;
