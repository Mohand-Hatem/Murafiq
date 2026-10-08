/**
 * Unit Tests — Phase 15E 3-Tier Decoupled Shopping Search Pipeline
 *
 * Verifies:
 * 1. Tier 1 (Gemini Planner): Generates structured queries without touching URLs.
 * 2. Tier 2 (Shopping Provider): Fetches commercial product candidates with store links and thumbnails.
 * 3. Tier 3 (Backend HTTP Validation): Drops 404s and invalid images.
 * 4. Tier 4 (Gemini Ranker): Selects items by ID and writes styling commentary without touching URLs.
 * 5. Tier 5 (Assembly): Response contains verified URLs and images, mapped deterministically by code.
 * 6. Fallback resilience: Degrades gracefully if Planner or Ranker throws.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import '../../src/common/globals.js';
import {
  searchWithShoppingProvider,
  searchExternalProducts,
  SEARCH_PLANNER_SCHEMA,
  SEARCH_RANKER_SCHEMA,
  setProductSearchRedisOverride,
  clearInMemoryProductCache,
  isDuplicateAnchorCandidate,
  computeCacheKey,
} from '../../src/modules/ai/products/product-search.service.js';
import { MockShoppingProvider } from '../../src/modules/ai/providers/shopping/mock-shopping.provider.js';
import { setGenAiClient } from '../../src/modules/ai/providers/llm.provider.js';

describe('Phase 15E — 3-Tier Decoupled Shopping Search Pipeline', () => {
  let mockShoppingProvider;
  let mockRedis;
  let mockGenerateContent;

  beforeEach(() => {
    clearInMemoryProductCache();

    mockRedis = {
      store: new Map(),
      get: jest.fn(async (key) => mockRedis.store.get(key) || null),
      set: jest.fn(async (key, val) => {
        mockRedis.store.set(key, val);
        return 'OK';
      }),
    };
    setProductSearchRedisOverride(mockRedis, () => true);

    mockShoppingProvider = new MockShoppingProvider();

    mockGenerateContent = jest.fn();
    setGenAiClient({
      models: {
        generateContent: mockGenerateContent,
      },
    });
  });

  afterEach(() => {
    setProductSearchRedisOverride(null, null);
    clearInMemoryProductCache();
    setGenAiClient(null);
    jest.restoreAllMocks();
  });

  it('Tier 1 + 2 + 3 + 4 + 5: Successfully executes 3-tier pipeline without LLM touching URLs', async () => {
    // 1. Planner LLM response (generates queries only, NO URLs)
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        queries: [
          {
            slot: 'bottom',
            itemType: 'بنطال تشينو',
            searchQuery: 'بنطال تشينو كحلي رجالي',
            targetColor: 'كحلي',
            outfitIndex: 1,
            outfitTitle: 'الإطلالة الأولى (رسمية ذكية)',
          },
          {
            slot: 'shoes',
            itemType: 'حذاء لوفر',
            searchQuery: 'حذاء لوفر بني جلد رجالي',
            targetColor: 'بني',
            outfitIndex: 1,
            outfitTitle: 'الإطلالة الأولى (رسمية ذكية)',
          },
        ],
        stylingIntent: 'Smart formal look complementing cream quarter-zip pullover',
      }),
      usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 80 },
    });

    // 2. Setup mock shopping candidates with real links and thumbnails
    const candidateTrousers = {
      id: 'store_item_101',
      title: 'بنطال تشينو سليم فيت كحلي',
      slot: 'bottom',
      price: 1299,
      currency: 'EGP',
      retailer: 'DeFacto Egypt',
      productUrl: 'https://www.defacto.com/ar-eg/p/mens-slim-chino-navy-101',
      imageUrl: 'https://images.defacto.com/products/chino-navy-front.jpg',
      rating: 4.6,
      reviewsCount: 30,
      inStock: true,
      source: 'mock',
    };

    const candidateShoes = {
      id: 'store_item_202',
      title: 'حذاء لوفر جلدي فاخر بني',
      slot: 'shoes',
      price: 3450,
      currency: 'EGP',
      retailer: 'Massimo Dutti Egypt',
      productUrl: 'https://www.massimodutti.com/eg/men/shoes/penny-loafer-brown-202',
      imageUrl: 'https://static.massimodutti.net/assets/shoes/loafer-brown.jpg',
      rating: 4.9,
      reviewsCount: 15,
      inStock: true,
      source: 'mock',
    };

    mockShoppingProvider.setMockResults([candidateTrousers, candidateShoes]);

    // 3. Ranker LLM response (selects candidate IDs and generates styling text, NO URLs)
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        selectedItems: [
          {
            candidateId: 'store_item_101',
            slot: 'bottom',
            itemType: 'بنطال تشينو',
            customTitle: 'بنطال تشينو سليم فيت - كحلي داكن',
            description: 'بنطال تشينو باللون الكحلي يمنح توازناً مثالياً وأنيقاً مع سترة الكريمة.',
            outfitIndex: 1,
            outfitTitle: 'الإطلالة الأولى (رسمية ذكية)',
          },
          {
            candidateId: 'store_item_202',
            slot: 'shoes',
            itemType: 'حذاء لوفر',
            customTitle: 'حذاء لوفر جلدي - بني داكن',
            description: 'حذاء لوفر من الجلد الطبيعي يكمل الطابع الكلاسيكي للسترة.',
            outfitIndex: 1,
            outfitTitle: 'الإطلالة الأولى (رسمية ذكية)',
          },
        ],
        generalRationale: 'إطلالة متكاملة وراقية تناسب الأجواء الخريفية والعمل.',
      }),
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 100 },
    });

    const results = await searchWithShoppingProvider({
      gapDescription: 'عايز اشترى حاجه تليق مع البلوفر ده',
      occasion: 'smart_casual',
      formality: 'smart_casual',
      locale: 'ar',
      shoppingProviderOverride: mockShoppingProvider,
    });

    expect(results).toHaveLength(2);

    // Verify Tier 1 (Planner): Schema was used and did not ask for URLs
    expect(mockGenerateContent.mock.calls[0][0].config.responseSchema).toEqual(SEARCH_PLANNER_SCHEMA);

    // Verify Tier 4 (Ranker): Schema was used and candidate pool was passed with IDs
    expect(mockGenerateContent.mock.calls[1][0].config.responseSchema).toEqual(SEARCH_RANKER_SCHEMA);
    expect(mockGenerateContent.mock.calls[1][0].contents[0].parts[0].text).toContain('store_item_101');
    expect(mockGenerateContent.mock.calls[1][0].contents[0].parts[0].text).toContain('store_item_202');

    // Verify Tier 5: URLs and images were preserved from the store candidate and NOT corrupted by LLM
    expect(results[0].slot).toBe('bottom');
    expect(results[0].title).toBe('بنطال تشينو سليم فيت - كحلي داكن');
    expect(results[0].sourceUrl).toBe('https://www.defacto.com/ar-eg/p/mens-slim-chino-navy-101');
    expect(results[0].imageUrl).toBe('https://images.defacto.com/products/chino-navy-front.jpg');
    expect(results[0].estimatedPriceEgp).toBe(1299);
    expect(results[0].retailer).toBe('DeFacto Egypt');
    expect(results[0].isGrounded).toBe(true);

    expect(results[1].slot).toBe('shoes');
    expect(results[1].sourceUrl).toBe('https://www.massimodutti.com/eg/men/shoes/penny-loafer-brown-202');
    expect(results[1].imageUrl).toBe('https://static.massimodutti.net/assets/shoes/loafer-brown.jpg');
    expect(results[1].estimatedPriceEgp).toBe(3450);
  });

  it('Tier 3: Drops candidate when URL is dead/invalid or category conflicts', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        queries: [
          { slot: 'top', itemType: 'قميص', searchQuery: 'قميص أبيض' },
        ],
      }),
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
    });

    // Provide one valid candidate and one invalid candidate (homepage - rejected by verifyDirectProductUrl)
    const invalidCandidate = {
      id: 'bad_item',
      title: 'صفحة رئيسية متجر',
      productUrl: 'https://www.zara.com/eg/',
      imageUrl: 'https://images.zara.com/home.jpg',
      retailer: 'Zara Egypt',
    };

    const validCandidate = {
      id: 'good_item',
      title: 'قميص أبيض كلاسيكي',
      price: 1450,
      productUrl: 'https://www.defacto.com/ar-eg/p/white-shirt-999',
      imageUrl: 'https://images.defacto.com/products/white-shirt.jpg',
      retailer: 'DeFacto Egypt',
    };

    mockShoppingProvider.setMockResults([invalidCandidate, validCandidate]);

    // Ranker selects the good candidate
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        selectedItems: [
          {
            candidateId: 'good_item',
            description: 'قميص أبيض أنيق',
          },
        ],
      }),
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
    });

    const results = await searchWithShoppingProvider({
      gapDescription: 'قميص رسمي',
      locale: 'ar',
      shoppingProviderOverride: mockShoppingProvider,
    });

    // Only valid item survived
    expect(results).toHaveLength(1);
    expect(results[0].sourceUrl).toBe('https://www.defacto.com/ar-eg/p/white-shirt-999');
  });

  it('Fallback resilience: Uses fallback query planning when Planner LLM throws', async () => {
    // Planner throws
    mockGenerateContent.mockRejectedValueOnce(new Error('LLM Timeout on Planner'));

    const candidate = {
      id: 'fallback_cand',
      title: 'بنطال تشينو كحلي',
      slot: 'bottom',
      price: 1299,
      retailer: 'DeFacto Egypt',
      productUrl: 'https://www.defacto.com/ar-eg/p/navy-chino-101',
      imageUrl: 'https://images.defacto.com/products/chino.jpg',
    };
    mockShoppingProvider.setMockResults([candidate]);

    // Ranker also throws -> fallback direct mapping
    mockGenerateContent.mockRejectedValueOnce(new Error('LLM Timeout on Ranker'));

    const results = await searchWithShoppingProvider({
      gapDescription: 'بنطال كحلي',
      locale: 'ar',
      shoppingProviderOverride: mockShoppingProvider,
    });

    expect(results).toHaveLength(1);
    expect(results[0].sourceUrl).toBe('https://www.defacto.com/ar-eg/p/navy-chino-101');
    expect(results[0].retailer).toBe('DeFacto Egypt');
  });

  it('searchExternalProducts routes to 3-tier pipeline when useShoppingProvider is true and caches results in Redis', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        queries: [
          { slot: 'top', itemType: 'قميص', searchQuery: 'قميص أبيض' },
        ],
      }),
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
    });

    mockShoppingProvider.setMockResults([
      {
        id: 'route_item_1',
        slot: 'top',
        title: 'قميص أكسفورد أبيض',
        price: 1750,
        retailer: 'Massimo Dutti Egypt',
        productUrl: 'https://www.massimodutti.com/eg/white-shirt-555',
        imageUrl: 'https://static.massimodutti.net/assets/white-shirt.jpg',
      },
    ]);

    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        selectedItems: [
          {
            candidateId: 'route_item_1',
            description: 'قميص أبيض راقٍ',
          },
        ],
      }),
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
    });

    const results = await searchExternalProducts({
      gapDescription: 'قميص أبيض للبدلة',
      useShoppingProvider: true,
      shoppingProviderOverride: mockShoppingProvider,
      locale: 'ar',
    });

    expect(results).toHaveLength(1);
    expect(results[0].sourceUrl).toBe('https://www.massimodutti.com/eg/white-shirt-555');
    expect(results[0].imageUrl).toBe('https://static.massimodutti.net/assets/white-shirt.jpg');
    expect(results[0].estimatedPriceEgp).toBe(1750);

    // Redis cache was populated
    expect(mockRedis.set).toHaveBeenCalledTimes(1);
  });

  describe('Anchor Garment Awareness & Zero-Duplicate Rule', () => {
    it('isDuplicateAnchorCandidate detects duplicate sweaters/pullovers and allows complementary garments', () => {
      const anchorSweater = {
        category: 'outerwear',
        subcategory: 'quarter_zip_sweater',
        colorFamily: 'beige',
      };

      // Duplicate candidates that should be rejected
      expect(
        isDuplicateAnchorCandidate(
          { slot: 'top', title: 'سويتر رجالي بسحاب ربع كاجوال' },
          anchorSweater
        )
      ).toBe(true);

      expect(
        isDuplicateAnchorCandidate(
          { slot: 'top', title: 'بلوفر تريكو كلاسيك برقبة عالية' },
          anchorSweater
        )
      ).toBe(true);

      expect(
        isDuplicateAnchorCandidate(
          { slot: 'outerwear', title: 'Mens Quarter Zip Sweater', plannedItemType: 'sweater' },
          anchorSweater
        )
      ).toBe(true);

      // Complementary candidates that MUST be accepted
      expect(
        isDuplicateAnchorCandidate(
          { slot: 'top', title: 'قميص أكسفورد أبيض كلاسيكي قطن', plannedItemType: 'قميص' },
          anchorSweater
        )
      ).toBe(false);

      expect(
        isDuplicateAnchorCandidate(
          { slot: 'bottom', title: 'بنطال تشينو كحلي بقصة كلاسيكية', plannedItemType: 'بنطال' },
          anchorSweater
        )
      ).toBe(false);

      expect(
        isDuplicateAnchorCandidate(
          { slot: 'shoes', title: 'حذاء لوفر جلد طبيعي بني', plannedItemType: 'حذاء' },
          anchorSweater
        )
      ).toBe(false);
    });

    it('searchWithShoppingProvider drops duplicate anchor garments and selects complementary items', async () => {
      const anchorSweater = {
        category: 'outerwear',
        subcategory: 'quarter_zip_sweater',
        colorFamily: 'beige',
      };

      // Mock planner returns queries for under-layer shirt, chinos, and shoes
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          queries: [
            { slot: 'top', itemType: 'قميص', searchQuery: 'قميص أكسفورد أبيض رجالي', outfitIndex: 1, outfitTitle: 'إطلالة كلاسيكية' },
            { slot: 'bottom', itemType: 'بنطال', searchQuery: 'بنطال تشينو كحلي رجالي', outfitIndex: 1, outfitTitle: 'إطلالة كلاسيكية' },
            { slot: 'shoes', itemType: 'حذاء', searchQuery: 'حذاء لوفر بني رجالي', outfitIndex: 1, outfitTitle: 'إطلالة كلاسيكية' },
          ],
        }),
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 60 },
      });

      const dupSweater = {
        id: 'dup_sweater',
        slot: 'top',
        title: 'سويتر بسحاب ربع كاكي صوف رجالي',
        price: 1200,
        retailer: 'Amazon.eg',
        productUrl: 'https://www.amazon.eg/dp/B08XYZ1234',
        imageUrl: 'https://images.amazon.com/khaki-quarter-zip.jpg',
        source: 'mock',
      };
      const shirt1 = {
        id: 'shirt_1',
        slot: 'top',
        title: 'قميص أكسفورد أبيض كلاسيك سليم فت',
        price: 850,
        retailer: 'Tie House Egypt',
        productUrl: 'https://www.tiehouse.com.eg/p/white-oxford-shirt-102',
        imageUrl: 'https://cdn.tiehouse.com/white-oxford-shirt.jpg',
        source: 'mock',
      };
      const chino1 = {
        id: 'chino_1',
        slot: 'bottom',
        title: 'بنطال تشينو كحلي قماش قطن',
        price: 1100,
        retailer: 'DeFacto Egypt',
        productUrl: 'https://www.defacto.com.eg/p/navy-chino-pants-103',
        imageUrl: 'https://dfcdn.defacto.com.tr/navy-chino.jpg',
        source: 'mock',
      };
      const loafer1 = {
        id: 'loafer_1',
        slot: 'shoes',
        title: 'حذاء لوفر جلد طبيعي بني دابل مونك',
        price: 1600,
        retailer: 'Zara Egypt',
        productUrl: 'https://www.zara.com/eg/p/brown-leather-loafer-shoes-104',
        imageUrl: 'https://static.zara.net/brown-loafer.jpg',
        source: 'mock',
      };

      jest.spyOn(mockShoppingProvider, 'searchProducts').mockImplementation(async ({ query }) => {
        if (query.includes('قميص')) return [dupSweater, shirt1];
        if (query.includes('بنطال')) return [chino1];
        if (query.includes('حذاء')) return [loafer1];
        return [];
      });

      // Ranker selects the 3 complementary items
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          selectedItems: [
            { candidateId: 'shirt_1', description: 'قميص أبيض لارتدائه تحت السترة' },
            { candidateId: 'chino_1', description: 'بنطال كحلي يتناسق مع لون السترة البيج' },
            { candidateId: 'loafer_1', description: 'حذاء لوفر بني لإتمام المظهر الأنيق' },
          ],
        }),
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 80 },
      });

      const suggestions = await searchWithShoppingProvider({
        gapDescription: 'تنسيق ملابس مع بلوفر بيج',
        occasion: 'smart casual',
        locale: 'ar',
        isShoppingRequest: true,
        shoppingProviderOverride: mockShoppingProvider,
        anchorGarment: anchorSweater,
      });

      expect(suggestions).toHaveLength(3);
      // Ensure ZERO duplicate sweaters are returned
      const returnedTitles = suggestions.map((s) => s.title);
      expect(returnedTitles).not.toContain('سويتر بسحاب ربع كاكي صوف رجالي');
      expect(returnedTitles).toContain('قميص أكسفورد أبيض كلاسيك سليم فت');
      expect(returnedTitles).toContain('بنطال تشينو كحلي قماش قطن');
      expect(returnedTitles).toContain('حذاء لوفر جلد طبيعي بني دابل مونك');
    });

    it('computeCacheKey isolates queries with different anchor garments', () => {
      const keyWithoutAnchor = computeCacheKey('outfit', { locale: 'ar' });
      const keyWithSweater = computeCacheKey('outfit', {
        locale: 'ar',
        anchorGarment: { category: 'outerwear', subcategory: 'quarter_zip_sweater', colorFamily: 'beige' },
      });
      const keyWithPants = computeCacheKey('outfit', {
        locale: 'ar',
        anchorGarment: { category: 'bottom', subcategory: 'jeans', colorFamily: 'blue' },
      });

      expect(keyWithoutAnchor).not.toBe(keyWithSweater);
      expect(keyWithSweater).not.toBe(keyWithPants);
    });
  });
});
