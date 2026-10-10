/**
 * Mock Shopping Provider
 *
 * Provides offline, deterministic commercial fashion products for Egypt.
 * Used during unit testing, CI/CD, and local development to eliminate API costs.
 */

import { ShoppingProviderInterface } from './shopping-provider.interface.js';

const DEFAULT_MOCK_CATALOG = [
  // Tops
  {
    id: 'mock_top_01',
    title: 'قميص رسمي كلاسيكي بقصة مريحة - أبيض ناصع',
    titleEn: 'Classic Regular Fit Formal Shirt - Crisp White',
    slot: 'top',
    itemType: 'قميص رسمي',
    color: 'أبيض',
    colorEn: 'white',
    price: 1450,
    currency: 'EGP',
    retailer: 'DeFacto Egypt',
    productUrl: 'https://www.defacto.com/ar-eg/p/mens-classic-poplin-shirt-white-101',
    imageUrl: 'https://images.defacto.com/products/poplin-white-formal-shirt-front.jpg',
    rating: 4.6,
    reviewsCount: 38,
    inStock: true,
    source: 'mock',
  },
  {
    id: 'mock_top_02',
    title: 'قميص أكسفورد سليم فيت كلاسيكي - أبيض ناصع',
    titleEn: 'Classic Slim Fit Oxford Shirt - Pure White',
    slot: 'top',
    itemType: 'قميص أكسفورد',
    color: 'أبيض',
    colorEn: 'white',
    price: 2290,
    currency: 'EGP',
    retailer: 'Massimo Dutti Egypt',
    productUrl: 'https://www.massimodutti.com/eg/men/shirts/slim-fit-oxford-shirt-white-202',
    imageUrl: 'https://static.massimodutti.net/assets/shirts/oxford-white-cotton-slim.jpg',
    rating: 4.8,
    reviewsCount: 52,
    inStock: true,
    source: 'mock',
  },
  {
    id: 'mock_top_03',
    title: 'قميص بولو من القطن الممشط الفاخر - أزرق داكن',
    titleEn: 'Pima Cotton Long Sleeve Polo Shirt - Navy',
    slot: 'top',
    itemType: 'قميص بولو',
    color: 'كحلي',
    colorEn: 'navy',
    price: 1850,
    currency: 'EGP',
    retailer: 'Concrete Egypt',
    productUrl: 'https://www.concrete.com.eg/p/mens-pima-polo-shirt-navy-303',
    imageUrl: 'https://www.concrete.com.eg/cdn/images/pima-cotton-polo-navy.jpg',
    rating: 4.7,
    reviewsCount: 29,
    inStock: true,
    source: 'mock',
  },
  // Bottoms
  {
    id: 'mock_bottom_01',
    title: 'بنطال تشينو كلاسيكي سليم فيت - كحلي داكن',
    titleEn: 'Classic Slim Fit Chino Trousers - Dark Navy',
    slot: 'bottom',
    itemType: 'بنطال تشينو',
    color: 'كحلي',
    colorEn: 'navy',
    price: 1299,
    currency: 'EGP',
    retailer: 'DeFacto Egypt',
    productUrl: 'https://www.defacto.com/ar-eg/p/mens-slim-fit-chino-pants-navy-401',
    imageUrl: 'https://images.defacto.com/products/chino-pants-dark-navy-front.jpg',
    rating: 4.5,
    reviewsCount: 64,
    inStock: true,
    source: 'mock',
  },
  {
    id: 'mock_bottom_02',
    title: 'بنطال قماشي رسمي فاخر - رمادي فحمي داكن',
    titleEn: 'Tailored Wool-Blend Formal Trousers - Charcoal Grey',
    slot: 'bottom',
    itemType: 'بنطال رسمي',
    color: 'رمادي',
    colorEn: 'charcoal',
    price: 2490,
    currency: 'EGP',
    retailer: 'Massimo Dutti Egypt',
    productUrl: 'https://www.massimodutti.com/eg/men/trousers/wool-tailored-trousers-charcoal-502',
    imageUrl: 'https://static.massimodutti.net/assets/trousers/tailored-trousers-charcoal.jpg',
    rating: 4.9,
    reviewsCount: 41,
    inStock: true,
    source: 'mock',
  },
  {
    id: 'mock_bottom_03',
    title: 'بنطال تشينو بقصة مريحة - بيج رملي دافئ',
    titleEn: 'Relaxed Fit Stretch Chino Trousers - Sand Beige',
    slot: 'bottom',
    itemType: 'بنطال تشينو',
    color: 'بيج',
    colorEn: 'beige',
    price: 1150,
    currency: 'EGP',
    retailer: 'Town Team',
    productUrl: 'https://www.townteam.com/p/mens-stretch-chino-beige-603',
    imageUrl: 'https://www.townteam.com/images/chino-beige-stretch.jpg',
    rating: 4.4,
    reviewsCount: 22,
    inStock: true,
    source: 'mock',
  },
  // Shoes
  {
    id: 'mock_shoes_01',
    title: 'حذاء لوفر جلدي فاخر بشراشيب - بني شوكولاتة داكن',
    titleEn: 'Handcrafted Leather Tassel Loafer - Dark Brown',
    slot: 'shoes',
    itemType: 'حذاء لوفر',
    color: 'بني',
    colorEn: 'brown',
    price: 3450,
    currency: 'EGP',
    retailer: 'Massimo Dutti Egypt',
    productUrl: 'https://www.massimodutti.com/eg/men/shoes/leather-penny-loafer-brown-701',
    imageUrl: 'https://static.massimodutti.net/assets/shoes/penny-loafer-dark-brown.jpg',
    rating: 4.9,
    reviewsCount: 47,
    inStock: true,
    source: 'mock',
  },
  {
    id: 'mock_shoes_02',
    title: 'حذاء أكسفورد جلدي رسمي كلاسيكي - بني داكن',
    titleEn: 'Classic Leather Oxford Dress Shoes - Deep Brown',
    slot: 'shoes',
    itemType: 'حذاء أكسفورد',
    color: 'بني',
    colorEn: 'brown',
    price: 2800,
    currency: 'EGP',
    retailer: 'Lusso Shoes Egypt',
    productUrl: 'https://www.lussoshoes-eg.com/products/classic-leather-oxford-dress-shoes-802',
    imageUrl: 'https://www.lussoshoes-eg.com/cdn/products/oxford-leather-dress-shoes-brown.jpg',
    rating: 4.7,
    reviewsCount: 35,
    inStock: true,
    source: 'mock',
  },
  {
    id: 'mock_shoes_03',
    title: 'حذاء سنيكرز جلدي ناعم ومريح - أبيض ثلجي',
    titleEn: 'Minimalist Clean Leather Sneakers - Pure White',
    slot: 'shoes',
    itemType: 'حذاء سنيكرز',
    color: 'أبيض',
    colorEn: 'white',
    price: 1950,
    currency: 'EGP',
    retailer: 'Zara Egypt',
    productUrl: 'https://www.zara.com/eg/en/mens-leather-minimal-sneakers-white-903',
    imageUrl: 'https://static.zara.net/photos/sneakers-white-leather-minimal.jpg',
    rating: 4.6,
    reviewsCount: 88,
    inStock: true,
    source: 'mock',
  },
  // Outerwear
  {
    id: 'mock_outerwear_01',
    title: 'بليزر صوف بقصة رسمية ضيقة - كحلي ملكي',
    titleEn: 'Tailored Fit Wool Blazer - Royal Navy',
    slot: 'outerwear',
    itemType: 'بليزر رسمي',
    color: 'كحلي',
    colorEn: 'navy',
    price: 4950,
    currency: 'EGP',
    retailer: 'Massimo Dutti Egypt',
    productUrl: 'https://www.massimodutti.com/eg/men/blazers/wool-suit-blazer-navy-1001',
    imageUrl: 'https://static.massimodutti.net/assets/blazers/wool-suit-blazer-navy.jpg',
    rating: 4.9,
    reviewsCount: 31,
    inStock: true,
    source: 'mock',
  },
];

export class MockShoppingProvider extends ShoppingProviderInterface {
  constructor() {
    super();
    this.customResults = null;
    this.callCount = 0;
  }

  /**
   * Sets custom mock results for testing.
   * @param {Array<Object>|null} results
   */
  setMockResults(results) {
    this.customResults = results;
  }

  /**
   * Clears custom mock results.
   */
  resetMockResults() {
    this.customResults = null;
    this.callCount = 0;
  }

  /**
   * Searches for mock commercial fashion products.
   */
  async searchProducts({
    query = '',
    gl = 'eg', // eslint-disable-line no-unused-vars
    hl = 'ar',
    minPrice,
    maxPrice,
    limit = 10,
  } = {}) {
    this.callCount += 1;

    if (this.customResults) {
      return this.customResults.slice(0, limit);
    }

    const normQuery = String(query || '').toLowerCase().trim();
    const queryTokens = normQuery.split(/\s+/).filter(Boolean);

    let candidates = DEFAULT_MOCK_CATALOG;

    if (queryTokens.length > 0) {
      // Score and rank candidates based on matching tokens
      const scored = DEFAULT_MOCK_CATALOG.map((item) => {
        const itemText = [
          item.title,
          item.titleEn,
          item.slot,
          item.itemType,
          item.color,
          item.colorEn,
          item.retailer,
        ]
          .join(' ')
          .toLowerCase();

        const matchCount = queryTokens.reduce((acc, token) => {
          return itemText.includes(token) ? acc + 1 : acc;
        }, 0);

        return { item, score: matchCount };
      });

      const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);

      candidates = matched.length > 0 ? matched.map((s) => s.item) : DEFAULT_MOCK_CATALOG;
    }

    // Filter by min/max price if specified
    if (typeof minPrice === 'number') {
      candidates = candidates.filter((item) => item.price >= minPrice);
    }
    if (typeof maxPrice === 'number') {
      candidates = candidates.filter((item) => item.price <= maxPrice);
    }

    // Return localized formatted results
    return candidates.slice(0, limit).map((c) => ({
      id: c.id,
      title: hl === 'en' && c.titleEn ? c.titleEn : c.title,
      price: c.price,
      currency: c.currency,
      retailer: c.retailer,
      productUrl: c.productUrl,
      imageUrl: c.imageUrl,
      rating: c.rating,
      reviewsCount: c.reviewsCount,
      inStock: c.inStock,
      slot: c.slot,
      source: 'mock',
    }));
  }
}

export const mockShoppingProvider = new MockShoppingProvider();
export default mockShoppingProvider;
