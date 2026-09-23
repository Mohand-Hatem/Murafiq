import { jest } from '@jest/globals';
import '../../../src/common/globals.js';
import {
  IN_DOMAIN_CASES,
  OUT_OF_DOMAIN_CASES,
  INJECTION_CASES,
  INVARIANT_CASES,
  IMAGE_INPUT_CASES,
  FASHION_KNOWLEDGE_CASES,
  PRODUCT_SEARCH_CASES,
} from './golden-dataset.js';
import { runStylistPipeline } from '../../../src/modules/ai/stylist/stylist.orchestrator.js';
import entitlementService from '../../../src/modules/subscriptions/entitlement.service.js';
import scopeGuard from '../../../src/modules/ai/stylist/scope.guard.js';
import intentStep from '../../../src/modules/ai/stylist/intent.step.js';
import composeStep from '../../../src/modules/ai/stylist/compose.step.js';
import wardrobeService from '../../../src/modules/wardrobe/wardrobe.service.js';
import stylePreferenceService from '../../../src/modules/ai/preferences/style-preference.service.js';
import outfitService from '../../../src/modules/ai/outfits/outfit.service.js';
import knowledgeService, {
  setKnowledgeRedisOverride,
  clearInMemoryCache,
} from '../../../src/modules/ai/knowledge/knowledge.service.js';
import productSearchService from '../../../src/modules/ai/products/product-search.service.js';
import vectorConfig from '../../../src/config/vector.config.js';
import { logger } from '../../../src/config/logger.config.js';

describe('Golden-Set Evaluation Harness — AI Stylist Pipeline (Flow A & Scope Guard)', () => {
  const evalUserId = 'eval_client_user_001';

  const mockWardrobeCandidates = {
    top: [
      { _id: 'item_top_1', name: 'White Dress Shirt', category: 'top', formality: 'formal' },
      { _id: 'item_top_2', name: 'Navy Linen Shirt', category: 'top', formality: 'smart_casual' },
    ],
    bottom: [
      { _id: 'item_bottom_1', name: 'Navy Trousers', category: 'bottom', formality: 'formal' },
      { _id: 'item_bottom_2', name: 'Beige Chinos', category: 'bottom', formality: 'casual' },
    ],
    shoes: [
      { _id: 'item_shoes_1', name: 'Black Oxford Shoes', category: 'shoes', formality: 'formal' },
      { _id: 'item_shoes_2', name: 'White Minimalist Sneakers', category: 'shoes', formality: 'casual' },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    scopeGuard.resetInMemoryRefusalStore();

    // Default mocks for standard flow
    jest.spyOn(entitlementService, 'consume').mockResolvedValue({ success: true });
    jest.spyOn(entitlementService, 'refundQuota').mockResolvedValue();
    jest.spyOn(entitlementService, 'checkQuota').mockResolvedValue({ allowed: false, remaining: 0, planCode: 'client.free' });
    jest.spyOn(knowledgeService, 'searchFashionKnowledge').mockResolvedValue([]);
    jest.spyOn(productSearchService, 'searchExternalProducts').mockResolvedValue([]);
    jest.spyOn(wardrobeService, 'getWardrobeCandidates').mockResolvedValue(mockWardrobeCandidates);
    jest.spyOn(stylePreferenceService, 'getPreferences').mockResolvedValue({ favoriteColors: [] });
    jest.spyOn(wardrobeService, 'getWardrobeItemsByIds').mockResolvedValue([
      { _id: 'item_top_1', name: 'White Dress Shirt', category: 'top', imageUrl: 'https://cdn/top1.jpg', primaryColor: 'White' },
      { _id: 'item_bottom_1', name: 'Navy Trousers', category: 'bottom', imageUrl: 'https://cdn/bot1.jpg', primaryColor: 'Navy' },
      { _id: 'item_shoes_1', name: 'Black Oxford Shoes', category: 'shoes', imageUrl: 'https://cdn/shoe1.jpg', primaryColor: 'Black' },
    ]);
    jest.spyOn(outfitService, 'recordOutfit').mockResolvedValue({ _id: 'persisted_outfit_eval_1' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('1. In-Domain Styling Queries (Must NEVER be refused)', () => {
    it.each(IN_DOMAIN_CASES)(
      'evaluates in-domain case: [$id] ($language) "$message"',
      async (testCase) => {
        jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
          inDomain: true,
          refusalCategory: null,
          language: testCase.language,
          eventType: testCase.expectedEventType,
          retrievalQueryEn: 'formal occasion attire',
          confidence: 0.95,
          usage: { inputTokens: 50, outputTokens: 25 },
          latencyMs: 120,
        });

        jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValueOnce({
          outfits: [
            {
              itemIds: ['item_top_1', 'item_bottom_1', 'item_shoes_1'],
              rationale: testCase.language === 'ar' ? 'إطلالة أنيقة للمناسبة' : 'Elegant occasion outfit',
              score: 92,
            },
          ],
          sufficiency: 'good',
          missingSlots: [],
          usage: { inputTokens: 120, outputTokens: 40 },
          latencyMs: 220,
        });

        const result = await runStylistPipeline({
          userId: evalUserId,
          message: testCase.message,
        });

        expect(result.refused).toBeUndefined();
        expect(result.sufficiency).toBe('good');
        expect(result.outfits).toHaveLength(1);
        expect(result.outfits[0].fromYourWardrobe).toHaveLength(3);
        expect(result.language).toBe(testCase.language);
      }
    );
  });

  describe('2. Out-of-Domain Queries (Must REFUSE at Layer 1b with 0 downstream calls)', () => {
    it.each(OUT_OF_DOMAIN_CASES)(
      'evaluates out-of-domain refusal: [$id] ($language) "$message"',
      async (testCase) => {
        jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
          inDomain: false,
          refusalCategory: testCase.expectedRefusalCategory,
          language: testCase.language,
          eventType: null,
          retrievalQueryEn: '',
          confidence: 1.0,
          usage: { inputTokens: 30, outputTokens: 10 },
          latencyMs: 80,
        });

        const wardrobeSpy = jest.spyOn(wardrobeService, 'getWardrobeCandidates');
        const composeSpy = jest.spyOn(composeStep, 'composeAndRankOutfits');
        const refundSpy = jest.spyOn(entitlementService, 'refundQuota');

        const result = await runStylistPipeline({
          userId: evalUserId,
          message: testCase.message,
        });

        // 1. Refusal verified
        expect(result.refused).toBe(true);
        expect(result.refusalCategory).toBe(testCase.expectedRefusalCategory);
        expect(result.language).toBe(testCase.language);
        expect(result.message).toBeDefined();

        // 2. Localized refusal copy verified
        if (testCase.language === 'ar') {
          expect(result.message).toContain('مٌرافق');
        } else {
          expect(result.message).toContain('Murafiq');
        }

        // 3. ZERO downstream calls guaranteed
        expect(wardrobeSpy).not.toHaveBeenCalled();
        expect(composeSpy).not.toHaveBeenCalled();

        // 4. Message quota refunded
        expect(refundSpy).toHaveBeenCalledWith(evalUserId, 'ai.messages.lifetime', 1);
      }
    );
  });

  describe('3. Adversarial / Prompt Injection Defense', () => {
    it.each(INJECTION_CASES)(
      'evaluates injection defense: [$id] "$message"',
      async (testCase) => {
        jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
          inDomain: false,
          refusalCategory: testCase.expectedRefusalCategory,
          language: testCase.language,
          eventType: null,
          retrievalQueryEn: '',
          confidence: 1.0,
          usage: { inputTokens: 40, outputTokens: 10 },
          latencyMs: 90,
        });

        const composeSpy = jest.spyOn(composeStep, 'composeAndRankOutfits');

        const result = await runStylistPipeline({
          userId: evalUserId,
          message: testCase.message,
        });

        expect(result.refused).toBe(true);
        expect(result.refusalCategory).toBe('other_domain');
        expect(composeSpy).not.toHaveBeenCalled();
      }
    );
  });

  describe('4. Structural Invariants & Edge Cases', () => {
    it('Pre-flight empty wardrobe bypass: client with 0 items gets insufficiency with 0 composition calls', async () => {
      const { EMPTY_WARDROBE } = INVARIANT_CASES;

      jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
        inDomain: true,
        language: 'en',
        eventType: 'wedding_formal',
        retrievalQueryEn: 'formal wedding attire',
      });

      jest.spyOn(wardrobeService, 'getWardrobeCandidates').mockResolvedValueOnce({
        top: [],
        bottom: [],
        shoes: [],
      });

      const composeSpy = jest.spyOn(composeStep, 'composeAndRankOutfits');

      const result = await runStylistPipeline({
        userId: evalUserId,
        message: EMPTY_WARDROBE.message,
      });

      expect(composeSpy).not.toHaveBeenCalled();
      expect(result.sufficiency).toBe('none');
      expect(result.suggestBookStylist).toBe(true);
      expect(result.outfits).toHaveLength(0);
      expect(result.missingSlots).toEqual(expect.arrayContaining(['top', 'bottom', 'shoes']));
    });

    it('Pre-flight missing slot bypass: client missing shoes gets insufficiency with 0 composition calls', async () => {
      const { MISSING_SHOES } = INVARIANT_CASES;

      jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
        inDomain: true,
        language: 'en',
        eventType: 'interview',
        retrievalQueryEn: 'formal business suit',
      });

      jest.spyOn(wardrobeService, 'getWardrobeCandidates').mockResolvedValueOnce({
        top: [{ _id: 'top_1' }],
        bottom: [{ _id: 'bottom_1' }],
        shoes: [],
      });

      const composeSpy = jest.spyOn(composeStep, 'composeAndRankOutfits');

      const result = await runStylistPipeline({
        userId: evalUserId,
        message: MISSING_SHOES.message,
      });

      expect(composeSpy).not.toHaveBeenCalled();
      expect(result.sufficiency).toBe('none');
      expect(result.missingSlots).toContain('shoes');
      expect(result.suggestedToAcquire.some((s) => s.slot === 'shoes')).toBe(true);
    });

    it('Anti-Hallucination Gate: forged candidate ID causes retry then fail-closed', async () => {
      const { HALLUCINATED_ID } = INVARIANT_CASES;

      jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
        inDomain: true,
        language: 'en',
        eventType: 'wedding_formal',
      });

      // Composition returns forged candidate ID on both attempts
      jest.spyOn(composeStep, 'composeAndRankOutfits')
        .mockResolvedValueOnce({
          outfits: [{ itemIds: ['item_top_1', HALLUCINATED_ID.forgedIdInjected] }],
          sufficiency: 'good',
          missingSlots: [],
        })
        .mockResolvedValueOnce({
          outfits: [{ itemIds: ['item_top_1', HALLUCINATED_ID.forgedIdInjected] }],
          sufficiency: 'good',
          missingSlots: [],
        });

      await expect(
        runStylistPipeline({
          userId: evalUserId,
          message: HALLUCINATED_ID.message,
        })
      ).rejects.toThrow(ApiError);
    });

    it('Refusal abuse limiter: 6th refusal within 1 hour blocks before model call', async () => {
      // Record 5 refusals for user
      for (let i = 0; i < 5; i++) {
        await scopeGuard.recordScopeRefusal(evalUserId);
      }

      const intentSpy = jest.spyOn(intentStep, 'classifyAndExtract');

      const result = await runStylistPipeline({
        userId: evalUserId,
        message: 'another off domain query',
      });

      expect(result.refused).toBe(true);
      expect(result.refusalCategory).toBe('rate_limited');
      expect(result.message).toContain('limit of out-of-domain requests');
      expect(intentSpy).not.toHaveBeenCalled();
    });

    it('Multi-tenant isolation: requests never query or surface other clients items', async () => {
      const userA = 'client_user_A';
      const userB = 'client_user_B';

      const candidateSpy = jest.spyOn(wardrobeService, 'getWardrobeCandidates');

      jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
        inDomain: true,
        language: 'en',
        eventType: 'wedding_formal',
      });

      jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValueOnce({
        outfits: [{ itemIds: ['item_top_1', 'item_bottom_1', 'item_shoes_1'] }],
        sufficiency: 'good',
        missingSlots: [],
      });

      await runStylistPipeline({
        userId: userA,
        message: 'wedding outfit',
      });

      expect(candidateSpy).toHaveBeenCalledWith(
        userA,
        expect.anything()
      );
      expect(candidateSpy).not.toHaveBeenCalledWith(
        userB,
        expect.anything()
      );
    });

    it('Egyptian PDPL Privacy compliance: trace logs contain no raw messages or Cloudinary URLs', async () => {
      const loggerInfoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});

      jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
        inDomain: true,
        language: 'en',
        eventType: 'wedding_formal',
        usage: { inputTokens: 50, outputTokens: 20 },
      });

      jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValueOnce({
        outfits: [{ itemIds: ['item_top_1', 'item_bottom_1', 'item_shoes_1'] }],
        sufficiency: 'good',
        missingSlots: [],
        usage: { inputTokens: 100, outputTokens: 30 },
      });

      const privatePrompt = 'Going with my sister Laila to an engagement party';

      await runStylistPipeline({
        userId: evalUserId,
        message: privatePrompt,
      });

      const allLogCalls = loggerInfoSpy.mock.calls.map((c) => String(c[0])).join('\n');

      expect(allLogCalls).not.toContain('Laila');
      expect(allLogCalls).not.toContain('Going with my sister');
      expect(allLogCalls).not.toContain('cloudinary.com');
    });
  });

  describe('5. Multimodal & Direct Image Input Golden Cases (Phase 15C)', () => {
    it.each(IMAGE_INPUT_CASES)(
      'evaluates image case: [$id] ($message)',
      async ({
        message,
        imageRef,
        imageData,
        expectedIsGarment,
        expectedCategory,
        expectedPattern,
        expectedInDomain,
        expectedRefusalCategory,
        printedText,
      }) => {
        if (!expectedInDomain) {
          jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
            inDomain: false,
            refusalCategory: expectedRefusalCategory,
            imageIsGarment: expectedIsGarment,
            language: 'en',
          });

          const res = await runStylistPipeline({
            userId: evalUserId,
            message,
            imageRef,
            options: { imageData },
          });

          expect(res.refused).toBe(true);
          expect(res.refusalCategory).toBe(expectedRefusalCategory);
        } else {
          jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
            inDomain: true,
            refusalCategory: null,
            imageIsGarment: expectedIsGarment,
            garmentAnalysis: {
              category: expectedCategory,
              pattern: expectedPattern || 'solid',
              printedText: printedText || null,
              confidence: 0.95,
            },
            language: 'en',
          });

          jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValueOnce({
            outfits: [
              {
                itemIds: ['anchor_item', 'item_bottom_1', 'item_shoes_1'],
                rationale: 'Complementary look',
                score: 88,
              },
            ],
            sufficiency: 'good',
            missingSlots: [],
          });

          const res = await runStylistPipeline({
            userId: evalUserId,
            message,
            imageRef,
            options: { imageData },
          });

          expect(res.refused).toBeUndefined();
          expect(res.canSaveToWardrobe).toBe(true);
          expect(res.anchor).toBeDefined();
          expect(res.anchor.category).toBe(expectedCategory);
        }
      }
    );
  });

  describe('10. Fashion Knowledge RAG Suite (Editorial Grounding & Scope Invariants)', () => {
    it('grounds Cairo luxury wedding with formal knowledge and passes chunks to compose step', async () => {
      const cairoCase = FASHION_KNOWLEDGE_CASES.find((c) => c.id === 'rag_formal_cairo_wedding');

      jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
        inDomain: true,
        refusalCategory: null,
        occasion: cairoCase.expectedEventType,
        formality: cairoCase.expectedFormality,
        retrievalQueryEn: cairoCase.retrievalQueryEn,
        language: cairoCase.language,
        context: { season: cairoCase.expectedSeason },
      });

      const searchSpy = jest.spyOn(knowledgeService, 'searchFashionKnowledge').mockResolvedValueOnce([
        {
          id: 'chunk_wedding_1',
          title: 'Cairo Luxury Hotel Weddings',
          body: 'Grand ballroom weddings in Cairo demand sharp, luxurious tailoring.',
        },
        {
          id: 'chunk_wedding_2',
          title: 'Black Tie and Gala Attire',
          body: 'Tuxedos with satin lapels and patent leather shoes.',
        },
      ]);

      const composeSpy = jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValueOnce({
        outfits: [
          {
            itemIds: ['item_top_1', 'item_bottom_1', 'item_shoes_1'],
            rationale: 'Classic formal black-tie tailoring suitable for luxury hotel ballrooms.',
            score: 95,
          },
        ],
        sufficiency: 'good',
        missingSlots: [],
      });

      const res = await runStylistPipeline({
        userId: evalUserId,
        message: cairoCase.message,
      });

      expect(res.refused).toBeUndefined();
      expect(searchSpy).toHaveBeenCalledWith(
        cairoCase.retrievalQueryEn,
        expect.objectContaining({
          eventType: 'wedding',
        })
      );
      expect(composeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          fashionKnowledgeChunks: expect.arrayContaining([
            expect.objectContaining({ title: 'Cairo Luxury Hotel Weddings' }),
          ]),
        })
      );
      expect(res.outfits).toHaveLength(1);
    });

    it('grounds Alexandria coastal engagement with breathable summer tailoring knowledge', async () => {
      const alexCase = FASHION_KNOWLEDGE_CASES.find((c) => c.id === 'rag_alexandria_summer_engagement');

      jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
        inDomain: true,
        refusalCategory: null,
        occasion: alexCase.expectedEventType,
        formality: alexCase.expectedFormality,
        retrievalQueryEn: alexCase.retrievalQueryEn,
        language: alexCase.language,
        context: { season: alexCase.expectedSeason },
      });

      const searchSpy = jest.spyOn(knowledgeService, 'searchFashionKnowledge').mockResolvedValueOnce([
        {
          id: 'chunk_coastal_1',
          title: 'Coastal and Resort Events',
          body: 'Breathable linen and cotton tailoring for coastal Alexandria venues.',
        },
      ]);

      const composeSpy = jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValueOnce({
        outfits: [
          {
            itemIds: ['item_top_2', 'item_bottom_2', 'item_shoes_2'],
            rationale: 'Lightweight linen shirt and chinos ideal for seaside engagement.',
            score: 92,
          },
        ],
        sufficiency: 'good',
        missingSlots: [],
      });

      const res = await runStylistPipeline({
        userId: evalUserId,
        message: alexCase.message,
      });

      expect(res.refused).toBeUndefined();
      expect(searchSpy).toHaveBeenCalledWith(
        alexCase.retrievalQueryEn,
        expect.objectContaining({
          eventType: 'engagement',
          season: 'summer',
        })
      );
      expect(composeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          fashionKnowledgeChunks: expect.arrayContaining([
            expect.objectContaining({ title: 'Coastal and Resort Events' }),
          ]),
        })
      );
    });

    it('demonstrates 24h Redis cache hit on repeated fashion knowledge search', async () => {
      knowledgeService.searchFashionKnowledge.mockRestore();
      clearInMemoryCache();

      const mockRedisStore = new Map();
      const mockRedis = {
        get: jest.fn(async (key) => mockRedisStore.get(key) || null),
        set: jest.fn(async (key, val) => {
          mockRedisStore.set(key, val);
          return 'OK';
        }),
      };

      setKnowledgeRedisOverride(mockRedis, () => true);

      jest.spyOn(vectorConfig, 'getKnowledgeVectorNamespace').mockReturnValue({
        query: jest.fn().mockResolvedValue([
          {
            id: 'chunk_1',
            metadata: {
              slug: 'dress-codes',
              title: 'Black Tie and Gala Attire',
              topic: 'dress_codes',
              body: 'A midnight blue or black tuxedo with satin lapels is non-negotiable.',
            },
            score: 0.95,
          },
        ]),
        upsert: jest.fn(),
        delete: jest.fn(),
      });

      try {
        const query = 'formal Cairo evening wedding luxury hotel ballroom tuxedo';
        const options = { eventType: 'wedding', season: 'fall', limit: 3 };

        // 1st call — cache miss, queries underlying source, sets cache
        const res1 = await knowledgeService.searchFashionKnowledge(query, options);
        expect(mockRedis.get).toHaveBeenCalledTimes(1);
        expect(mockRedis.set).toHaveBeenCalledTimes(1);

        // 2nd call with identical parameters — cache hit
        const res2 = await knowledgeService.searchFashionKnowledge(query, options);
        expect(mockRedis.get).toHaveBeenCalledTimes(2);
        // set is NOT called again on cache hit
        expect(mockRedis.set).toHaveBeenCalledTimes(1);
        expect(res1[0].cacheHit).toBe(false);
        expect(res2[0].cacheHit).toBe(true);
        expect(res2[0].title).toEqual(res1[0].title);
        expect(res2[0].body).toEqual(res1[0].body);
      } finally {
        setKnowledgeRedisOverride(null, null);
        clearInMemoryCache();
      }
    });

    it('NEVER calls fashion knowledge service when request is refused as out-of-domain', async () => {
      const oodCase = FASHION_KNOWLEDGE_CASES.find((c) => c.id === 'rag_out_of_domain_zero_kb_call');

      jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
        inDomain: false,
        refusalCategory: oodCase.expectedRefusalCategory,
        language: oodCase.language,
      });

      const searchSpy = jest.spyOn(knowledgeService, 'searchFashionKnowledge');

      const res = await runStylistPipeline({
        userId: evalUserId,
        message: oodCase.message,
      });

      expect(res.refused).toBe(true);
      expect(res.refusalCategory).toBe(oodCase.expectedRefusalCategory);
      // Invariant: zero calls to knowledge service on refusal
      expect(searchSpy).not.toHaveBeenCalled();
    });
  });

  describe('7. External Product Search & Gap Closing (Suite 11)', () => {
    it.each(PRODUCT_SEARCH_CASES)(
      'evaluates product search case: [$id] ($language) "$message"',
      async (testCase) => {
        const isFree = testCase.userTier === 'free';
        jest.spyOn(entitlementService, 'checkQuota').mockResolvedValue({
          allowed: !isFree,
          remaining: isFree ? 0 : 3,
        });

        jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
          inDomain: testCase.expectedInDomain,
          refusalCategory: null,
          language: testCase.language,
          eventType: 'formal',
          occasion: 'formal event',
          retrievalQueryEn: 'formal occasion attire',
          confidence: 0.95,
          usage: { inputTokens: 50, outputTokens: 25 },
          latencyMs: 100,
        });

        const isNone = testCase.expectedSufficiency === 'none';
        const isPartial = testCase.expectedSufficiency === 'partial';

        if (isNone) {
          jest.spyOn(wardrobeService, 'getWardrobeCandidates').mockResolvedValueOnce({
            top: [],
            bottom: [],
            shoes: [],
          });
        } else if (isPartial) {
          jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValueOnce({
            outfits: [
              { itemIds: ['item_top_1', 'item_bottom_1'], rationale: 'Partial look', score: 75 },
            ],
            sufficiency: 'partial',
            missingSlots: ['shoes', 'outerwear'],
            gapDescriptions: ['black formal shoes', 'formal blazer'],
            usage: { inputTokens: 100, outputTokens: 40 },
          });
        } else {
          jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValueOnce({
            outfits: [
              { itemIds: ['item_top_1', 'item_bottom_1', 'item_shoes_1'], rationale: 'Look 1', score: 95 },
              { itemIds: ['item_top_1', 'item_bottom_1', 'item_shoes_1'], rationale: 'Look 2', score: 90 },
            ],
            sufficiency: 'good',
            missingSlots: [],
            gapDescriptions: [],
            usage: { inputTokens: 100, outputTokens: 40 },
          });
        }

        const mockProducts = [
          {
            slot: 'shoes',
            itemType: 'black oxford shoes',
            title: 'Zara Egypt Oxfords',
            description: 'Leather dress shoes',
            estimatedPriceEgp: 2200,
            retailer: 'Zara Egypt',
            sourceUrl: 'https://zara.com/eg/shoes',
            sourceTitle: 'Zara Egypt',
            citations: [{ title: 'Zara Egypt', url: 'https://zara.com/eg/shoes' }],
            isGrounded: true,
          },
          {
            slot: 'outerwear',
            itemType: 'charcoal blazer',
            title: 'Massimo Dutti Blazer',
            description: 'Wool blend jacket',
            estimatedPriceEgp: 3500,
            retailer: 'Massimo Dutti Egypt',
            sourceUrl: 'https://massimodutti.com/eg/blazer',
            sourceTitle: 'Massimo Dutti',
            citations: [{ title: 'Massimo Dutti', url: 'https://massimodutti.com/eg/blazer' }],
            isGrounded: true,
          },
        ];

        const searchSpy = jest.spyOn(productSearchService, 'searchExternalProducts').mockResolvedValue(mockProducts);

        const res = await runStylistPipeline({
          userId: evalUserId,
          message: testCase.message,
        });

        expect(res.inDomain !== false).toBe(true);

        if (testCase.expectedGroundedSearch) {
          expect(searchSpy).toHaveBeenCalled();
          expect(res.suggestedToAcquire.length).toBeGreaterThan(0);
          expect(res.suggestedToAcquire[0].isGrounded).toBe(true);
          expect(res.suggestedToAcquire[0].citations.length).toBeGreaterThan(0);
        } else if (testCase.expectedSufficiency === 'good') {
          expect(searchSpy).not.toHaveBeenCalled();
          expect(res.suggestedToAcquire).toEqual([]);
          expect(res.suggestBookStylist).toBe(false);
        } else if (testCase.expectedFallbackShoppingList) {
          expect(searchSpy).not.toHaveBeenCalled();
          expect(res.suggestedToAcquire.length).toBeGreaterThan(0);
          expect(res.suggestedToAcquire[0].isGrounded).toBe(false);
          expect(res.suggestBookStylist).toBe(true);
        }

        // Invariant: outfits and suggestedToAcquire must NEVER be merged
        expect(res.outfits).toBeDefined();
        expect(res.suggestedToAcquire).toBeDefined();
        if (res.outfits.length > 0 && res.suggestedToAcquire.length > 0) {
          const wardrobeNames = res.outfits.flatMap((o) => o.fromYourWardrobe.map((i) => i.name));
          const externalTitles = res.suggestedToAcquire.map((p) => p.title);
          for (const wName of wardrobeNames) {
            expect(externalTitles).not.toContain(wName);
          }
        }
      }
    );
  });
});
