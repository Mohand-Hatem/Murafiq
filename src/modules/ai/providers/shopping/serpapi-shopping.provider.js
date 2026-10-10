/**
 * SerpApi Google Shopping Provider (serpapi-shopping.provider.js)
 *
 * Integrates with SerpApi Google Shopping engine to fetch real, structured
 * commercial product listings for Egypt.
 */

import crypto from 'crypto';
import env from '../../../../config/env.config.js';
import { logger } from '../../../../config/logger.config.js';
import { ShoppingProviderInterface } from './shopping-provider.interface.js';
import { parsePrice } from './serper-shopping.provider.js';

const SERPAPI_URL = 'https://serpapi.com/search.json';

export class SerpApiShoppingProvider extends ShoppingProviderInterface {
  constructor(apiKey = env.SERPAPI_API_KEY) {
    super();
    this.apiKey = apiKey;
  }

  /**
   * Searches Google Shopping via SerpApi.
   *
   * @param {Object} options
   * @param {string} options.query - Fashion search query
   * @param {string} [options.gl='eg'] - Region code (default Egypt)
   * @param {string} [options.hl='ar'] - Language (default Arabic)
   * @param {number} [options.minPrice]
   * @param {number} [options.maxPrice]
   * @param {number} [options.limit=10]
   * @param {number} [options.timeoutMs=10000]
   * @returns {Promise<Array<Object>>}
   */
  async searchProducts({
    query = '',
    gl = 'eg',
    hl = 'ar',
    minPrice,
    maxPrice,
    limit = 10,
    timeoutMs = 10000,
  } = {}) {
    const trimmed = String(query || '').trim();
    if (!trimmed) return [];

    const apiKey = this.apiKey || env.SERPAPI_API_KEY;
    if (!apiKey) {
      logger.warn('[SerpApiShoppingProvider] SERPAPI_API_KEY is not configured.');
      return [];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = new URL(SERPAPI_URL);
      url.searchParams.set('engine', 'google_shopping');
      url.searchParams.set('q', trimmed);
      url.searchParams.set('gl', gl || 'eg');
      url.searchParams.set('hl', hl || 'ar');
      url.searchParams.set('num', String(Math.min(Math.max(limit, 1), 20)));
      url.searchParams.set('api_key', apiKey);

      const response = await fetch(url.toString(), {
        method: 'GET',
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        logger.error(`[SerpApiShoppingProvider] HTTP ${response.status} from SerpApi:`, errorText);
        return [];
      }

      const data = await response.json();
      const results = Array.isArray(data?.shopping_results) ? data.shopping_results : [];

      let candidates = results
        .filter((item) => (item?.link || item?.product_link) && item?.title)
        .map((item, idx) => {
          const directLink = item.link || item.product_link;
          const price = typeof item.extracted_price === 'number'
            ? item.extracted_price
            : parsePrice(item.price);
          const rawId = item.product_id || directLink || String(idx);
          const hashId = crypto.createHash('md5').update(rawId).digest('hex').slice(0, 10);

          return {
            id: `serpapi_${hashId}`,
            title: String(item.title).trim(),
            price,
            currency: 'EGP',
            retailer: item.source ? String(item.source).trim() : 'Online Store',
            productUrl: directLink,
            imageUrl: item.thumbnail || null,
            rating: typeof item.rating === 'number' ? item.rating : null,
            reviewsCount: typeof item.reviews === 'number' ? item.reviews : null,
            inStock: true,
            source: 'serpapi',
          };
        });

      if (typeof minPrice === 'number') {
        candidates = candidates.filter((c) => c.price == null || c.price >= minPrice);
      }
      if (typeof maxPrice === 'number') {
        candidates = candidates.filter((c) => c.price == null || c.price <= maxPrice);
      }

      return candidates.slice(0, limit);
    } catch (err) {
      if (err.name === 'AbortError') {
        logger.warn(`[SerpApiShoppingProvider] Request timed out after ${timeoutMs}ms for query "${trimmed}"`);
      } else {
        logger.error('[SerpApiShoppingProvider] Execution error:', err.message);
      }
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const serpapiShoppingProvider = new SerpApiShoppingProvider();
export default serpapiShoppingProvider;
