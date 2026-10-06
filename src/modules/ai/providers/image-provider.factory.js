import env from '../../../config/env.config.js';
import { geminiImageProvider } from './gemini-image.provider.js';
import { mockImageProvider } from './mock-image.provider.js';
let providerOverride = null;

/**
 * Resolves the configured Image Generation Provider.
 *
 * Enforces production boot safety: refusing to allow 'mock' in production.
 *
 * @param {'gemini'|'mock'} [providerName]
 * @returns {import('./image-generation.interface.js').ImageGenerationProvider}
 */
export const getImageProvider = (providerName = env.AI_IMAGE_PROVIDER) => {
  if (providerOverride) {
    return providerOverride;
  }

  const selected = String(providerName || 'gemini').toLowerCase();

  if (selected === 'mock') {
    if (env.NODE_ENV === 'production') {
      throw new Error('Security violation: Refusing to use mock image provider in production environment');
    }
    return mockImageProvider;
  }

  if (selected === 'gemini') {
    return geminiImageProvider;
  }

  throw new Error(`Unknown image provider: ${providerName}. Supported providers are 'gemini' and 'mock'.`);
};

/**
 * Sets a test override for the image provider.
 *
 * @param {import('./image-generation.interface.js').ImageGenerationProvider|null} provider
 */
export const setImageProvider = (provider) => {
  providerOverride = provider;
};

export default {
  getImageProvider,
  setImageProvider,
};
