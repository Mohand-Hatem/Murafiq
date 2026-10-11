/**
 * Shopping Provider Factory (shopping-provider.factory.js)
 *
 * Resolves the configured commercial Shopping Search Provider ('mock' | 'serper' | 'serpapi').
 * Follows the Murafiq Provider Factory pattern with test overrides and production safety checks.
 */

import env from '../../../../config/env.config.js';
import { mockShoppingProvider } from './mock-shopping.provider.js';
import { serperShoppingProvider } from './serper-shopping.provider.js';
import { serpapiShoppingProvider } from './serpapi-shopping.provider.js';

let providerOverride = null;

/**
 * Resolves the configured Shopping Provider.
 *
 * @param {'mock'|'serper'|'serpapi'} [providerName]
 * @returns {import('./shopping-provider.interface.js').ShoppingProviderInterface}
 */
export const getShoppingProvider = (providerName = env.SHOPPING_PROVIDER) => {
  if (providerOverride) {
    return providerOverride;
  }

  // In test environment, default to mock provider unless explicitly overridden
  if (env.NODE_ENV === 'test' && !providerName) {
    return mockShoppingProvider;
  }

  const selected = String(providerName || 'mock').toLowerCase().trim();

  if (selected === 'mock') {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'Configuration error: Refusing to use mock shopping provider in production. Set SHOPPING_PROVIDER=serper or serpapi with appropriate API keys.'
      );
    }
    return mockShoppingProvider;
  }

  if (selected === 'serper') {
    return serperShoppingProvider;
  }

  if (selected === 'serpapi') {
    return serpapiShoppingProvider;
  }

  throw new Error(
    `Unknown shopping provider: "${providerName}". Supported providers are 'mock', 'serper', and 'serpapi'.`
  );
};

/**
 * Injects a test override for the shopping provider.
 *
 * @param {import('./shopping-provider.interface.js').ShoppingProviderInterface|null} provider
 */
export const setShoppingProvider = (provider) => {
  providerOverride = provider;
};

export default {
  getShoppingProvider,
  setShoppingProvider,
};
