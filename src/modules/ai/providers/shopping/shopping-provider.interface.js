/**
 * Abstract Shopping Provider Interface
 *
 * Defines the contract for fetching structured commercial product candidates
 * with real, store-verified links, thumbnail images, prices, and merchant details.
 */
export class ShoppingProviderInterface {
  /**
   * Searches for live commercial fashion products in target locale/region.
   *
   * @param {Object} options
   * @param {string} options.query - Product search keywords (e.g. "قميص رسمي أبيض سليم فيت رجالي")
   * @param {string} [options.gl='eg'] - Two-letter country code (e.g. 'eg' for Egypt)
   * @param {string} [options.hl='ar'] - Language code (e.g. 'ar' or 'en')
   * @param {number} [options.minPrice] - Minimum price in local currency
   * @param {number} [options.maxPrice] - Maximum price in local currency
   * @param {number} [options.limit=10] - Maximum candidates to return
   * @returns {Promise<Array<{
   *   id: string,
   *   title: string,
   *   price: number|null,
   *   currency: string,
   *   retailer: string,
   *   productUrl: string,
   *   imageUrl: string|null,
   *   rating?: number|null,
   *   reviewsCount?: number|null,
   *   inStock?: boolean,
   *   source: string
   * }>>}
   */
  async searchProducts({ query, gl = 'eg', hl = 'ar', minPrice, maxPrice, limit = 10 }) { // eslint-disable-line no-unused-vars
    throw new Error('searchProducts() must be implemented by shopping provider subclass');
  }
}

export default ShoppingProviderInterface;
