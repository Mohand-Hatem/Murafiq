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
  mapSuggestionsToGrounding,
  getKnownRetailerInfo,
  buildRetailerSearchUrl,
  buildRetailerLogoUrl,
  setProductSearchRedisOverride,
  clearInMemoryProductCache,
  CACHE_TTL_SECONDS,
} from '../../src/modules/ai/products/product-search.service.js';
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
  });
});
