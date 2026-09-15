import { jest } from '@jest/globals';
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
import { REFUSAL_CATEGORIES } from '../../src/modules/ai/prompts/refusal.templates.js';

describe('Unit — AI Stylist Pipeline Orchestrator (stylist.orchestrator.js)', () => {
  const userId = 'user_stylist_test_1';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(entitlementService, 'checkQuota').mockResolvedValue({ allowed: false, remaining: 0, planCode: 'client.free' });
    jest.spyOn(knowledgeService, 'searchFashionKnowledge').mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Gate 0: aborts with 429 when daily quota is exhausted before any model call', async () => {
    jest.spyOn(entitlementService, 'consume').mockRejectedValueOnce(
      new ApiError(429, 'Daily quota exceeded for ai.messages.daily')
    );
    const intentSpy = jest.spyOn(intentStep, 'classifyAndExtract');

    await expect(
      runStylistPipeline({
        userId,
        message: 'wedding outfit needed',
      })
    ).rejects.toThrow(ApiError);

    expect(intentSpy).not.toHaveBeenCalled();
  });

  it('Gate 0b: rejects empty input with 400 Bad Request and refunds daily quota', async () => {
    jest.spyOn(entitlementService, 'consume').mockResolvedValueOnce({ success: true });
    const refundSpy = jest.spyOn(entitlementService, 'refundQuota').mockResolvedValueOnce();
    const intentSpy = jest.spyOn(intentStep, 'classifyAndExtract');

    await expect(
      runStylistPipeline({
        userId,
        message: '   ',
      })
    ).rejects.toThrow(ApiError);

    expect(refundSpy).toHaveBeenCalledWith(userId, 'ai.messages.daily', 1);
    expect(intentSpy).not.toHaveBeenCalled();
  });

  it('Gate 0b: blocks 6th refusal within 1 hour before model call and refunds quota', async () => {
    jest.spyOn(entitlementService, 'consume').mockResolvedValueOnce({ success: true });
    const refundSpy = jest.spyOn(entitlementService, 'refundQuota').mockResolvedValueOnce();
    jest.spyOn(scopeGuard, 'checkRefusalRateLimit').mockResolvedValueOnce({
      allowed: false,
      refusalCategory: REFUSAL_CATEGORIES.RATE_LIMITED,
      count: 5,
    });
    const intentSpy = jest.spyOn(intentStep, 'classifyAndExtract');

    const result = await runStylistPipeline({
      userId,
      message: 'out of domain repeat test',
    });

    expect(result.refused).toBe(true);
    expect(result.refusalCategory).toBe(REFUSAL_CATEGORIES.RATE_LIMITED);
    expect(refundSpy).toHaveBeenCalledWith(userId, 'ai.messages.daily', 1);
    expect(intentSpy).not.toHaveBeenCalled();
  });

  it('Gate 1b: out-of-domain refusal refunds quota, increments abuse counter, and executes ZERO downstream calls', async () => {
    jest.spyOn(entitlementService, 'consume').mockResolvedValueOnce({ success: true });
    const refundSpy = jest.spyOn(entitlementService, 'refundQuota').mockResolvedValueOnce();
    const abuseRecordSpy = jest.spyOn(scopeGuard, 'recordScopeRefusal').mockResolvedValueOnce();

    jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
      inDomain: false,
      refusalCategory: REFUSAL_CATEGORIES.GENERAL_KNOWLEDGE,
      language: 'en',
      usage: { inputTokens: 20, outputTokens: 10 },
      latencyMs: 80,
    });

    const wardrobeSpy = jest.spyOn(wardrobeService, 'getWardrobeCandidates');
    const composeSpy = jest.spyOn(composeStep, 'composeAndRankOutfits');

    const result = await runStylistPipeline({
      userId,
      message: 'What is the capital of France?',
    });

    expect(result.refused).toBe(true);
    expect(result.refusalCategory).toBe(REFUSAL_CATEGORIES.GENERAL_KNOWLEDGE);
    expect(result.message).toContain("I'm your Murafiq AI Stylist");

    // Quota refunded and abuse counter incremented
    expect(refundSpy).toHaveBeenCalledWith(userId, 'ai.messages.daily', 1);
    expect(abuseRecordSpy).toHaveBeenCalledWith(userId);

    // ZERO downstream retrieval or composition calls
    expect(wardrobeSpy).not.toHaveBeenCalled();
    expect(composeSpy).not.toHaveBeenCalled();
  });

  it('Gate 4: pre-flight guard skips composition call when required slot is completely missing', async () => {
    jest.spyOn(entitlementService, 'consume').mockResolvedValueOnce({ success: true });
    jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
      inDomain: true,
      language: 'en',
      eventType: 'wedding_formal',
      retrievalQueryEn: 'formal wedding suit',
      confidence: 0.95,
    });

    // Wardrobe has top and bottom, but NO shoes
    jest.spyOn(wardrobeService, 'getWardrobeCandidates').mockResolvedValueOnce({
      top: [{ _id: 'top_1', name: 'White Shirt' }],
      bottom: [{ _id: 'bottom_1', name: 'Black Trousers' }],
      shoes: [],
    });

    jest.spyOn(stylePreferenceService, 'getPreferences').mockResolvedValueOnce({
      favoriteColors: [],
    });

    const composeSpy = jest.spyOn(composeStep, 'composeAndRankOutfits');

    const result = await runStylistPipeline({
      userId,
      message: 'I have a formal wedding tomorrow evening, what should I wear?',
    });

    // Composition call MUST be skipped
    expect(composeSpy).not.toHaveBeenCalled();

    expect(result.sufficiency).toBe('none');
    expect(result.missingSlots).toContain('shoes');
    expect(result.suggestBookStylist).toBe(true);
    expect(result.suggestedToAcquire.length).toBeGreaterThan(0);
  });

  it('Full Pipeline: executes in-domain request, validates items, persists outfits, and renders response', async () => {
    jest.spyOn(entitlementService, 'consume').mockResolvedValueOnce({ success: true });
    jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
      inDomain: true,
      language: 'en',
      eventType: 'wedding_formal',
      formality: 'formal',
      timeOfDay: 'evening',
      retrievalQueryEn: 'dark formal wedding suit',
      confidence: 0.98,
    });

    const candidates = {
      top: [{ _id: 'top_1', name: 'White Shirt', category: 'top' }],
      bottom: [{ _id: 'bottom_1', name: 'Navy Trousers', category: 'bottom' }],
      shoes: [{ _id: 'shoes_1', name: 'Oxford Shoes', category: 'shoes' }],
    };

    jest.spyOn(wardrobeService, 'getWardrobeCandidates').mockResolvedValueOnce(candidates);
    jest.spyOn(stylePreferenceService, 'getPreferences').mockResolvedValueOnce({});

    jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValueOnce({
      outfits: [
        {
          itemIds: ['top_1', 'bottom_1', 'shoes_1'],
          rationale: 'Elegant formal attire.',
          score: 95,
        },
      ],
      sufficiency: 'good',
      missingSlots: [],
      usage: { inputTokens: 100, outputTokens: 30 },
      latencyMs: 250,
    });

    jest.spyOn(wardrobeService, 'getWardrobeItemsByIds').mockResolvedValueOnce([
      {
        _id: 'top_1',
        name: 'White Shirt',
        category: 'top',
        imageUrl: 'https://cloudinary.com/top.jpg',
        primaryColor: 'White',
      },
      {
        _id: 'bottom_1',
        name: 'Navy Trousers',
        category: 'bottom',
        imageUrl: 'https://cloudinary.com/bottom.jpg',
        primaryColor: 'Navy',
      },
      {
        _id: 'shoes_1',
        name: 'Oxford Shoes',
        category: 'shoes',
        imageUrl: 'https://cloudinary.com/shoes.jpg',
        primaryColor: 'Black',
      },
    ]);

    const recordOutfitSpy = jest.spyOn(outfitService, 'recordOutfit').mockResolvedValueOnce({
      _id: 'persisted_outfit_1',
    });

    const result = await runStylistPipeline({
      userId,
      message: 'I have a wedding tomorrow evening, what should I wear?',
    });

    expect(result.sufficiency).toBe('good');
    expect(result.outfits).toHaveLength(1);
    expect(result.outfits[0].outfitId).toBe('persisted_outfit_1');
    expect(result.outfits[0].fromYourWardrobe).toHaveLength(3);
    expect(recordOutfitSpy).toHaveBeenCalledTimes(1);
    expect(result.traceId).toBeDefined();
  });

  it('Gate 6: anti-hallucination gate triggers single retry and fails closed if forgery persists', async () => {
    jest.spyOn(entitlementService, 'consume').mockResolvedValueOnce({ success: true });
    jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
      inDomain: true,
      language: 'en',
      eventType: 'wedding_formal',
      retrievalQueryEn: 'formal suit',
    });

    const candidates = {
      top: [{ _id: 'top_1' }],
      bottom: [{ _id: 'bottom_1' }],
      shoes: [{ _id: 'shoes_1' }],
    };

    jest.spyOn(wardrobeService, 'getWardrobeCandidates').mockResolvedValueOnce(candidates);
    jest.spyOn(stylePreferenceService, 'getPreferences').mockResolvedValueOnce({});

    // First composition attempt returns a foreign forged ID
    // Second composition attempt (retry) also returns foreign ID
    jest.spyOn(composeStep, 'composeAndRankOutfits')
      .mockResolvedValueOnce({
        outfits: [{ itemIds: ['top_1', 'forged_item_999'], score: 90 }],
        sufficiency: 'good',
        missingSlots: [],
      })
      .mockResolvedValueOnce({
        outfits: [{ itemIds: ['top_1', 'still_forged_999'], score: 90 }],
        sufficiency: 'good',
        missingSlots: [],
      });

    await expect(
      runStylistPipeline({
        userId,
        message: 'wedding outfit',
      })
    ).rejects.toThrow(ApiError);
  });
});
