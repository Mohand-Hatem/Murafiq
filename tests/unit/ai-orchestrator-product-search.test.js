/**
 * Phase 15E Step 6 — Orchestrator Integration & Sequential Quota Execution Tests.
 *
 * Covers:
 * 1. Wardrobe-first invariant: wardrobe is always checked before external product search.
 * 2. Sufficient wardrobe: 0 product-search quota checked or consumed; suggestedToAcquire: [].
 * 3. Partial sufficiency + paid quota: consumes 1 unit, calls searchExternalProducts, persists external Outfit.
 * 4. Partial sufficiency + free tier: checkQuota fails, 0 units consumed, 0 searches, template fallback.
 * 5. Preflight insufficient + paid quota: executes external product search and returns cited suggestedToAcquire.
 * 6. Fail-open resilience: external product search failure does not crash pipeline.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import '../../src/common/globals.js';
import { runStylistPipeline } from '../../src/modules/ai/stylist/stylist.orchestrator.js';
import entitlementService from '../../src/modules/subscriptions/entitlement.service.js';
import scopeGuard from '../../src/modules/ai/stylist/scope.guard.js';
import intentStep from '../../src/modules/ai/stylist/intent.step.js';
import composeStep from '../../src/modules/ai/stylist/compose.step.js';
import wardrobeService from '../../src/modules/wardrobe/wardrobe.service.js';
import stylePreferenceService from '../../src/modules/ai/preferences/style-preference.service.js';
import outfitService from '../../src/modules/ai/outfits/outfit.service.js';
import knowledgeService from '../../src/modules/ai/knowledge/knowledge.service.js';
import productSearchService from '../../src/modules/ai/products/product-search.service.js';

describe('Phase 15E Step 6 — Orchestrator Product Search & Sequential Quota', () => {
  const userId = 'user_product_search_eval_01';

  const mockWardrobeCandidates = {
    top: [{ _id: 'item_top_1', name: 'White Oxford Shirt', category: 'top', formality: 'formal' }],
    bottom: [{ _id: 'item_bot_1', name: 'Navy Trousers', category: 'bottom', formality: 'formal' }],
    shoes: [{ _id: 'item_shoe_1', name: 'Black Oxfords', category: 'shoes', formality: 'formal' }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    scopeGuard.resetInMemoryRefusalStore();

    // Default mocks
    jest.spyOn(entitlementService, 'consume').mockResolvedValue({ success: true });
    jest.spyOn(entitlementService, 'refundQuota').mockResolvedValue();
    jest.spyOn(entitlementService, 'checkQuota').mockResolvedValue({ allowed: true, remaining: 3 });

    jest.spyOn(wardrobeService, 'getWardrobeCandidates').mockResolvedValue(mockWardrobeCandidates);
    jest.spyOn(stylePreferenceService, 'getPreferences').mockResolvedValue({ favoriteColors: [] });
    jest.spyOn(wardrobeService, 'getWardrobeItemsByIds').mockResolvedValue([
      { _id: 'item_top_1', name: 'White Oxford Shirt', category: 'top', formality: 'formal' },
      { _id: 'item_bot_1', name: 'Navy Trousers', category: 'bottom', formality: 'formal' },
      { _id: 'item_shoe_1', name: 'Black Oxfords', category: 'shoes', formality: 'formal' },
    ]);
    jest.spyOn(outfitService, 'recordOutfit').mockResolvedValue({ _id: 'persisted_outfit_1' });
    jest.spyOn(knowledgeService, 'searchFashionKnowledge').mockResolvedValue([]);
    jest.spyOn(productSearchService, 'searchExternalProducts').mockResolvedValue([]);

    jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValue({
      inDomain: true,
      refusalCategory: null,
      language: 'en',
      eventType: 'wedding_formal',
      occasion: 'formal wedding',
      confidence: 0.95,
      usage: { inputTokens: 50, outputTokens: 25 },
      latencyMs: 100,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('1. Sufficient Wardrobe: never checks or consumes productSearch quota, returns empty suggestedToAcquire', async () => {
    jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValueOnce({
      outfits: [
        {
          itemIds: ['item_top_1', 'item_bot_1', 'item_shoe_1'],
          rationale: 'Complete formal wedding look from your wardrobe.',
          score: 95,
        },
      ],
      sufficiency: 'good',
      missingSlots: [],
      gapDescriptions: [],
      usage: { inputTokens: 100, outputTokens: 40 },
    });

    const result = await runStylistPipeline({
      userId,
      message: 'I have a formal wedding this weekend, what should I wear?',
    });

    expect(result.sufficiency).toBe('good');
    expect(result.fromYourWardrobe).toHaveLength(1);
    expect(result.outfits).toHaveLength(1);
    expect(result.suggestedToAcquire).toEqual([]);
    expect(result.suggestBookStylist).toBe(false);

    // Product search quota must NEVER be checked or consumed on sufficient wardrobe
    expect(entitlementService.checkQuota).not.toHaveBeenCalledWith(userId, 'ai.productSearch.daily', expect.any(Number), expect.any(String));
    expect(productSearchService.searchExternalProducts).not.toHaveBeenCalled();
  });

  it('2. Partial Sufficiency on Paid Tier: consumes 1 productSearch quota, executes grounded search, persists external Outfit', async () => {
    jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValueOnce({
      outfits: [
        {
          itemIds: ['item_top_1', 'item_bot_1'],
          rationale: 'Sharp suit base, but missing formal leather dress shoes.',
          score: 75,
        },
      ],
      sufficiency: 'partial',
      missingSlots: ['shoes'],
      gapDescriptions: ['polished black leather oxford dress shoes'],
      usage: { inputTokens: 100, outputTokens: 40 },
    });

    jest.spyOn(productSearchService, 'searchExternalProducts').mockResolvedValueOnce([
      {
        slot: 'shoes',
        itemType: 'black oxford shoes',
        title: 'Zara Egypt Polished Oxfords',
        description: 'Black leather formal shoes.',
        estimatedPriceEgp: 2100,
        retailer: 'Zara Egypt',
        sourceUrl: 'https://zara.com/eg/shoes',
        sourceTitle: 'Zara Egypt',
        citations: [{ title: 'Zara Egypt', url: 'https://zara.com/eg/shoes' }],
        isGrounded: true,
      },
    ]);

    const result = await runStylistPipeline({
      userId,
      message: 'What should I wear to a black tie gala?',
    });

    expect(result.sufficiency).toBe('partial');
    expect(result.fromYourWardrobe).toHaveLength(1);
    expect(result.suggestedToAcquire).toHaveLength(1);
    expect(result.suggestedToAcquire[0].title).toBe('Zara Egypt Polished Oxfords');
    expect(result.suggestedToAcquire[0].isGrounded).toBe(true);
    expect(result.suggestBookStylist).toBe(true);

    // Quota consumed for external product search
    expect(entitlementService.consume).toHaveBeenCalledWith(userId, 'ai.productSearch.daily', 1, 'client');
    expect(productSearchService.searchExternalProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        gapDescription: 'polished black leather oxford dress shoes',
        locale: 'en',
      })
    );

    // Persisted external Outfit record
    expect(outfitService.recordOutfit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        source: 'external',
        externalSuggestions: expect.arrayContaining([
          expect.objectContaining({ description: 'Black leather formal shoes.' }),
        ]),
      })
    );
  });

  it('3. Partial Sufficiency on Free Tier: checkQuota returns false, 0 units consumed, degrades to template shopping list', async () => {
    jest.spyOn(entitlementService, 'checkQuota').mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      reason: 'Feature requires a paid subscription tier',
    });

    jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValueOnce({
      outfits: [
        {
          itemIds: ['item_top_1', 'item_bot_1'],
          rationale: 'Solid base, missing formal outerwear.',
          score: 72,
        },
      ],
      sufficiency: 'partial',
      missingSlots: ['outerwear'],
      gapDescriptions: ['charcoal single-breasted blazer'],
      usage: { inputTokens: 90, outputTokens: 30 },
    });

    const result = await runStylistPipeline({
      userId,
      message: 'Styling for a business formal dinner',
    });

    expect(result.sufficiency).toBe('partial');
    expect(result.fromYourWardrobe).toHaveLength(1);
    expect(result.suggestedToAcquire).toHaveLength(1);
    expect(result.suggestedToAcquire[0].isGrounded).toBe(false);
    expect(result.suggestedToAcquire[0].itemType).toBe('charcoal single-breasted blazer');
    expect(result.suggestBookStylist).toBe(true);

    // Never consumed product search quota; searchExternalProducts not called
    expect(entitlementService.consume).not.toHaveBeenCalledWith(userId, 'ai.productSearch.daily', expect.any(Number), expect.any(String));
    expect(productSearchService.searchExternalProducts).not.toHaveBeenCalled();
  });

  it('4. Preflight Insufficient on Paid Tier: executes product search and returns cited suggestedToAcquire', async () => {
    // Empty wardrobe candidates
    jest.spyOn(wardrobeService, 'getWardrobeCandidates').mockResolvedValueOnce({
      top: [],
      bottom: [],
      shoes: [],
    });

    jest.spyOn(productSearchService, 'searchExternalProducts').mockResolvedValueOnce([
      {
        slot: 'top',
        itemType: 'formal shirt',
        title: 'White Cotton Dress Shirt',
        description: 'Crisp white dress shirt.',
        estimatedPriceEgp: 1200,
        retailer: 'Massimo Dutti Egypt',
        sourceUrl: 'https://massimodutti.com/eg/shirt',
        sourceTitle: 'Massimo Dutti',
        citations: [{ title: 'Massimo Dutti', url: 'https://massimodutti.com/eg/shirt' }],
        isGrounded: true,
      },
    ]);

    const result = await runStylistPipeline({
      userId,
      message: 'I have a formal gala tomorrow and my wardrobe is empty!',
    });

    expect(result.sufficiency).toBe('none');
    expect(result.fromYourWardrobe).toHaveLength(0);
    expect(result.suggestedToAcquire).toHaveLength(1);
    expect(result.suggestedToAcquire[0].title).toBe('White Cotton Dress Shirt');
    expect(result.suggestedToAcquire[0].isGrounded).toBe(true);
    expect(result.suggestBookStylist).toBe(true);

    expect(entitlementService.consume).toHaveBeenCalledWith(userId, 'ai.productSearch.daily', 1, 'client');
  });

  it('5. Fail-open resilience: external product search failure does not crash pipeline', async () => {
    jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValueOnce({
      outfits: [{ itemIds: ['item_top_1', 'item_bot_1'], rationale: 'Base look', score: 70 }],
      sufficiency: 'partial',
      missingSlots: ['shoes'],
      gapDescriptions: ['formal black shoes'],
      usage: { inputTokens: 50, outputTokens: 20 },
    });

    jest.spyOn(productSearchService, 'searchExternalProducts').mockRejectedValueOnce(
      new Error('Google search grounding API 503 unavailable')
    );

    const result = await runStylistPipeline({
      userId,
      message: 'Need help completing my outfit',
    });

    // Successfully returned without throwing; degraded cleanly
    expect(result.sufficiency).toBe('partial');
    expect(result.suggestedToAcquire).toHaveLength(1);
    expect(result.suggestedToAcquire[0].isGrounded).toBe(false);
  });
});
