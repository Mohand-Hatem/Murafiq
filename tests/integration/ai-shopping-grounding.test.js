/**
 * Integration Test: Production Google Shopping Grounding & Anti-Fabrication Pipeline
 *
 * Verifies:
 * 1. Arabic anchor scenario ("عايز اشترى حاجه تليق مغ البلوفر ده") with beige quarter-zip sweater:
 *    - Strictly excludes sweaters/tops from shopping recommendations.
 *    - Recommends complementary slots (bottom, shoes) across diverse trusted Egyptian retailers.
 *    - Associates Google Search Grounding chunks by semantic & support mapping, not positional index.
 *    - HTTP verification extracts real product metadata, CDN images, and prices.
 *    - Populates real sourceUrl, real imageUrl, retailer searchUrl, and citations.
 * 2. Strict Grounding Determinism & Anti-Fabrication:
 *    - Rejects homepages, category pages, search results, and stock photos (Unsplash/Pexels).
 *    - Items without verified deep product page and verified image are NOT marked as grounded.
 * 3. End-to-End Orchestrator Pipeline Execution:
 *    - Preserves Arabic localized responses, outfit grouping, and telemetry metrics.
 * 4. Fail-Closed Grounding Policy:
 *    - When search fails, pipeline fails closed without fabricating fake products.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import '../../src/common/globals.js';
import {
  searchExternalProducts,
  clearInMemoryProductCache,
  setProductSearchRedisOverride,
} from '../../src/modules/ai/products/product-search.service.js';
import {
  setHttpFetchOverride,
  resetHttpFetchOverride,
} from '../../src/modules/ai/products/product-page-verifier.js';
import { setGenAiClient } from '../../src/modules/ai/providers/llm.provider.js';
import { runStylistPipeline } from '../../src/modules/ai/stylist/stylist.orchestrator.js';
import entitlementService from '../../src/modules/subscriptions/entitlement.service.js';
import wardrobeService from '../../src/modules/wardrobe/wardrobe.service.js';
import stylePreferenceService from '../../src/modules/ai/preferences/style-preference.service.js';
import outfitService from '../../src/modules/ai/outfits/outfit.service.js';
import knowledgeService from '../../src/modules/ai/knowledge/knowledge.service.js';
import scopeGuard from '../../src/modules/ai/stylist/scope.guard.js';
import intentStep from '../../src/modules/ai/stylist/intent.step.js';
import composeStep from '../../src/modules/ai/stylist/compose.step.js';

describe('Integration — Production Google Shopping Grounding & Anti-Fabrication Pipeline', () => {
  const userId = 'user_shopping_grounding_eval_01';
  let mockGenerateContent;

  const anchorGarment = {
    category: 'outerwear',
    subcategory: 'quarter_zip_sweater',
    colorFamily: 'beige',
    formality: 'smart_casual',
    material: 'knitwear',
    pattern: 'solid',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    clearInMemoryProductCache();
    setProductSearchRedisOverride(null, () => false); // use in-memory cache for tests
    resetHttpFetchOverride();
    scopeGuard.resetInMemoryRefusalStore();

    mockGenerateContent = jest.fn();
    setGenAiClient({
      models: {
        generateContent: mockGenerateContent,
      },
    });
  });

  afterEach(() => {
    resetHttpFetchOverride();
    setGenAiClient(null);
    jest.restoreAllMocks();
  });

  describe('1. Arabic Anchor Scenario ("عايز اشترى حاجه تليق مغ البلوفر ده")', () => {
    it('recommends complementary slots (bottom, shoes) across diverse retailers with verified deep links and images', async () => {
      // Mock HTTP fetch for product page verification
      setHttpFetchOverride(async (url) => {
        if (url.includes('massimodutti.com/eg/en/chino-trousers-c0p98765.html')) {
          return {
            status: 200,
            ok: true,
            url,
            headers: { get: (h) => (h === 'content-type' ? 'text/html; charset=utf-8' : null) },
            text: async () => `
              <!DOCTYPE html>
              <html>
              <head>
                <script type="application/ld+json">
                {
                  "@context": "https://schema.org",
                  "@type": "Product",
                  "name": "Navy Slim Chino Trousers",
                  "image": "https://static.massimodutti.net/assets/chinos-navy-c0p98765-front.jpg",
                  "sku": "c0p98765",
                  "offers": {
                    "@type": "Offer",
                    "price": "3490",
                    "priceCurrency": "EGP",
                    "availability": "https://schema.org/InStock"
                  }
                }
                </script>
              </head>
              <body></body>
              </html>
            `,
          };
        }

        if (url.includes('jumia.com.eg/mr-joe-formal-leather-oxford-shoes-black-8794031.html')) {
          return {
            status: 200,
            ok: true,
            url,
            headers: { get: (h) => (h === 'content-type' ? 'text/html; charset=utf-8' : null) },
            text: async () => `
              <!DOCTYPE html>
              <html>
              <head>
                <script type="application/ld+json">
                {
                  "@context": "https://schema.org",
                  "@type": "Product",
                  "name": "Mr Joe Formal Leather Oxford Shoes - Black",
                  "image": "https://eg.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/87/94031/1.jpg",
                  "sku": "8794031",
                  "offers": {
                    "@type": "Offer",
                    "price": "1450",
                    "priceCurrency": "EGP"
                  }
                }
                </script>
              </head>
              <body></body>
              </html>
            `,
          };
        }

        return {
          status: 404,
          ok: false,
          url,
          headers: { get: () => null },
          text: async () => '',
        };
      });

      // Mock Gemini generateContent returning Arabic shopping suggestions with Google Grounding metadata
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: [
            {
              slot: 'bottom',
              itemType: 'chinos',
              title: 'بنطلون شينو كحلي سليم فيت',
              retailer: 'Massimo Dutti',
              description: 'بنطلون كحلي أنيق يبرز دفء لون البلوفر البيج في إطلالة سمارت كاجوال راقية.',
              estimatedPriceEgp: 3490,
              sourceUrl: 'https://www.massimodutti.com/eg/en/chino-trousers-c0p98765.html',
              imageUrl: 'https://static.massimodutti.net/assets/chinos-navy-c0p98765-front.jpg',
              outfitIndex: 1,
              outfitTitle: 'الإطلالة الذكية (سمارت كاجوال)',
            },
            {
              slot: 'shoes',
              itemType: 'oxfords',
              title: 'حذاء أكسفورد جلد طبيعي أسود',
              retailer: 'Jumia Egypt',
              description: 'حذاء كلاسيكي أنيق من الجلد الطبيعي يكمل تنسيق الشينو مع البلوفر.',
              estimatedPriceEgp: 1450,
              sourceUrl: 'https://www.jumia.com.eg/mr-joe-formal-leather-oxford-shoes-black-8794031.html',
              imageUrl: 'https://eg.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/87/94031/1.jpg',
              outfitIndex: 1,
              outfitTitle: 'الإطلالة الذكية (سمارت كاجوال)',
            },
          ],
        }),
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    uri: 'https://www.massimodutti.com/eg/en/chino-trousers-c0p98765.html',
                    title: 'Massimo Dutti Egypt | Chino Trousers',
                  },
                },
                {
                  web: {
                    uri: 'https://www.jumia.com.eg/mr-joe-formal-leather-oxford-shoes-black-8794031.html',
                    title: 'Mr Joe Oxford Shoes | Jumia Egypt',
                  },
                },
              ],
              groundingSupports: [
                {
                  segment: { text: 'بنطلون شينو كحلي سليم فيت' },
                  groundingChunkIndices: [0],
                },
                {
                  segment: { text: 'حذاء أكسفورد جلد طبيعي أسود' },
                  groundingChunkIndices: [1],
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 90 },
      });

      const results = await searchExternalProducts({
        gapDescription: 'عايز اشترى حاجه تليق مغ البلوفر ده',
        gapItems: [
          { slot: 'bottom', description: 'Navy chinos' },
          { slot: 'shoes', description: 'Leather shoes' },
        ],
        occasion: 'smart_casual',
        formality: 'smart_casual',
        season: 'winter',
        genderPresentation: 'masculine',
        locale: 'ar',
        isShoppingRequest: true,
        anchor: anchorGarment,
      });

      expect(results).toHaveLength(2);

      // 1. Strict Anchor Exclusion: No sweaters, tops, or pullovers
      const categories = results.map((r) => r.slot);
      expect(categories).not.toContain('top');
      expect(categories).not.toContain('outerwear');
      expect(categories).toContain('bottom');
      expect(categories).toContain('shoes');

      // 2. Chinos (Massimo Dutti) Verification
      const chinos = results.find((r) => r.slot === 'bottom');
      expect(chinos).toBeDefined();
      expect(chinos.retailer).toBe('Massimo Dutti');
      expect(chinos.isGrounded).toBe(true);
      expect(chinos.sourceUrl).toBe('https://www.massimodutti.com/eg/en/chino-trousers-c0p98765.html');
      expect(chinos.imageUrl).toBe('https://static.massimodutti.net/assets/chinos-navy-c0p98765-front.jpg');
      expect(chinos.searchUrl).toContain('massimodutti.com');
      expect(chinos.estimatedPriceEgp).toBe(3490);
      expect(chinos.citations).toHaveLength(1);
      expect(chinos.citations[0].url).toBe('https://www.massimodutti.com/eg/en/chino-trousers-c0p98765.html');

      // 3. Oxford Shoes (Jumia Egypt) Verification
      const shoes = results.find((r) => r.slot === 'shoes');
      expect(shoes).toBeDefined();
      expect(shoes.retailer).toBe('Jumia Egypt');
      expect(shoes.isGrounded).toBe(true);
      expect(shoes.sourceUrl).toBe('https://www.jumia.com.eg/mr-joe-formal-leather-oxford-shoes-black-8794031.html');
      expect(shoes.imageUrl).toBe('https://eg.jumia.is/unsafe/fit-in/500x500/filters:fill(white)/product/87/94031/1.jpg');
      expect(shoes.searchUrl).toContain('jumia.com.eg');
      expect(shoes.estimatedPriceEgp).toBe(1450);
      expect(shoes.citations).toHaveLength(1);
      expect(shoes.citations[0].url).toBe('https://www.jumia.com.eg/mr-joe-formal-leather-oxford-shoes-black-8794031.html');
    });
  });

  describe('2. Grounding Association & Anti-Positional Accuracy', () => {
    it('correctly associates suggestions with citations when chunk order is reversed relative to suggestions', async () => {
      setHttpFetchOverride(async (url) => ({
        status: 200,
        ok: true,
        url,
        headers: { get: () => 'text/html' },
        text: async () => `
          <html><head><script type="application/ld+json">
          {"@context":"https://schema.org","@type":"Product","name":"Item","image":"https://static.zara.net/img/p1.jpg"}
          </script></head></html>
        `,
      }));

      // Suggestion 0 is Zara, Suggestion 1 is Jumia.
      // But Grounding chunks are Chunk 0 = Jumia, Chunk 1 = Zara.
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: [
            {
              slot: 'bottom',
              itemType: 'trousers',
              title: 'Zara Pleated Trousers',
              retailer: 'Zara Egypt',
              sourceUrl: 'https://www.zara.com/eg/en/pleated-trousers-p0123.html',
              imageUrl: 'https://static.zara.net/img/p1.jpg',
            },
            {
              slot: 'shoes',
              itemType: 'sneakers',
              title: 'Jumia Classic Sneakers',
              retailer: 'Jumia Egypt',
              sourceUrl: 'https://www.jumia.com.eg/classic-sneakers-999.html',
              imageUrl: 'https://eg.jumia.is/img/s1.jpg',
            },
          ],
        }),
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    uri: 'https://www.jumia.com.eg/classic-sneakers-999.html',
                    title: 'Jumia Sneakers Product Page',
                  },
                },
                {
                  web: {
                    uri: 'https://www.zara.com/eg/en/pleated-trousers-p0123.html',
                    title: 'Zara Pleated Trousers Page',
                  },
                },
              ],
              groundingSupports: [
                {
                  segment: { text: 'Zara Pleated Trousers' },
                  groundingChunkIndices: [1], // Index 1 is Zara
                },
                {
                  segment: { text: 'Jumia Classic Sneakers' },
                  groundingChunkIndices: [0], // Index 0 is Jumia
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 60 },
      });

      const results = await searchExternalProducts({
        gapDescription: 'pleated trousers and sneakers',
        locale: 'en',
      });

      expect(results).toHaveLength(2);

      // Zara suggestion must be linked to chunk 1 (Zara), not chunk 0 (Jumia)
      expect(results[0].retailer).toBe('Zara Egypt');
      expect(results[0].citations[0].url).toBe('https://www.zara.com/eg/en/pleated-trousers-p0123.html');

      // Jumia suggestion must be linked to chunk 0 (Jumia), not chunk 1 (Zara)
      expect(results[1].retailer).toBe('Jumia Egypt');
      expect(results[1].citations[0].url).toBe('https://www.jumia.com.eg/classic-sneakers-999.html');
    });
  });

  describe('3. Anti-Fabrication & Strict Grounding Determinism', () => {
    it('rejects category URLs, homepages, and stock images, setting isGrounded=false and stripping fake URLs', async () => {
      // Suggestion with category page and Unsplash stock photo
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: [
            {
              slot: 'bottom',
              itemType: 'jeans',
              title: 'Denim Jeans',
              retailer: 'Zara Egypt',
              sourceUrl: 'https://www.zara.com/eg/en/man/jeans-c123.html', // Category page!
              imageUrl: 'https://images.unsplash.com/photo-jeans-123.jpg', // Unsplash!
            },
          ],
        }),
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [],
              groundingSupports: [],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 40 },
      });

      const results = await searchExternalProducts({
        gapDescription: 'blue denim jeans',
        locale: 'en',
      });

      expect(results).toHaveLength(1);
      const item = results[0];

      // Must NOT be grounded
      expect(item.isGrounded).toBe(false);
      // Category URL must be stripped
      expect(item.sourceUrl).toBeNull();
      // Stock image must be stripped
      expect(item.imageUrl).toBeNull();
      // Retailer searchUrl must still provide a valid fallback destination
      expect(item.searchUrl).toContain('zara.com/eg/');
      expect(item.searchUrl).toContain('search?searchTerm=');
    });
  });

  describe('4. End-to-End Orchestrator Shopping Flow', () => {
    it('executes the full stylist pipeline for the Arabic anchor request and yields grounded suggestions', async () => {
      // Setup orchestrator dependencies mocks
      jest.spyOn(entitlementService, 'consume').mockResolvedValue({ success: true });
      jest.spyOn(entitlementService, 'consumeMessageQuota').mockResolvedValue({ success: true, quotaSource: 'daily' });
      jest.spyOn(entitlementService, 'checkQuota').mockResolvedValue({ allowed: true, remaining: 5 });
      jest.spyOn(wardrobeService, 'getWardrobeCandidates').mockResolvedValue({
        top: [],
        bottom: [],
        shoes: [],
      });
      jest.spyOn(stylePreferenceService, 'getPreferences').mockResolvedValue({ favoriteColors: [] });
      jest.spyOn(wardrobeService, 'getWardrobeItemsByIds').mockResolvedValue([]);
      jest.spyOn(outfitService, 'recordOutfit').mockResolvedValue({ _id: 'persisted_outfit_shopping' });
      jest.spyOn(knowledgeService, 'searchFashionKnowledge').mockResolvedValue([]);

      // Mock intent & compose steps to flow directly to product search step
      jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
        inDomain: true,
        refusalCategory: null,
        language: 'ar',
        eventType: 'smart_casual',
        occasion: 'smart casual daily',
        retrievalQueryEn: 'beige quarter-zip sweater outfit with navy chinos and brown shoes',
        confidence: 0.95,
        isShoppingRequest: true,
        anchor: anchorGarment,
        usage: { inputTokens: 50, outputTokens: 25 },
        latencyMs: 100,
      });

      jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValueOnce({
        outfits: [],
        sufficiency: 'empty',
        missingSlots: ['bottom', 'shoes'],
        gapDescriptions: ['Navy smart chinos', 'Brown leather shoes'],
        usage: { inputTokens: 100, outputTokens: 40 },
      });

      // Mock HTML verifier for deep link
      setHttpFetchOverride(async (url) => ({
        status: 200,
        ok: true,
        url,
        headers: { get: () => 'text/html' },
        text: async () => `
          <html><head><script type="application/ld+json">
          {"@context":"https://schema.org","@type":"Product","name":"MD Navy Chinos","image":"https://static.massimodutti.net/img/chinos.jpg"}
          </script></head></html>
        `,
      }));

      // Mock search LLM via mockGenerateContent
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: [
            {
              slot: 'bottom',
              itemType: 'chinos',
              title: 'بنطلون شينو كحلي راقي',
              retailer: 'Massimo Dutti',
              description: 'شينو كحلي من القطن الفاخر يكمل أناقة البلوفر البيج.',
              estimatedPriceEgp: 3490,
              sourceUrl: 'https://www.massimodutti.com/eg/en/navy-chinos-c0p123.html',
              imageUrl: 'https://static.massimodutti.net/img/chinos.jpg',
              outfitIndex: 1,
              outfitTitle: 'الإطلالة الأولى',
            },
          ],
        }),
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    uri: 'https://www.massimodutti.com/eg/en/navy-chinos-c0p123.html',
                    title: 'Massimo Dutti Navy Chinos',
                  },
                },
              ],
              groundingSupports: [
                {
                  segment: { text: 'بنطلون شينو كحلي راقي' },
                  groundingChunkIndices: [0],
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      });

      const response = await runStylistPipeline({
        userId,
        message: 'عايز اشترى حاجه تليق مغ البلوفر ده',
      });

      expect(response).toBeDefined();
      expect(response.suggestedToAcquire).toHaveLength(1);

      const acquiredItem = response.suggestedToAcquire[0];
      expect(acquiredItem.slot).toBe('bottom');
      expect(acquiredItem.retailer).toBe('Massimo Dutti');
      expect(acquiredItem.sourceUrl).toBe('https://www.massimodutti.com/eg/en/navy-chinos-c0p123.html');
      expect(acquiredItem.imageUrl).toBe('https://static.massimodutti.net/img/chinos.jpg');
      expect(acquiredItem.searchUrl).toContain('massimodutti.com');
      expect(acquiredItem.isGrounded).toBe(true);
      expect(acquiredItem.citations).toHaveLength(1);
    });
  });

  describe('5. Fail-Closed Grounding Policy', () => {
    it('returns empty array without fabricating fake products when live grounded search fails', async () => {
      mockGenerateContent.mockRejectedValueOnce(
        new Error('INVALID_ARGUMENT: Live search tool failed')
      );

      const results = await searchExternalProducts({
        gapDescription: 'navy formal blazer',
        locale: 'en',
      });

      // Strict Section 20 policy: fails closed, returns empty array, zero fake products
      expect(results).toEqual([]);
    });
  });

  describe('6. Retailer Priority Order (Noon, Amazon, Jumia) & Bot Protection Resilience', () => {
    it('instructs model with Noon -> Amazon -> Jumia priority and preserves sourceUrl when live scraper is blocked by bot protection', async () => {
      // Mock HTTP fetch to simulate Cloudflare/Amazon bot challenge (403/503)
      setHttpFetchOverride(async () => ({
        status: 403,
        ok: false,
        url: 'https://www.noon.com/egypt-en/casual-chinos/N53345678A/p/',
        headers: { get: () => 'text/html' },
        text: async () => '<html><body>Cloudflare bot challenge</body></html>',
      }));

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          suggestions: [
            {
              slot: 'bottom',
              itemType: 'chinos',
              title: 'Noon Egypt Slim Chinos',
              retailer: 'Noon Egypt',
              description: 'Dark navy chinos from Noon Egypt.',
              estimatedPriceEgp: 899,
              sourceUrl: 'https://www.noon.com/egypt-en/casual-chinos/N53345678A/p/',
              imageUrl: 'https://f.nooncdn.com/products/tr:n-t_400/chinos.jpg',
            },
          ],
        }),
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    uri: 'https://www.noon.com/egypt-en/casual-chinos/N53345678A/p/',
                    title: 'Noon Egypt Casual Chinos',
                  },
                },
              ],
              groundingSupports: [
                {
                  segment: { text: 'Noon Egypt Slim Chinos' },
                  groundingChunkIndices: [0],
                },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      });

      const results = await searchExternalProducts({
        gapDescription: 'navy chinos',
        locale: 'en',
      });

      // System instruction must specify the mandatory priority order: Noon -> Amazon -> Jumia
      const sentConfig = mockGenerateContent.mock.calls[0][0].config;
      expect(sentConfig.systemInstruction).toContain('MANDATORY RETAILER SEARCH PRIORITY (EGYPT)');
      expect(sentConfig.systemInstruction).toContain('1. Noon Egypt (noon.com)');
      expect(sentConfig.systemInstruction).toContain('2. Amazon Egypt (amazon.eg)');
      expect(sentConfig.systemInstruction).toContain('3. Jumia Egypt (jumia.com.eg)');

      expect(results).toHaveLength(1);
      const item = results[0];
      expect(item.retailer).toBe('Noon Egypt');
      // Must NOT be null even though fetch was challenged with 403 bot check!
      expect(item.sourceUrl).toBe('https://www.noon.com/egypt-en/casual-chinos/N53345678A/p/');
      expect(item.isGrounded).toBe(true);
      expect(item.searchUrl).toContain('noon.com/egypt-ar/search/?q=');
      expect(item.citations).toHaveLength(1);
    });
  });
});
