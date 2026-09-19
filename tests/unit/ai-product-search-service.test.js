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
      expect(results[1].citations).toHaveLength(2);

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
            },
          ],
        }),
        candidates: [{ groundingMetadata: {} }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      });

      // First call caches in-memory
      const res1 = await searchExternalProducts({ gapDescription: 'white dress shirt' });
      expect(res1[0].cacheHit).toBe(false);

      // Second call hits in-memory cache
      const res2 = await searchExternalProducts({ gapDescription: 'white dress shirt' });
      expect(res2[0].cacheHit).toBe(true);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('falls back to ungrounded LLM and populates sourceUrl and sourceTitle when live search throws', async () => {
      // 1st call (grounded search) throws 429 quota error
      mockGenerateContent.mockRejectedValueOnce(new Error('RESOURCE_EXHAUSTED: quota exceeded'));

      // 2nd call (ungrounded fallback) returns suggestions
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: [
            {
              title: 'Structured Satin Lapel Tuxedo Blazer',
              itemType: 'blazer',
              slot: 'outerwear',
              description: 'Tailored black tuxedo blazer with satin lapels.',
              estimatedPriceEgp: 4590,
              retailer: 'Zara Egypt',
              sourceUrl: 'https://www.zara.com/eg/en/tuxedo-blazer-p123.html',
              sourceTitle: 'Zara Egypt Online Store',
            },
          ],
        }),
        candidates: [{ groundingMetadata: {} }],
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 60 },
      });

      const results = await searchExternalProducts({
        gapDescription: 'formal black blazer',
        locale: 'ar',
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      expect(mockGenerateContent.mock.calls[0][0].config.systemInstruction).toContain('CRITICAL ARABIC REQUIREMENT');
      expect(mockGenerateContent.mock.calls[0][0].contents[0].parts[0].text).toContain('Required Language: Arabic');
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Structured Satin Lapel Tuxedo Blazer');
      expect(results[0].retailer).toBe('Zara Egypt');
      expect(results[0].sourceUrl).toBe('https://www.zara.com/eg/en/tuxedo-blazer-p123.html');
      expect(results[0].sourceTitle).toBe('Zara Egypt Online Store');
      expect(results[0].citations).toHaveLength(1);
      expect(results[0].isGrounded).toBe(false); // No live Google Search chunk was attached
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
  });
});
