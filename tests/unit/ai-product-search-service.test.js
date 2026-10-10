/**
 * Phase 15E Step 3 — Product Search Service Tests (product-search.service.js).
 *
 * Covers:
 * 1. computeCacheKey normalization and hashing.
 * 2. searchExternalProducts returns empty array on blank gap query.
 * 3. Shopping search execution: calls shopping provider pipeline with planner and ranker.
 * 4. Extracts up to 2 distinct suggestions with attached citations and source URLs.
 * 5. 24-hour Redis caching: repeated query serves from cache with cacheHit: true (zero LLM calls).
 * 6. In-memory cache fallback when Redis is disconnected.
 * 7. Fail-open resilience: returns empty array if shopping provider throws.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import '../../src/common/globals.js';
import {
  computeCacheKey,
  searchExternalProducts,
  verifyDirectProductUrl,
  verifyProductImageUrl,
  verifyLiveUrlStatus,
  verifyLiveImageUrl,
  resolveRedirectUrl,
  extractOgImage,
  setProductSearchRedisOverride,
  clearInMemoryProductCache,
  CACHE_TTL_SECONDS,
} from '../../src/modules/ai/products/product-search.service.js';
import { setGenAiClient } from '../../src/modules/ai/providers/llm.provider.js';
import { MockShoppingProvider } from '../../src/modules/ai/providers/shopping/mock-shopping.provider.js';
import { setShoppingProvider } from '../../src/modules/ai/providers/shopping/shopping-provider.factory.js';

describe('Phase 15E Step 3 — product-search.service.js', () => {
  let mockRedis;
  let mockGenerateContent;
  let mockShoppingProvider;

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

    mockShoppingProvider = new MockShoppingProvider();
    setShoppingProvider(mockShoppingProvider);

    mockGenerateContent = jest.fn();
    setGenAiClient({
      models: {
        generateContent: mockGenerateContent,
      },
    });
  });

  afterEach(() => {
    setProductSearchRedisOverride(null, null);
    setShoppingProvider(null);
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

    it('executes shopping search pipeline and returns 2 distinct suggestions with citations', async () => {
      mockGenerateContent
        .mockResolvedValueOnce({
          text: JSON.stringify({
            queries: [
              {
                slot: 'bottom',
                itemType: 'navy formal trousers',
                searchQuery: 'navy formal trousers',
                outfitIndex: 1,
                outfitTitle: 'Look 1',
              },
            ],
          }),
          usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 80 },
        })
        .mockResolvedValueOnce({
          text: JSON.stringify({
            selectedItems: [
              {
                candidateId: 'mock_bottom_01',
                slot: 'bottom',
                itemType: 'navy formal trousers',
                customTitle: 'Tailored Wool-Blend Trousers',
                description: 'Sharp navy trousers with front pleats and side adjusters.',
                outfitIndex: 1,
                outfitTitle: 'Look 1',
              },
              {
                candidateId: 'mock_bottom_02',
                slot: 'bottom',
                itemType: 'midnight blue dress trousers',
                customTitle: 'Classic Chino Suit Pants',
                description: 'Slim-cut midnight blue trousers suitable for evening formalwear.',
                outfitIndex: 1,
                outfitTitle: 'Look 1',
              },
            ],
          }),
          usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 60 },
        });

      const results = await searchExternalProducts({
        gapDescription: 'navy formal trousers',
        occasion: 'wedding',
        formality: 'formal',
        season: 'fall',
        genderPresentation: 'men',
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(2);

      // Two-Suggestion Rule: max 2 suggestions returned
      expect(results).toHaveLength(2);
      expect(results[0].title).toBe('Tailored Wool-Blend Trousers');
      expect(results[0].sourceUrl).toBe('https://www.defacto.com/ar-eg/p/mens-slim-fit-chino-pants-navy-401');
      expect(results[0].sourceTitle).toBe('DeFacto Egypt');
      expect(results[0].isGrounded).toBe(true);
      expect(results[0].cacheHit).toBe(false);

      expect(results[1].title).toBe('Classic Chino Suit Pants');
      expect(results[1].sourceUrl).toBe('https://www.massimodutti.com/eg/men/trousers/wool-tailored-trousers-charcoal-502');
      expect(results[1].citations).toHaveLength(1);

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

      mockGenerateContent
        .mockResolvedValueOnce({
          text: JSON.stringify({
            queries: [
              { slot: 'top', itemType: 'formal shirt', searchQuery: 'white dress shirt' },
            ],
          }),
        })
        .mockResolvedValueOnce({
          text: JSON.stringify({
            selectedItems: [
              {
                candidateId: 'mock_top_01',
                slot: 'top',
                customTitle: 'White French Cuff Shirt',
                description: 'Crisp white poplin shirt.',
              },
            ],
          }),
        });

      // First call caches in-memory
      const res1 = await searchExternalProducts({ gapDescription: 'white dress shirt' });
      expect(res1[0].cacheHit).toBe(false);

      // Second call hits in-memory cache
      const res2 = await searchExternalProducts({ gapDescription: 'white dress shirt' });
      expect(res2[0].cacheHit).toBe(true);
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it('falls back gracefully to fallback query planning when Planner LLM throws', async () => {
      // Planner throws on both attempt 1 and attempt 2 (retry)
      mockGenerateContent
        .mockRejectedValueOnce(new Error('LLM timeout on planner attempt 1'))
        .mockRejectedValueOnce(new Error('LLM timeout on planner attempt 2'));

      // Ranker succeeds
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          selectedItems: [
            {
              candidateId: 'mock_top_01',
              slot: 'top',
              customTitle: 'Structured Poplin White Shirt',
              description: 'Crisp white formal shirt for black-tie events.',
            },
          ],
        }),
      });

      const results = await searchExternalProducts({
        gapDescription: 'white formal shirt',
        locale: 'en',
      });

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Structured Poplin White Shirt');
      expect(results[0].retailer).toBe('DeFacto Egypt');
      expect(results[0].sourceUrl).toBe('https://www.defacto.com/ar-eg/p/mens-classic-poplin-shirt-white-101');
      expect(results[0].sourceTitle).toBe('DeFacto Egypt');
      expect(results[0].citations).toHaveLength(1);
      expect(results[0].isGrounded).toBe(true);
    });

    it('fails open and returns empty array if shopping provider throws completely (soft degradation)', async () => {
      const failingShoppingProvider = {
        searchProducts: jest.fn().mockRejectedValue(new Error('Shopping API connection timeout')),
      };

      const results = await searchExternalProducts({
        gapDescription: 'dark green evening gown',
        shoppingProviderOverride: failingShoppingProvider,
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

    it('11. Shopping search maps verified imageUrl and direct sourceUrl, rejecting homepages and invalid candidates', async () => {
      const mockProviderWithMixedCandidates = {
        searchProducts: jest.fn().mockResolvedValue([
          {
            id: 'valid_shoe',
            slot: 'shoes',
            title: 'Polished Black Leather Oxfords',
            itemType: 'black oxford shoes',
            price: 2400,
            retailer: 'Zara Egypt',
            productUrl: 'https://zara.com/eg/en/oxford-shoes-p12345.html',
            imageUrl: 'https://static.zara.net/photos/2026/oxford-shoes-captoe.jpg',
            source: 'mock',
          },
          {
            id: 'bad_trouser',
            slot: 'bottom',
            title: 'Italian Wool Tuxedo Trousers',
            itemType: 'formal trousers',
            price: 3800,
            retailer: 'H&M Egypt',
            productUrl: 'https://eg.hm.com/', // homepage -> strictly rejected!
            imageUrl: 'https://images.unsplash.com/photo-stock-trousers.jpg',
            source: 'mock',
          },
        ]),
      };

      const results = await searchExternalProducts({
        gapDescription: 'formal shoes and trousers',
        shoppingProviderOverride: mockProviderWithMixedCandidates,
      });

      expect(results).toHaveLength(1);

      // Suggestion 1: verified direct product page + verified product image
      expect(results[0].title).toBe('Polished Black Leather Oxfords');
      expect(results[0].sourceUrl).toBe('https://zara.com/eg/en/oxford-shoes-p12345.html');
      expect(results[0].imageUrl).toBe('https://static.zara.net/photos/2026/oxford-shoes-captoe.jpg');
      expect(results[0].isGrounded).toBe(true);
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

    it('13. Shopping Request: applies 2-OUTFIT prompt and returns up to 6 grouped items with outfitIndex and outfitTitle', async () => {
      mockGenerateContent
        .mockResolvedValueOnce({
          text: JSON.stringify({
            queries: [
              { slot: 'top', itemType: 'shirt', searchQuery: 'قميص أبيض', outfitIndex: 1, outfitTitle: 'Look 1' },
              { slot: 'bottom', itemType: 'pants', searchQuery: 'بنطال كحلي', outfitIndex: 1, outfitTitle: 'Look 1' },
              { slot: 'shoes', itemType: 'shoes', searchQuery: 'حذاء كلاسيك', outfitIndex: 1, outfitTitle: 'Look 1' },
              { slot: 'top', itemType: 'polo', searchQuery: 'بولو بيج', outfitIndex: 2, outfitTitle: 'Look 2' },
              { slot: 'bottom', itemType: 'chino', searchQuery: 'تشينو رمادي', outfitIndex: 2, outfitTitle: 'Look 2' },
              { slot: 'shoes', itemType: 'loafers', searchQuery: 'لوفر بني', outfitIndex: 2, outfitTitle: 'Look 2' },
            ],
          }),
        })
        .mockResolvedValueOnce({
          text: JSON.stringify({
            selectedItems: [
              { candidateId: 'c1', slot: 'top', customTitle: 'White Tee', outfitIndex: 1, outfitTitle: 'Look 1' },
              { candidateId: 'c2', slot: 'bottom', customTitle: 'Blue Jeans', outfitIndex: 1, outfitTitle: 'Look 1' },
              { candidateId: 'c3', slot: 'shoes', customTitle: 'White Sneakers', outfitIndex: 1, outfitTitle: 'Look 1' },
              { candidateId: 'c4', slot: 'top', customTitle: 'Oxford Shirt', outfitIndex: 2, outfitTitle: 'Look 2' },
              { candidateId: 'c5', slot: 'bottom', customTitle: 'Beige Chinos', outfitIndex: 2, outfitTitle: 'Look 2' },
              { candidateId: 'c6', slot: 'shoes', customTitle: 'Penny Loafers', outfitIndex: 2, outfitTitle: 'Look 2' },
            ],
          }),
        });

      const mockProvider6 = {
        searchProducts: jest.fn().mockResolvedValue([
          { id: 'c1', slot: 'top', title: 'White Tee', price: 450, retailer: 'Defacto', productUrl: 'https://defacto.com/eg/p/tee-1', imageUrl: 'https://defacto.com/img1.jpg', source: 'mock' },
          { id: 'c2', slot: 'bottom', title: 'Blue Jeans', price: 1100, retailer: 'LC Waikiki', productUrl: 'https://lcwaikiki.eg/p/jeans-2', imageUrl: 'https://lcwaikiki.eg/img2.jpg', source: 'mock' },
          { id: 'c3', slot: 'shoes', title: 'White Sneakers', price: 1500, retailer: 'Amazon Egypt', productUrl: 'https://amazon.eg/dp/B001', imageUrl: 'https://amazon.eg/img3.jpg', source: 'mock' },
          { id: 'c4', slot: 'top', title: 'Oxford Shirt', price: 1200, retailer: 'Town Team', productUrl: 'https://townteam.com/p/shirt-4', imageUrl: 'https://townteam.com/img4.jpg', source: 'mock' },
          { id: 'c5', slot: 'bottom', title: 'Beige Chinos', price: 1300, retailer: 'Mobaco', productUrl: 'https://mobaco.com/p/chino-5', imageUrl: 'https://mobaco.com/img5.jpg', source: 'mock' },
          { id: 'c6', slot: 'shoes', title: 'Penny Loafers', price: 2200, retailer: 'Dalydress', productUrl: 'https://dalydress.com/p/loafers-6', imageUrl: 'https://dalydress.com/img6.jpg', source: 'mock' },
        ]),
      };

      const results = await searchExternalProducts({
        gapDescription: 'casual outfit',
        isShoppingRequest: true,
        shoppingProviderOverride: mockProvider6,
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      const plannerArgs = mockGenerateContent.mock.calls[0][0];
      expect(plannerArgs.config.systemInstruction).toContain('2 COMPLETE coordinated outfits');
      const rankerArgs = mockGenerateContent.mock.calls[1][0];
      expect(rankerArgs.config.systemInstruction).toContain('Select exactly 6 pieces to form 2 COMPLETE coordinated outfits');

      expect(results).toHaveLength(6);
      expect(results.filter((r) => r.outfitIndex === 1)).toHaveLength(3);
      expect(results.filter((r) => r.outfitIndex === 2)).toHaveLength(3);
      expect(results[0].outfitTitle).toBe('Look 1');
      expect(results[3].outfitTitle).toBe('Look 2');
    });
  });

  describe('Redirect Resolution & OpenGraph Extraction (Grounding Fix)', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('resolveRedirectUrl returns original URL if non-vertex URL', async () => {
      const url = 'https://www.zara.com/eg/en/wool-trousers-p1.html';
      const resolved = await resolveRedirectUrl(url);
      expect(resolved).toBe(url);
    });

    it('resolveRedirectUrl returns null for invalid inputs', async () => {
      expect(await resolveRedirectUrl(null)).toBeNull();
      expect(await resolveRedirectUrl('')).toBeNull();
    });

    it('resolveRedirectUrl resolves 302 location for vertex redirect', async () => {
      const vertexUrl = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123xyz';
      const targetUrl = 'https://www.zara.com/eg/en/wool-trousers-p1.html';

      globalThis.fetch = jest.fn().mockResolvedValueOnce({
        status: 302,
        headers: {
          get: (name) => (name.toLowerCase() === 'location' ? targetUrl : null),
        },
      });

      const resolved = await resolveRedirectUrl(vertexUrl);
      expect(resolved).toBe(targetUrl);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        vertexUrl,
        expect.objectContaining({ method: 'GET', redirect: 'manual' })
      );
    });

    it('resolveRedirectUrl returns original vertex URL if fetch throws', async () => {
      const vertexUrl = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123xyz';
      globalThis.fetch = jest.fn().mockRejectedValueOnce(new Error('Network error'));

      const resolved = await resolveRedirectUrl(vertexUrl);
      expect(resolved).toBe(vertexUrl);
    });

    it('extractOgImage extracts og:image from valid HTML', async () => {
      const pageUrl = 'https://clovewear.com/products/classic-shirt-white';
      const mockOgUrl = 'https://clovewear.com/cdn/shop/files/shirt.jpg';
      const mockHtml = `<html><head><meta property="og:image" content="${mockOgUrl}"></head><body></body></html>`;

      globalThis.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (name) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null),
        },
        text: async () => mockHtml,
      });

      const extracted = await extractOgImage(pageUrl);
      expect(extracted).toBe(mockOgUrl);
    });

    it('extractOgImage resolves relative og:image URLs to absolute', async () => {
      const pageUrl = 'https://clovewear.com/products/classic-shirt-white';
      const mockHtml = `<html><head><meta content="/cdn/shop/files/relative.jpg" property="og:image"></head></html>`;

      globalThis.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (name) => (name.toLowerCase() === 'content-type' ? 'text/html' : null),
        },
        text: async () => mockHtml,
      });

      const extracted = await extractOgImage(pageUrl);
      expect(extracted).toBe('https://clovewear.com/cdn/shop/files/relative.jpg');
    });

    it('extractOgImage returns null if fetch fails or no og:image present', async () => {
      expect(await extractOgImage(null)).toBeNull();
      expect(await extractOgImage('not-a-url')).toBeNull();

      globalThis.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
      });
      expect(await extractOgImage('https://example.com/notfound')).toBeNull();
    });

    it('Color Conflict Check: rejects black garment image on white recommendation', () => {
      const whiteShirtItem = {
        title: 'قميص رسمي سادة - أبيض',
        itemType: 'قميص أبيض',
        slot: 'top',
      };
      const blackImg = 'https://jakameneg.b-cdn.net/wp-content/uploads/2026/08/SK44KL01M001-Black-001-1-scaled-600x900.jpg';
      const validPage = 'https://jakameneg.com/product/jakamen-mens-classic-fit-shirt-white/';

      expect(verifyProductImageUrl(blackImg, whiteShirtItem, validPage)).toBeNull();
    });

    it('verifyLiveUrlStatus accepts HTTP 200 and rejects 404 or soft 404', async () => {
      const liveUrl = 'https://tamsshoemaker.com/products/tams-classic-college';
      const deadUrl = 'https://dstoreegypt.com/products/expired-shirt';
      const soft404Url = 'https://store.example.com/item';

      // 1. Success 200
      globalThis.fetch = jest.fn().mockResolvedValueOnce({
        status: 200,
        url: liveUrl,
      });
      expect(await verifyLiveUrlStatus(liveUrl)).toBe(liveUrl);

      // 2. Dead 404
      globalThis.fetch = jest.fn().mockResolvedValueOnce({
        status: 404,
        url: deadUrl,
      });
      expect(await verifyLiveUrlStatus(deadUrl)).toBeNull();

      // 3. Soft 404 redirect
      globalThis.fetch = jest.fn().mockResolvedValueOnce({
        status: 200,
        url: 'https://store.example.com/404-not-found',
      });
      expect(await verifyLiveUrlStatus(soft404Url)).toBeNull();
    });

    it('verifyLiveImageUrl accepts 200 image and rejects 404 or HTML response', async () => {
      const validImg = 'https://cdn.example.com/shirt.jpg';

      // 1. Valid image
      globalThis.fetch = jest.fn().mockResolvedValueOnce({
        status: 200,
        headers: { get: () => 'image/jpeg' },
      });
      expect(await verifyLiveImageUrl(validImg)).toBe(validImg);

      // 2. 404 image
      globalThis.fetch = jest.fn().mockResolvedValueOnce({
        status: 404,
        headers: { get: () => 'text/html' },
      });
      expect(await verifyLiveImageUrl(validImg)).toBeNull();

      // 3. HTML error page with 200 status
      globalThis.fetch = jest.fn().mockResolvedValueOnce({
        status: 200,
        headers: { get: () => 'text/html; charset=utf-8' },
      });
      expect(await verifyLiveImageUrl(validImg)).toBeNull();
    });
  });
});
