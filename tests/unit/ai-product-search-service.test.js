/**
 * Phase 15E Step 3 — Product Search Service Tests (product-search.service.js).
 *
 * Covers:
 * 1. computeCacheKey normalization and hashing.
 * 2. searchExternalProducts returns empty array on blank gap query.
 * 3. Grounded search execution: calls generateContent with googleSearch tool.
 * 4. Extracts up to 2 distinct suggestions with attached citations and source URLs.
 * 5. 24-hour Redis caching: repeated query serves from cache with cacheHit: true (zero LLM calls).
 * 6. In-memory cache fallback when Redis is disconnected.
 * 7. Fail-open resilience: returns empty array if LLM provider throws.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import '../../src/common/globals.js';
import {
  computeCacheKey,
  searchExternalProducts,
  verifyDirectProductUrl,
  verifyProductImageUrl,
  extractProductSku,
  mapSuggestionsToGrounding,
  getKnownRetailerInfo,
  buildRetailerSearchUrl,
  buildRetailerLogoUrl,
  cleanRetailerTitle,
  verifyPageProductMatch,
  setProductSearchRedisOverride,
  clearInMemoryProductCache,
  CACHE_TTL_SECONDS,
  PRODUCT_VERIFICATION_STATUS,
} from '../../src/modules/ai/products/product-search.service.js';
import {
  setHttpFetchOverride,
  resetHttpFetchOverride,
} from '../../src/modules/ai/products/product-page-verifier.js';
import { setGenAiClient } from '../../src/modules/ai/providers/llm.provider.js';

describe('Phase 15E Step 3 — product-search.service.js', () => {
  let mockRedis;
  let mockGenerateContent;

  beforeEach(() => {
    clearInMemoryProductCache();

    mockRedis = {
      store: new Map(),
      get: jest.fn(async (key) => mockRedis.store.get(key) || null),
      set: jest.fn(async (key, val, _ex, _ttl) => {
        mockRedis.store.set(key, val);
        return 'OK';
      }),
    };

    setProductSearchRedisOverride(mockRedis, () => true);

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
    resetHttpFetchOverride();
    setGenAiClient(null);
    jest.restoreAllMocks();
  });

  describe('computeCacheKey', () => {
    it('normalizes season, genderPresentation, locale, and hashes gapDescription', () => {
      const key1 = computeCacheKey('Navy Formal Trousers  ', { season: 'FALL', genderPresentation: 'MEN', locale: 'en' });
      const key2 = computeCacheKey('navy formal trousers', { season: 'fall', genderPresentation: 'men', locale: 'EN' });
      const keyAr = computeCacheKey('navy formal trousers', { season: 'fall', genderPresentation: 'men', locale: 'ar' });

      expect(key1).toBe(key2);
      expect(key1).toMatch(/^ai:product-search:fall:men:en:[a-f0-9]{16}$/);
      expect(keyAr).toMatch(/^ai:product-search:fall:men:ar:[a-f0-9]{16}$/);
      expect(key1).not.toBe(keyAr);
    });

    it('defaults to all:unisex:en when options are omitted', () => {
      const key = computeCacheKey('black oxford shoes');
      expect(key).toMatch(/^ai:product-search:all:unisex:en:[a-f0-9]{16}$/);
    });

    it('produces distinct cache keys for different budgets', () => {
      const key1500 = computeCacheKey('beige sweater', { budget: 1500 });
      const key6000 = computeCacheKey('beige sweater', { budget: 6000 });
      expect(key1500).not.toBe(key6000);
    });

    it('produces distinct cache keys for different formalities and occasions', () => {
      const keyCasual = computeCacheKey('navy trousers', { formality: 'casual', occasion: 'brunch' });
      const keyFormal = computeCacheKey('navy trousers', { formality: 'formal', occasion: 'gala' });
      expect(keyCasual).not.toBe(keyFormal);
    });

    it('produces distinct cache keys for shopping requests and anchors', () => {
      const normalKey = computeCacheKey('oxford shoes', { isShoppingRequest: false });
      const shoppingKey = computeCacheKey('oxford shoes', { isShoppingRequest: true });
      const anchoredKey = computeCacheKey('oxford shoes', {
        anchor: { _id: 'item_1', colorFamily: 'navy', subcategory: 'blazer' },
      });

      expect(normalKey).not.toBe(shoppingKey);
      expect(normalKey).not.toBe(anchoredKey);
    });

    it('produces distinct cache keys for different gapItems', () => {
      const keyNoGaps = computeCacheKey('outfit', { gapItems: [] });
      const keyGaps = computeCacheKey('outfit', {
        gapItems: [{ slot: 'shoes', description: 'black dress shoes' }],
      });
      expect(keyNoGaps).not.toBe(keyGaps);
    });

    it('produces distinct cache keys for different explicit constraints', () => {
      const keyUnconstrained = computeCacheKey('suit', { constraints: [] });
      const keyModest = computeCacheKey('suit', { constraints: ['modest fit', 'no polyester'] });
      expect(keyUnconstrained).not.toBe(keyModest);
    });
  });

  describe('searchExternalProducts Execution & Grounding', () => {
    it('returns empty array when gapDescription is empty or whitespace', async () => {
      const result = await searchExternalProducts({ gapDescription: '   ' });
      expect(result).toEqual([]);
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('executes grounded search and returns 2 distinct suggestions with citations', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: [
            {
              title: 'Tailored Wool-Blend Trousers',
              itemType: 'navy formal trousers',
              slot: 'bottom',
              description: 'Sharp navy trousers with front pleats and side adjusters.',
              estimatedPriceEgp: 1800,
              retailer: 'Zara Egypt',
            },
            {
              title: 'Classic Chino Suit Pants',
              itemType: 'midnight blue dress trousers',
              slot: 'bottom',
              description: 'Slim-cut midnight blue trousers suitable for evening formalwear.',
              estimatedPriceEgp: 1500,
              retailer: 'Massimo Dutti Egypt',
            },
            {
              title: 'Extra Suggestion to be sliced',
              itemType: 'casual trousers',
              slot: 'bottom',
              description: 'Casual pants',
            },
          ],
        }),
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    uri: 'https://zara.com/eg/en/wool-trousers-p1.html',
                    title: 'Zara Egypt Wool Trousers',
                  },
                },
                {
                  web: {
                    uri: 'https://massimodutti.com/eg/suit-pants.html',
                    title: 'Massimo Dutti Suit Pants',
                  },
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 80 },
      });

      const results = await searchExternalProducts({
        gapDescription: 'navy formal trousers',
        occasion: 'wedding',
        formality: 'formal',
        season: 'fall',
        genderPresentation: 'men',
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.config.tools).toEqual([{ googleSearch: {} }]);

      // Two-Suggestion Rule: max 2 suggestions returned
      expect(results).toHaveLength(2);
      expect(results[0].title).toBe('Tailored Wool-Blend Trousers');
      expect(results[0].sourceUrl).toBe('https://zara.com/eg/en/wool-trousers-p1.html');
      expect(results[0].sourceTitle).toBe('Zara Egypt Wool Trousers');
      expect(results[0].isGrounded).toBe(true);
      expect(results[0].cacheHit).toBe(false);

      expect(results[1].title).toBe('Classic Chino Suit Pants');
      expect(results[1].sourceUrl).toBe('https://massimodutti.com/eg/suit-pants.html');
      expect(results[1].citations).toHaveLength(1);
      expect(results[1].citations[0].url).toBe('https://massimodutti.com/eg/suit-pants.html');

      // 24h Redis cache was populated
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^ai:product-search:fall:men:/),
        expect.any(String),
        'EX',
        CACHE_TTL_SECONDS
      );
    });

    it('serves repeated query from 24h Redis cache without calling LLM (cache hit)', async () => {
      const cachedPayload = [
        {
          slot: 'shoes',
          itemType: 'black oxford shoes',
          title: 'Polished Black Leather Oxfords',
          description: 'Classic formal cap-toe oxford dress shoes.',
          estimatedPriceEgp: 2200,
          retailer: 'H&M Egypt',
          sourceUrl: 'https://hm.com/eg/shoes',
          sourceTitle: 'H&M Egypt Formal Footwear',
          citations: [{ title: 'H&M Egypt', url: 'https://hm.com/eg/shoes' }],
          isGrounded: true,
        },
      ];

      mockRedis.store.set(
        computeCacheKey('black oxford shoes', { season: 'fall', genderPresentation: 'men' }),
        JSON.stringify(cachedPayload)
      );

      const results = await searchExternalProducts({
        gapDescription: 'black oxford shoes',
        season: 'fall',
        genderPresentation: 'men',
      });

      expect(mockRedis.get).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].cacheHit).toBe(true);
      expect(results[0].title).toBe('Polished Black Leather Oxfords');
    });

    it('does NOT invoke onCacheMiss on cache hit', async () => {
      const cachedPayload = [
        {
          slot: 'shoes',
          itemType: 'black oxford shoes',
          title: 'Polished Black Leather Oxfords',
          retailer: 'H&M Egypt',
          isGrounded: true,
        },
      ];

      mockRedis.store.set(
        computeCacheKey('black oxford shoes'),
        JSON.stringify(cachedPayload)
      );

      const onCacheMiss = jest.fn();
      const results = await searchExternalProducts({
        gapDescription: 'black oxford shoes',
        onCacheMiss,
      });

      expect(results).toHaveLength(1);
      expect(results[0].cacheHit).toBe(true);
      expect(onCacheMiss).not.toHaveBeenCalled();
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('invokes onCacheMiss on cache miss before LLM call', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({ suggestions: [] }),
        candidates: [{ groundingMetadata: { groundingChunks: [] } }],
      });

      const onCacheMiss = jest.fn().mockResolvedValue(true);
      await searchExternalProducts({
        gapDescription: 'unseen item for cache miss',
        onCacheMiss,
      });

      expect(onCacheMiss).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('aborts without LLM call if onCacheMiss returns false (e.g. quota check race)', async () => {
      const onCacheMiss = jest.fn().mockResolvedValue(false);
      const results = await searchExternalProducts({
        gapDescription: 'another unseen item',
        onCacheMiss,
      });

      expect(onCacheMiss).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).not.toHaveBeenCalled();
      expect(results).toEqual([]);
    });

    it('falls back gracefully to in-memory cache when Redis is disconnected', async () => {
      // Simulate disconnected Redis
      setProductSearchRedisOverride(mockRedis, () => false);

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: [
            {
              title: 'White French Cuff Shirt',
              itemType: 'formal shirt',
              slot: 'top',
              description: 'Crisp white poplin shirt.',
              retailer: 'Zara Egypt',
              sourceUrl: 'https://zara.com/eg/en/french-cuff-shirt-p999.html',
            },
          ],
        }),
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    uri: 'https://zara.com/eg/en/french-cuff-shirt-p999.html',
                    title: 'Zara French Cuff Shirt',
                  },
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      });

      // First call caches in-memory
      const res1 = await searchExternalProducts({ gapDescription: 'white dress shirt' });
      expect(res1).toHaveLength(1);
      expect(res1[0].cacheHit).toBe(false);

      // Second call hits in-memory cache
      const res2 = await searchExternalProducts({ gapDescription: 'white dress shirt' });
      expect(res2).toHaveLength(1);
      expect(res2[0].cacheHit).toBe(true);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('fails closed and returns empty array without fabricating items when live search throws (Section 20 policy)', async () => {
      // Live search throws non-transient error
      mockGenerateContent.mockRejectedValueOnce(new Error('INVALID_ARGUMENT: Google Search tool failure'));

      const results = await searchExternalProducts({
        gapDescription: 'formal black blazer',
        locale: 'ar',
      });

      // Fails closed per Section 20 policy: exactly 1 call, zero fabricated results
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(results).toEqual([]);
    });

    it('fails open and returns empty array if LLM provider throws completely (soft degradation)', async () => {
      // Both grounded and fallback fail
      mockGenerateContent.mockRejectedValue(new Error('Google Gen AI connection timeout'));

      const results = await searchExternalProducts({
        gapDescription: 'dark green evening gown',
      });

      // Never throws; returns empty array so orchestrator can degrade cleanly
      expect(results).toEqual([]);
    });
  });

  describe('Grounding & Anti-Fabrication URL and Image Validation (Phase 15E)', () => {
    const mockShoeItem = {
      title: 'Polished Black Leather Oxfords',
      itemType: 'black oxford shoes',
      slot: 'shoes',
      retailer: 'Zara Egypt',
    };

    const mockTrousersItem = {
      title: 'Tailored Wool-Blend Trousers',
      itemType: 'navy formal trousers',
      slot: 'bottom',
      retailer: 'Zara Egypt',
    };

    it('1. Correct product + correct product image -> accepted', () => {
      const validImg = 'https://static.zara.net/photos/2026/I/1/2/p/1234/567/800/oxford-shoes.jpg';
      const result = verifyProductImageUrl(validImg, mockShoeItem, 'https://zara.com/eg/en/oxford-shoes-p1234.html');
      expect(result).toBe(validImg);
    });

    it('2. Correct product + wrong product image -> rejected (null)', () => {
      // Conflicting category: item is shoes, but image is explicitly a floral dress
      const wrongImg = 'https://static.zara.net/photos/2026/floral-dress-evening.jpg';
      const result = verifyProductImageUrl(wrongImg, mockShoeItem, 'https://zara.com/eg/en/oxford-shoes-p1234.html');
      expect(result).toBeNull();
    });

    it('3. Correct product + exact product page -> accepted', () => {
      const validPage = 'https://zara.com/eg/en/wool-trousers-p1.html';
      const result = verifyDirectProductUrl(validPage, mockTrousersItem);
      expect(result).toBe(validPage);
    });

    it('4. Retailer homepage & index variations -> strictly rejected (null)', () => {
      // User-reported live leakage: H&M /en_eg/index.html
      expect(verifyDirectProductUrl('https://www.hm.com/en_eg/index.html', mockTrousersItem)).toBeNull();
      expect(verifyDirectProductUrl('https://www.hm.com/en_eg/', mockTrousersItem)).toBeNull();
      expect(verifyDirectProductUrl('https://www.hm.com/en_eg', mockTrousersItem)).toBeNull();
      expect(verifyDirectProductUrl('https://www.hm.com/en-eg/', mockTrousersItem)).toBeNull();
      expect(verifyDirectProductUrl('https://www.zara.com/eg/', mockTrousersItem)).toBeNull();
      expect(verifyDirectProductUrl('https://www.zara.com/', mockTrousersItem)).toBeNull();
      expect(verifyDirectProductUrl('https://eg.hm.com/', mockShoeItem)).toBeNull();
      expect(verifyDirectProductUrl('https://shop.mango.com/eg-en', mockTrousersItem)).toBeNull();
      expect(verifyDirectProductUrl('https://www.amazon.eg', mockShoeItem)).toBeNull();
      expect(verifyDirectProductUrl('https://example.com/home.html', mockTrousersItem)).toBeNull();
      expect(verifyDirectProductUrl('https://example.com/default.html', mockTrousersItem)).toBeNull();
      expect(verifyDirectProductUrl('https://example.com/index.htm', mockTrousersItem)).toBeNull();
      expect(verifyDirectProductUrl('https://example.com/index.php', mockTrousersItem)).toBeNull();
    });

    it('5. Category or search page -> rejected (null)', () => {
      // Search pages
      expect(verifyDirectProductUrl('https://zara.com/eg/en/search?q=oxford', mockShoeItem)).toBeNull();
      expect(verifyDirectProductUrl('https://amazon.eg/s?k=trousers', mockTrousersItem)).toBeNull();
      // Category pages
      expect(verifyDirectProductUrl('https://zara.com/category/shoes', mockShoeItem)).toBeNull();
      expect(verifyDirectProductUrl('https://zara.com/eg/en/shoes-c358017.html', mockShoeItem)).toBeNull();
      expect(verifyDirectProductUrl('https://defacto.com/en-eg/men/shoes', mockShoeItem)).toBeNull();
    });

    it('6. Stock photography image -> rejected (null)', () => {
      const validPage = 'https://zara.com/eg/en/oxford-shoes-p12345.html';
      expect(verifyProductImageUrl('https://images.unsplash.com/photo-1549298916-b41d501d3772', mockShoeItem, validPage)).toBeNull();
      expect(verifyProductImageUrl('https://images.pexels.com/photos/123/pexels-photo.jpeg', mockShoeItem, validPage)).toBeNull();
      expect(verifyProductImageUrl('https://image.shutterstock.com/image-photo/black-shoes-260nw.jpg', mockShoeItem, validPage)).toBeNull();
    });

    it('7. Lookbook, campaign, editorial, and placeholder images -> strictly rejected (null)', () => {
      const validPage = 'https://zara.com/eg/en/wool-trousers-p1.html';
      // User-reported live leakage: H&M /hm-lookbook
      expect(
        verifyProductImageUrl(
          'https://lp2.hm.com/hmgoepprod?set=source[/10/68/sample.jpg],target[/hm-lookbook]&call=url[file:/product/main]',
          mockTrousersItem,
          validPage
        )
      ).toBeNull();
      expect(verifyProductImageUrl('https://cdn.example.com/assets/summer-campaign.jpg', mockTrousersItem, validPage)).toBeNull();
      expect(verifyProductImageUrl('https://cdn.example.com/assets/editorial-suit.jpg', mockTrousersItem, validPage)).toBeNull();
      expect(verifyProductImageUrl('https://placehold.co/600x400', mockShoeItem, validPage)).toBeNull();
      expect(verifyProductImageUrl('https://via.placeholder.com/300x300.png', mockShoeItem, validPage)).toBeNull();
      expect(verifyProductImageUrl('https://cdn.example.com/assets/default-image.jpg', mockShoeItem, validPage)).toBeNull();
      expect(verifyProductImageUrl('https://cdn.example.com/assets/logo.png', mockShoeItem, validPage)).toBeNull();
      expect(verifyProductImageUrl('https://cdn.example.com/assets/banner.jpg', mockShoeItem, validPage)).toBeNull();
    });

    it('8. Unverified URL, data URI, or missing/rejected sourceUrl -> null', () => {
      // If sourceUrl is rejected or null, imageUrl must be null (do not retain ungrounded image)
      expect(verifyProductImageUrl('https://static.zara.net/photos/sample.jpg', mockShoeItem, null)).toBeNull();
      expect(verifyDirectProductUrl('not-a-valid-url', mockTrousersItem)).toBeNull();
      expect(verifyDirectProductUrl('', mockTrousersItem)).toBeNull();
      expect(verifyDirectProductUrl('ftp://invalidscheme.com', mockTrousersItem)).toBeNull();
      expect(verifyDirectProductUrl('https://www.lcwaikiki.com/ar-EG/EG/p/8537639', mockTrousersItem)).toBeNull();
      expect(verifyProductImageUrl('https://img-lcwaikiki.mncdn.com/pim/productimages/8537639.jpg', mockTrousersItem, null)).toBe('https://img-lcwaikiki.mncdn.com/pim/productimages/8537639.jpg');
      expect(verifyProductImageUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA...', mockShoeItem, 'https://zara.com/eg/en/wool-trousers-p1.html')).toBeNull();
      expect(verifyProductImageUrl(null, mockShoeItem, 'https://zara.com/eg/en/wool-trousers-p1.html')).toBeNull();
    });

    it('9. Valid Zara deep product URL + matching exact product image SKU -> accepted', () => {
      const zaraProductUrl = 'https://www.zara.com/eg/en/wide-leg-suit-trousers-p02761045.html';
      const zaraProductImg = 'https://static.zara.net/photos///2023/V/0/1/p/2761/045/800/2/w/850/2761045800_6_1_1.jpg';

      expect(verifyDirectProductUrl(zaraProductUrl, mockTrousersItem)).toBe(zaraProductUrl);
      expect(verifyProductImageUrl(zaraProductImg, mockTrousersItem, zaraProductUrl)).toBe(zaraProductImg);
    });

    it('10. Mismatched product image SKU -> rejected (null)', () => {
      const zaraProductUrl = 'https://www.zara.com/eg/en/wide-leg-suit-trousers-p02761045.html';
      // Conflicting SKU: URL is 02761045, image path explicitly targets 99998888
      const mismatchedSkuImg = 'https://static.zara.net/photos///2023/V/0/1/p/9999/888/800/2/w/850/9999888800_6_1_1.jpg';

      expect(verifyProductImageUrl(mismatchedSkuImg, mockTrousersItem, zaraProductUrl)).toBeNull();
    });

    it('11. Grounded search maps verified imageUrl and direct sourceUrl, rejecting homepages and stock photos', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: [
            {
              title: 'Polished Black Leather Oxfords',
              itemType: 'black oxford shoes',
              slot: 'shoes',
              description: 'Classic formal cap-toe oxford dress shoes.',
              estimatedPriceEgp: 2400,
              retailer: 'Zara Egypt',
              imageUrl: 'https://static.zara.net/photos/2026/oxford-shoes-captoe.jpg',
            },
            {
              title: 'Italian Wool Tuxedo Trousers',
              itemType: 'formal trousers',
              slot: 'bottom',
              description: 'Silk-trimmed tuxedo trousers.',
              estimatedPriceEgp: 3800,
              retailer: 'H&M Egypt',
              imageUrl: 'https://images.unsplash.com/photo-stock-trousers.jpg',
            },
          ],
        }),
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    uri: 'https://zara.com/eg/en/oxford-shoes-p12345.html',
                    title: 'Zara Egypt Polished Oxfords',
                  },
                },
                {
                  web: {
                    uri: 'https://eg.hm.com/',
                    title: 'H&M Egypt Online',
                  },
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 180, candidatesTokenCount: 90 },
      });

      const results = await searchExternalProducts({
        gapDescription: 'formal shoes and trousers',
      });

      expect(results).toHaveLength(2);

      // Suggestion 1: verified direct product page + verified product image
      expect(results[0].title).toBe('Polished Black Leather Oxfords');
      expect(results[0].sourceUrl).toBe('https://zara.com/eg/en/oxford-shoes-p12345.html');
      expect(results[0].imageUrl).toBe('https://static.zara.net/photos/2026/oxford-shoes-captoe.jpg');
      expect(results[0].isGrounded).toBe(true);

      // Suggestion 2: homepage was rejected -> sourceUrl is null, stock photo was rejected -> imageUrl is null
      expect(results[1].title).toBe('Italian Wool Tuxedo Trousers');
      expect(results[1].sourceUrl).toBeNull();
      expect(results[1].searchUrl).toContain('eg.hm.com');
      expect(results[1].imageUrl).toBeNull();
      expect(results[1].isGrounded).toBe(false);
    });

    it('12. Redis cache preserves verified imageUrl and sourceUrl', async () => {
      const cachedItem = {
        slot: 'shoes',
        itemType: 'black oxford shoes',
        title: 'Polished Black Leather Oxfords',
        description: 'Classic formal cap-toe oxford dress shoes.',
        estimatedPriceEgp: 2400,
        retailer: 'Zara Egypt',
        sourceUrl: 'https://zara.com/eg/en/oxford-shoes-p12345.html',
        sourceTitle: 'Zara Egypt Polished Oxfords',
        imageUrl: 'https://static.zara.net/photos/2026/oxford-shoes-captoe.jpg',
        citations: [{ title: 'Zara Egypt', url: 'https://zara.com/eg/en/oxford-shoes-p12345.html' }],
        isGrounded: true,
      };

      mockRedis.store.set(
        computeCacheKey('oxford dress shoes', { season: 'fall', genderPresentation: 'men' }),
        JSON.stringify([cachedItem])
      );

      const results = await searchExternalProducts({
        gapDescription: 'oxford dress shoes',
        season: 'fall',
        genderPresentation: 'men',
      });

      expect(results).toHaveLength(1);
      expect(results[0].cacheHit).toBe(true);
      expect(results[0].sourceUrl).toBe('https://zara.com/eg/en/oxford-shoes-p12345.html');
      expect(results[0].imageUrl).toBe('https://static.zara.net/photos/2026/oxford-shoes-captoe.jpg');
    });

    it('13. Shopping Request: applies TWO-OUTFIT prompt and returns up to 6 grouped items with outfitIndex and outfitTitle', async () => {
      const mockSixSuggestions = [
        { slot: 'top', itemType: 't-shirt', title: 'White Tee', estimatedPriceEgp: 450, retailer: 'Defacto', outfitIndex: 1, outfitTitle: 'Look 1' },
        { slot: 'bottom', itemType: 'jeans', title: 'Blue Jeans', estimatedPriceEgp: 1100, retailer: 'LC Waikiki', outfitIndex: 1, outfitTitle: 'Look 1' },
        { slot: 'shoes', itemType: 'sneakers', title: 'White Sneakers', estimatedPriceEgp: 1500, retailer: 'Amazon Egypt', outfitIndex: 1, outfitTitle: 'Look 1' },
        { slot: 'top', itemType: 'shirt', title: 'Oxford Shirt', estimatedPriceEgp: 1200, retailer: 'Town Team', outfitIndex: 2, outfitTitle: 'Look 2' },
        { slot: 'bottom', itemType: 'chinos', title: 'Beige Chinos', estimatedPriceEgp: 1300, retailer: 'Mobaco', outfitIndex: 2, outfitTitle: 'Look 2' },
        { slot: 'shoes', itemType: 'loafers', title: 'Penny Loafers', estimatedPriceEgp: 2200, retailer: 'Dalydress', outfitIndex: 2, outfitTitle: 'Look 2' },
      ];

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: mockSixSuggestions,
        }),
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [{ web: { uri: 'https://defacto.com/eg/tee', title: 'Defacto Tee' } }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 180 },
      });

      const results = await searchExternalProducts({
        gapDescription: 'casual outfit',
        isShoppingRequest: true,
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.config.systemInstruction).toContain('TWO-OUTFIT RULE (COMPLETE LOOK MODE)');

      expect(results).toHaveLength(6);
      expect(results.filter((r) => r.outfitIndex === 1)).toHaveLength(3);
      expect(results.filter((r) => r.outfitIndex === 2)).toHaveLength(3);
      expect(results[0].outfitTitle).toBe('Look 1');
      expect(results[3].outfitTitle).toBe('Look 2');
    });

    it('14. Shopping Request with anchor garment applies ANCHOR-COMPLEMENTARY prompt, excludes anchor duplicates, and populates searchUrl', async () => {
      const mockSuggestions = [
        { slot: 'bottom', itemType: 'formal trousers', title: 'Navy Wool Trousers', estimatedPriceEgp: 1800, retailer: 'Massimo Dutti', outfitIndex: 1, outfitTitle: 'Look 1' },
        { slot: 'shoes', itemType: 'loafers', title: 'Classic Leather Loafers', estimatedPriceEgp: 2200, retailer: 'Jlood', outfitIndex: 1, outfitTitle: 'Look 1' },
        { slot: 'top', itemType: 'quarter_zip_sweater', title: 'Cream Quarter Zip Sweater', estimatedPriceEgp: 1400, retailer: 'Antikka', outfitIndex: 1, outfitTitle: 'Look 1' },
        { slot: 'bottom', itemType: 'chinos', title: 'Beige Chinos', estimatedPriceEgp: 1200, retailer: 'Mobaco', outfitIndex: 2, outfitTitle: 'Look 2' },
        { slot: 'shoes', itemType: 'shoes', title: 'Leather Brogues', estimatedPriceEgp: 2500, retailer: 'Noon Egypt', outfitIndex: 2, outfitTitle: 'Look 2' },
      ];

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({ suggestions: mockSuggestions }),
        candidates: [{ groundingMetadata: { groundingChunks: [] } }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 120 },
      });

      const anchor = {
        category: 'outerwear',
        subcategory: 'quarter_zip_sweater',
        colorFamily: 'beige',
      };

      const results = await searchExternalProducts({
        gapDescription: 'pieces to wear with beige quarter_zip_sweater',
        gapItems: [{ slot: 'bottom' }, { slot: 'shoes' }],
        isShoppingRequest: true,
        anchor,
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.config.systemInstruction).toContain('ANCHOR-COMPLEMENTARY OUTFIT RULE');
      expect(callArgs.config.systemInstruction).toContain('STRICT EXCLUSION');

      // The sweater duplicate suggestion was filtered out defensively
      expect(results.some((r) => r.slot === 'top' || /quarter\s*zip/i.test(r.title))).toBe(false);
      expect(results).toHaveLength(4);

      // Known retailers without direct sourceUrl receive searchUrl fallback
      const massimoItem = results.find((r) => r.retailer.includes('Massimo'));
      expect(massimoItem.sourceUrl).toBeNull();
      expect(massimoItem.searchUrl).toContain('massimodutti.com');

      const jloodItem = results.find((r) => r.retailer.includes('Jlood'));
      expect(jloodItem.sourceUrl).toBeNull();
      expect(jloodItem.searchUrl).toContain('jlood.com');
    });

    it('15. Arabic retailer names match KNOWN_RETAILERS, populate searchUrl, and generate high-res brand logos', async () => {
      // Test Arabic brand name matching
      expect(getKnownRetailerInfo('جوميا مصر')?.domain).toBe('jumia.com.eg');
      expect(getKnownRetailerInfo('ديفاكتو مصر')?.domain).toBe('defacto.com');
      expect(getKnownRetailerInfo('لطفي')?.domain).toBe('lotfy.com');
      expect(getKnownRetailerInfo('زارا')?.domain).toBe('zara.com');

      // Test search URL builders
      expect(buildRetailerSearchUrl('جوميا مصر', 'حذاء أكسفورد')).toContain('jumia.com.eg');
      expect(buildRetailerSearchUrl('ديفاكتو مصر', 'بنطلون')).toContain('defacto.com');
      expect(buildRetailerSearchUrl('لطفي', 'حذاء ديربي')).toContain('lotfy.com');

      // Test brand logo builders
      expect(buildRetailerLogoUrl('جوميا مصر')).toContain('google.com/s2/favicons?domain=jumia.com.eg');
      expect(buildRetailerLogoUrl('لطفي')).toContain('google.com/s2/favicons?domain=lotfy.com');

      // Test searchExternalProducts execution with Arabic retailer names
      const mockSuggestions = [
        { slot: 'shoes', itemType: 'oxfords', title: 'حذاء أكسفورد', estimatedPriceEgp: 2899, retailer: 'جوميا مصر' },
        { slot: 'bottom', itemType: 'chinos', title: 'بنطلون تشينو', estimatedPriceEgp: 950, retailer: 'ديفاكتو مصر' },
        { slot: 'shoes', itemType: 'derbies', title: 'حذاء ديربي', estimatedPriceEgp: 2500, retailer: 'لطفي' },
      ];

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({ suggestions: mockSuggestions }),
        candidates: [{ groundingMetadata: { groundingChunks: [] } }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 100 },
      });

      const results = await searchExternalProducts({
        gapDescription: 'ملابس وأحذية للرجال',
        isShoppingRequest: true,
      });

      expect(results).toHaveLength(3);
      expect(results[0].searchUrl).toContain('jumia.com.eg');
      expect(results[1].searchUrl).toContain('defacto.com');
      expect(results[2].searchUrl).toContain('lotfy.com');
    });

    it('16. Ungrounded LLM recommendations with fabricated deep URLs are rejected in favor of verified store searchUrl', async () => {
      // Simulate ungrounded response where LLM provides listing page and dead domain
      const mockSuggestions = [
        {
          slot: 'shoes',
          itemType: 'oxfords',
          title: 'حذاء أكسفورد كلاسيكي',
          estimatedPriceEgp: 2899,
          retailer: 'زارا مصر',
          sourceUrl: 'https://www.zara.com/eg/ar/men-trousers-l1111.html',
        },
        {
          slot: 'bottom',
          itemType: 'trousers',
          title: 'بنطلون قماش كلاسيك',
          estimatedPriceEgp: 1099,
          retailer: 'LC Waikiki',
          sourceUrl: 'https://www.lcwaikiki.com/ar-EG/EG/p/8537639',
        },
      ];

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({ suggestions: mockSuggestions }),
        candidates: [{ groundingMetadata: { groundingChunks: [] } }], // No grounding chunks!
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 100 },
      });

      const results = await searchExternalProducts({
        gapDescription: 'حذاء وبنطلون',
        isShoppingRequest: true,
      });

      expect(results).toHaveLength(2);
      // Hallucinated deep product URLs are strictly rejected
      expect(results[0].sourceUrl).toBeNull();
      expect(results[0].searchUrl).toContain('zara.com/eg/ar/search?searchTerm=');
      expect(results[0].isGrounded).toBe(false);

      expect(results[1].sourceUrl).toBeNull();
      expect(results[1].searchUrl).toContain('lcwaikiki.eg/%D8%A8%D8%AD%D8%AB?q=');
      expect(results[1].isGrounded).toBe(false);

      // Non-domain retailer strings in buildRetailerLogoUrl return null
      expect(buildRetailerLogoUrl("DeBacker's")).toBeNull();
      expect(buildRetailerLogoUrl('Unknown Boutique')).toBeNull();
      expect(buildRetailerLogoUrl('جوميا مصر')).toContain('google.com/s2/favicons?domain=jumia.com.eg');
    });

    it('17. Real product pages for Massimo Dutti (-c0p...) and Zara (-p...) populate sourceUrl to buy, and searchUrl to search the site', async () => {
      const mockSuggestions = [
        {
          slot: 'shoes',
          itemType: 'oxfords',
          title: 'Leather Oxford Shoes',
          estimatedPriceEgp: 12000,
          retailer: 'Massimo Dutti',
          sourceUrl: 'https://www.massimodutti.com/eg/en/oxford-shoes-c0p127014508.html',
        },
        {
          slot: 'bottom',
          itemType: 'suit trousers',
          title: 'Comfort Suit Trousers',
          estimatedPriceEgp: 1790,
          retailer: 'Zara Egypt',
          sourceUrl: 'https://www.zara.com/eg/en/comfort-suit-trousers-p04404332.html',
        },
      ];

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({ suggestions: mockSuggestions }),
        candidates: [{ groundingMetadata: {} }],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 100 },
      });

      const results = await searchExternalProducts({
        gapDescription: 'shoes and trousers',
        isShoppingRequest: true,
      });

      expect(results).toHaveLength(2);

      // Massimo Dutti: sourceUrl is direct product page to buy, searchUrl searches the same site
      expect(results[0].sourceUrl).toBe('https://www.massimodutti.com/eg/en/oxford-shoes-c0p127014508.html');
      expect(results[0].searchUrl).toContain('massimodutti.com/eg/en/search?searchTerm=');
      expect(results[0].sourceUrl).not.toBe(results[0].searchUrl);

      // Zara: sourceUrl is direct product page to buy, searchUrl searches the same site
      expect(results[1].sourceUrl).toBe('https://www.zara.com/eg/en/comfort-suit-trousers-p04404332.html');
      expect(results[1].searchUrl).toContain('zara.com/eg/ar/search?searchTerm=');
      expect(results[1].sourceUrl).not.toBe(results[1].searchUrl);
    });

    it('18. Grounding mapping order independence (suggestion 0 -> chunk 3, suggestion 1 -> chunk 0)', () => {
      const mockSuggestions = [
        {
          title: 'Slim Chino Pants',
          itemType: 'chinos',
          slot: 'bottom',
          description: 'Slim fit navy chinos.',
          retailer: 'Massimo Dutti',
          sourceUrl: 'https://www.massimodutti.com/eg/en/chino-pants-c0p123.html',
        },
        {
          title: 'Classic Derby Shoes',
          itemType: 'derbies',
          slot: 'shoes',
          description: 'Black leather derbies.',
          retailer: 'Zara Egypt',
          sourceUrl: 'https://www.zara.com/eg/en/derby-shoes-p456.html',
        },
      ];

      const groundingMetadata = {
        groundingChunks: [
          { web: { uri: 'https://www.zara.com/eg/en/derby-shoes-p456.html', title: 'Zara Derby Shoes' } },
          { web: { uri: 'https://www.zara.com/eg/en/overview', title: 'Zara Overview' } },
          { web: { uri: 'https://www.massimodutti.com/eg/en/about', title: 'About Massimo Dutti' } },
          { web: { uri: 'https://www.massimodutti.com/eg/en/chino-pants-c0p123.html', title: 'MD Chinos' } },
        ],
        groundingSupports: [
          {
            segment: { text: 'Slim Chino Pants' },
            groundingChunkIndices: [3],
          },
          {
            segment: { text: 'Classic Derby Shoes' },
            groundingChunkIndices: [0],
          },
        ],
      };

      const mapped = mapSuggestionsToGrounding(mockSuggestions, groundingMetadata, JSON.stringify(mockSuggestions));
      expect(mapped).toHaveLength(2);

      // Suggestion 0 mapped to chunk 3 (Massimo Dutti)
      expect(mapped[0].citations).toHaveLength(1);
      expect(mapped[0].citations[0].url).toBe('https://www.massimodutti.com/eg/en/chino-pants-c0p123.html');
      expect(mapped[0].citations[0].title).toBe('MD Chinos');

      // Suggestion 1 mapped to chunk 0 (Zara)
      expect(mapped[1].citations).toHaveLength(1);
      expect(mapped[1].citations[0].url).toBe('https://www.zara.com/eg/en/derby-shoes-p456.html');
      expect(mapped[1].citations[0].title).toBe('Zara Derby Shoes');
    });

    it('19. Section 29 URL validation: valid deep link vs homepage, category, search, and fake', () => {
      // Valid deep product URL
      expect(verifyDirectProductUrl('https://www.zara.com/eg/en/product-name-p123456.html', { slot: 'bottom' })).toBe('https://www.zara.com/eg/en/product-name-p123456.html');

      // Invalid: Homepage
      expect(verifyDirectProductUrl('https://www.zara.com/', { slot: 'bottom' })).toBeNull();

      // Invalid: Search page
      expect(verifyDirectProductUrl('https://www.zara.com/eg/en/search?searchTerm=trousers', { slot: 'bottom' })).toBeNull();

      // Invalid: Category page
      expect(verifyDirectProductUrl('https://www.zara.com/eg/en/men/trousers-c123.html', { slot: 'bottom' })).toBeNull();

      // Invalid: Fake / untrusted domain
      expect(verifyDirectProductUrl('https://example.com/fake-product', { slot: 'bottom' })).toBeNull();
    });

    it('20. Section 29 Image validation: reject stock photos and placeholders, accept verified retailer image', () => {
      const mockItem = { slot: 'shoes', title: 'Oxford Shoes', itemType: 'shoes' };

      // Stock photography rejected
      expect(verifyProductImageUrl('https://unsplash.com/photos/shoes.jpg', mockItem)).toBeNull();
      expect(verifyProductImageUrl('https://images.pexels.com/photos/shoes.jpg', mockItem)).toBeNull();
      expect(verifyProductImageUrl('https://www.shutterstock.com/image-photo/shoes.jpg', mockItem)).toBeNull();
      expect(verifyProductImageUrl('https://via.placeholder.com/300', mockItem)).toBeNull();

      // Placeholders / banners / logos rejected
      expect(verifyProductImageUrl('https://static.zara.net/photos/logo.png', mockItem)).toBeNull();
      expect(verifyProductImageUrl('https://static.zara.net/photos/campaign_banner.jpg', mockItem)).toBeNull();
      expect(verifyProductImageUrl('https://static.zara.net/photos/avatar.jpg', mockItem)).toBeNull();

      // Authentic retailer CDN image accepted
      expect(verifyProductImageUrl('https://static.zara.net/photos/shoes_12345.jpg', mockItem)).toBe('https://static.zara.net/photos/shoes_12345.jpg');
    });

    it('21. extractProductSku correctly parses Noon, Amazon, Jumia, and Zara identifiers', () => {
      expect(extractProductSku('https://www.noon.com/egypt-en/men-slim-fit-chino-pants/Z2B283B355C374C4EC18CZ/p/')).toBe('Z2B283B355C374C4EC18CZ');
      expect(extractProductSku('https://www.noon.com/egypt-ar/p/Z2B283B355C374C4EC18CZ/p/')).toBe('Z2B283B355C374C4EC18CZ');
      expect(extractProductSku('https://www.noon.com/egypt-ar/p/Z2B283B355C374C4EC18CZ/')).toBe('Z2B283B355C374C4EC18CZ');
      expect(extractProductSku('https://www.noon.com/egypt-en/p/N12345678A/')).toBe('N12345678A');
      expect(extractProductSku('https://f.nooncdn.com/products/tr:n-t_400/Z2B283B355C374C4EC18CZ_1.jpg')).toBe('Z2B283B355C374C4EC18CZ');
      expect(extractProductSku('https://www.amazon.eg/dp/B08XYZ1234')).toBe('B08XYZ1234');
      expect(extractProductSku('https://www.jumia.com.eg/mr-joe-shoes-8794031.html')).toBe('8794031');
      expect(extractProductSku('https://www.zara.com/eg/en/wide-leg-suit-trousers-p02761045.html')).toBe('02761045');
      expect(extractProductSku('https://example.com/')).toBeNull();
    });

    it('22. Noon Egypt product link with Cloudflare abort preserves direct sourceUrl and resolves authentic Noon CDN image', async () => {
      setHttpFetchOverride(async () => {
        throw new Error('This operation was aborted');
      });

      const noonProductUrl = 'https://www.noon.com/egypt-ar/p/Z2B283B355C374C4EC18CZ/p/';
      const noonSuggestion = {
        title: 'بنطلون رجالي كلاسيك رسمي كحلي',
        itemType: 'بنطلون قماش',
        slot: 'bottom',
        description: 'بنطلون بدلة رجالي كلاسيكي',
        retailer: 'نون مصر',
        sourceUrl: noonProductUrl,
        imageUrl: 'https://f.nooncdn.com/products/tr:n-t_400/Z2B283B355C374C4EC18CZ_1.jpg',
      };

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: [noonSuggestion],
        }),
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 200 },
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: noonProductUrl, title: 'Noon Egypt Trousers' } },
              ],
              groundingSupports: [],
            },
          },
        ],
      });

      const results = await searchExternalProducts({
        gapDescription: 'بنطلون رجالي كلاسيك رسمي كحلي',
        locale: 'ar',
      });

      expect(results).toHaveLength(1);
      const item = results[0];
      expect(item.retailer).toBe('نون مصر');
      expect(item.sourceUrl).toBe(noonProductUrl);
      // Resolved to real Noon product CDN image based on SKU, NOT a favicon
      expect(item.imageUrl).toBe('https://f.nooncdn.com/products/tr:n-t_400/Z2B283B355C374C4EC18CZ_1.jpg');
      expect(item.imageUrl).not.toContain('favicons');
      expect(item.isGrounded).toBe(true);
      expect(item.verificationStatus).toBe(PRODUCT_VERIFICATION_STATUS.GOOGLE_GROUNDED_ONLY);
      expect(item.isLiveVerified).toBe(false);
      expect(item.availability).toBe('unknown');
      expect(item.citations).toHaveLength(1);
      expect(item.citations[0].url).toBe(noonProductUrl);
    });

    it('23. Strict Currency Gate: rejects candidate URL when page currency is not EGP (e.g. USD, GBP)', async () => {
      const foreignProductUrl = 'https://www.zara.com/eg/en/uk-trousers-p12345.html';
      const foreignHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Zara Foreign Currency Trousers</title>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org/",
            "@type": "Product",
            "name": "Zara Trousers",
            "image": "https://static.zara.net/photos/trousers.jpg",
            "offers": {
              "@type": "Offer",
              "price": "79.00",
              "priceCurrency": "GBP",
              "availability": "https://schema.org/InStock"
            }
          }
          </script>
        </head>
        <body><p>Product description</p></body>
        </html>
      `;

      setHttpFetchOverride(async () => ({
        ok: true,
        status: 200,
        url: foreignProductUrl,
        headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'text/html' : null) },
        text: async () => foreignHtml,
      }));

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: [
            {
              title: 'Zara Trousers',
              itemType: 'trousers',
              slot: 'bottom',
              retailer: 'Zara Egypt',
              sourceUrl: foreignProductUrl,
              imageUrl: 'https://static.zara.net/photos/trousers.jpg',
            },
          ],
        }),
        candidates: [{ groundingMetadata: { groundingChunks: [] } }],
      });

      const results = await searchExternalProducts({ gapDescription: 'navy trousers' });
      // Candidate was rejected due to GBP currency; sourceUrl must NOT be the foreign URL
      expect(results).toHaveLength(1);
      expect(results[0].sourceUrl).toBeNull();
      expect(results[0].estimatedPriceEgp).toBeNull();
    });

    it('24. Strict Stock Gate: rejects candidate URL when page reports out-of-stock', async () => {
      const oosProductUrl = 'https://www.zara.com/eg/en/oos-trousers-p54321.html';
      const oosHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Zara Out Of Stock Trousers</title>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org/",
            "@type": "Product",
            "name": "Zara Sold Out Trousers",
            "image": "https://static.zara.net/photos/trousers.jpg",
            "offers": {
              "@type": "Offer",
              "price": "1499.00",
              "priceCurrency": "EGP",
              "availability": "https://schema.org/OutOfStock"
            }
          }
          </script>
        </head>
        <body><p>Product description</p></body>
        </html>
      `;

      setHttpFetchOverride(async () => ({
        ok: true,
        status: 200,
        url: oosProductUrl,
        headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'text/html' : null) },
        text: async () => oosHtml,
      }));

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: [
            {
              title: 'Zara Sold Out Trousers',
              itemType: 'trousers',
              slot: 'bottom',
              retailer: 'Zara Egypt',
              sourceUrl: oosProductUrl,
              imageUrl: 'https://static.zara.net/photos/trousers.jpg',
            },
          ],
        }),
        candidates: [{ groundingMetadata: { groundingChunks: [] } }],
      });

      const results = await searchExternalProducts({ gapDescription: 'navy trousers' });
      // Candidate was rejected due to OutOfStock; sourceUrl must NOT be preserved as purchasable card
      expect(results).toHaveLength(1);
      expect(results[0].sourceUrl).toBeNull();
    });

    it('25. Strict Stock & Currency Gate: accepts in-stock EGP product and propagates fields', async () => {
      const inStockProductUrl = 'https://www.zara.com/eg/en/instock-trousers-p88888.html';
      const inStockHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Zara In Stock Trousers</title>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org/",
            "@type": "Product",
            "name": "Zara Formal Trousers",
            "image": "https://static.zara.net/photos/trousers.jpg",
            "offers": {
              "@type": "Offer",
              "price": "2290.00",
              "priceCurrency": "EGP",
              "availability": "https://schema.org/InStock"
            }
          }
          </script>
        </head>
        <body><p>Product description</p></body>
        </html>
      `;

      setHttpFetchOverride(async () => ({
        ok: true,
        status: 200,
        url: inStockProductUrl,
        headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'text/html' : null) },
        text: async () => inStockHtml,
      }));

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: [
            {
              title: 'Zara Formal Trousers',
              itemType: 'trousers',
              slot: 'bottom',
              retailer: 'Zara Egypt',
              sourceUrl: inStockProductUrl,
              imageUrl: 'https://static.zara.net/photos/trousers.jpg',
            },
          ],
        }),
        candidates: [{ groundingMetadata: { groundingChunks: [] } }],
      });

      const results = await searchExternalProducts({ gapDescription: 'navy trousers' });
      expect(results).toHaveLength(1);
      expect(results[0].sourceUrl).toBe(inStockProductUrl);
      expect(results[0].currency).toBe('EGP');
      expect(results[0].availability).toBe('in_stock');
      expect(results[0].estimatedPriceEgp).toBe(2290);
    });

    it('26. cleanRetailerTitle: strips retailer brand suffix, SEO noise, and store names', () => {
      expect(cleanRetailerTitle('Navy Formal Trousers | Zara Egypt')).toBe('Navy Formal Trousers');
      expect(cleanRetailerTitle('Classic Leather Shoes - Noon.com Egypt')).toBe('Classic Leather Shoes');
      expect(cleanRetailerTitle('White Oxford Shirt : Amazon.eg')).toBe('White Oxford Shirt');
      expect(cleanRetailerTitle('بنطلون رجالي كلاسيك | جوميا مصر')).toBe('بنطلون رجالي كلاسيك');
      expect(cleanRetailerTitle('Plain Cotton T-Shirt')).toBe('Plain Cotton T-Shirt');
      expect(cleanRetailerTitle('')).toBeNull();
    });

    it('27. verifyPageProductMatch: rejects slot, gender, and overt color contradictions', () => {
      // Slot mismatch: item is shoes, page title is shirt
      const slotMismatch = verifyPageProductMatch(
        { slot: 'shoes', title: 'Black Oxford Shoes' },
        { valid: true, title: 'Men Oxford Cotton Dress Shirt - Long Sleeve' }
      );
      expect(slotMismatch.matches).toBe(false);
      expect(slotMismatch.reason).toContain('slot_mismatch');

      // Gender mismatch: requested men, page is ladies / women
      const genderMismatch = verifyPageProductMatch(
        { slot: 'top', title: 'Summer Shirt' },
        { valid: true, title: "Women's Floral Maxi Dress" },
        'men'
      );
      expect(genderMismatch.matches).toBe(false);
      expect(genderMismatch.reason).toContain('gender_mismatch');

      // Color mismatch: requested black, page is bright pink
      const colorMismatch = verifyPageProductMatch(
        { slot: 'outerwear', title: 'Black Formal Blazer' },
        { valid: true, title: 'Pink Double-Breasted Tailored Blazer' },
        'men'
      );
      expect(colorMismatch.matches).toBe(false);
      expect(colorMismatch.reason).toContain('color_mismatch');

      // Valid match: item shoes, page shoes, men
      const validMatch = verifyPageProductMatch(
        { slot: 'shoes', title: 'Black Oxford Shoes' },
        { valid: true, title: 'Men Classic Black Oxford Shoes | Zara Egypt' },
        'men'
      );
      expect(validMatch.matches).toBe(true);
    });

    it('28. Page Metadata as Source of Truth: scraped page title overrides model hallucinated title', async () => {
      const realProductUrl = 'https://www.zara.com/eg/en/brown-loafers-p77777.html';
      const realHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Brown Leather Loafers | Zara Egypt</title>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org/",
            "@type": "Product",
            "name": "Brown Leather Loafers",
            "image": "https://static.zara.net/photos/loafers.jpg",
            "offers": {
              "@type": "Offer",
              "price": "3200",
              "priceCurrency": "EGP",
              "availability": "https://schema.org/InStock"
            }
          }
          </script>
        </head>
        <body><p>Product description</p></body>
        </html>
      `;

      setHttpFetchOverride(async () => ({
        ok: true,
        status: 200,
        url: realProductUrl,
        headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'text/html' : null) },
        text: async () => realHtml,
      }));

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: [
            {
              // Model hallucinates "Black Oxford Shoes", but link is actually "Brown Leather Loafers"
              title: 'Black Oxford Shoes',
              itemType: 'shoes',
              slot: 'shoes',
              retailer: 'Zara Egypt',
              sourceUrl: realProductUrl,
              imageUrl: 'https://static.zara.net/photos/loafers.jpg',
            },
          ],
        }),
        candidates: [{ groundingMetadata: { groundingChunks: [] } }],
      });

      const results = await searchExternalProducts({ gapDescription: 'dress shoes' });
      expect(results).toHaveLength(1);
      // The page title MUST be the source of truth, not the model's hallucinated title!
      expect(results[0].title).toBe('Brown Leather Loafers');
      expect(results[0].title).not.toBe('Black Oxford Shoes');
    });

    it('29. Verification Status: LIVE_VERIFIED when 200 OK with verified JSON-LD metadata', async () => {
      const liveProductUrl = 'https://www.zara.com/eg/en/wool-trousers-p88888.html';
      const liveHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <script type="application/ld+json">
          {
            "@type": "Product",
            "name": "Navy Wool Trousers",
            "image": "https://static.zara.net/photos/wool-trousers.jpg",
            "offers": { "price": 2490, "priceCurrency": "EGP", "availability": "https://schema.org/InStock" }
          }
          </script>
        </head>
        <body><p>Detailed product description</p></body>
        </html>
      `;

      setHttpFetchOverride(async () => ({
        ok: true,
        status: 200,
        url: liveProductUrl,
        headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'text/html' : null) },
        text: async () => liveHtml,
      }));

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: [
            {
              title: 'Navy Wool Trousers',
              itemType: 'trousers',
              slot: 'bottom',
              retailer: 'Zara Egypt',
              sourceUrl: liveProductUrl,
              imageUrl: 'https://static.zara.net/photos/wool-trousers.jpg',
            },
          ],
        }),
        candidates: [{ groundingMetadata: { groundingChunks: [] } }],
      });

      const results = await searchExternalProducts({ gapDescription: 'formal trousers' });
      expect(results).toHaveLength(1);
      expect(results[0].verificationStatus).toBe(PRODUCT_VERIFICATION_STATUS.LIVE_VERIFIED);
      expect(results[0].isLiveVerified).toBe(true);
      expect(results[0].availability).toBe('in_stock');
      expect(results[0].estimatedPriceEgp).toBe(2490);
    });

    it('30. Verification Status: GOOGLE_GROUNDED_ONLY when blocked by anti-bot DDoS protection', async () => {
      const botBlockedUrl = 'https://www.jumia.com.eg/classic-shoes-p99999.html';

      setHttpFetchOverride(async () => ({
        ok: false,
        status: 403,
        url: botBlockedUrl,
        headers: { get: () => 'text/html' },
        text: async () => '<html><body>403 Forbidden Cloudflare</body></html>',
      }));

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: [
            {
              title: 'Classic Derby Shoes',
              itemType: 'shoes',
              slot: 'shoes',
              retailer: 'Jumia Egypt',
              sourceUrl: botBlockedUrl,
              imageUrl: 'https://eg.jumia.is/photos/derby.jpg',
              estimatedPriceEgp: 1200,
            },
          ],
        }),
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    uri: botBlockedUrl,
                    title: 'Jumia Egypt Classic Derby Shoes',
                  },
                },
              ],
            },
          },
        ],
      });

      const results = await searchExternalProducts({ gapDescription: 'dress shoes' });
      expect(results).toHaveLength(1);
      // Link preserved so user can navigate to retailer, but truthfully not claiming live verified stock/price
      expect(results[0].verificationStatus).toBe(PRODUCT_VERIFICATION_STATUS.GOOGLE_GROUNDED_ONLY);
      expect(results[0].isLiveVerified).toBe(false);
      expect(results[0].availability).toBe('unknown');
      expect(results[0].sourceUrl).toBe(botBlockedUrl);
    });

    it('31. Google redirector vertexaisearch.cloud.google.com is strictly rejected as buy URL', async () => {
      const redirectorUrl = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123xyz';

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: [
            {
              title: 'Cotton Poplin Shirt',
              itemType: 'shirt',
              slot: 'top',
              retailer: 'H&M Egypt',
              sourceUrl: redirectorUrl,
              imageUrl: 'https://lp2.hm.com/shirt.jpg',
            },
          ],
        }),
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    uri: redirectorUrl,
                    title: 'H&M Egypt Shirt',
                  },
                },
              ],
            },
          },
        ],
      });

      const results = await searchExternalProducts({ gapDescription: 'white shirt' });
      expect(results).toHaveLength(1);
      // Must NEVER expose vertexaisearch as sourceUrl
      expect(results[0].sourceUrl).toBeNull();
      expect(results[0].verificationStatus).toBe(PRODUCT_VERIFICATION_STATUS.SEARCH_FALLBACK);
    });

    it('32. No Blind Guessing: missing image is NOT replaced with synthetic CDN guess', async () => {
      const noonProductUrl = 'https://www.noon.com/egypt-ar/p/Z2B283B355C374C4EC18CZ/p/';

      setHttpFetchOverride(async () => {
        throw new Error('This operation was aborted by anti-bot DDoS shield');
      });

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: [
            {
              title: 'Classic Trousers',
              itemType: 'trousers',
              slot: 'bottom',
              retailer: 'Noon Egypt',
              sourceUrl: noonProductUrl,
              imageUrl: null, // No image from grounding or page
            },
          ],
        }),
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [{ web: { uri: noonProductUrl, title: 'Noon Product' } }],
            },
          },
        ],
      });

      const results = await searchExternalProducts({ gapDescription: 'trousers' });
      expect(results).toHaveLength(1);
      // Image must remain null rather than fabricating a speculative _1.jpg CDN URL
      expect(results[0].imageUrl).toBeNull();
    });
  });
});
