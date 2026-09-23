/**
 * Phase 15C Step 7 — Orchestrator Image Flow Tests (stylist.orchestrator.js).
 *
 * Covers:
 * 1. Flow B with unmatched garment image:
 *    - Consumes both daily quotas.
 *    - Multimodal intent extraction.
 *    - matchWardrobeItem returns matched: false.
 *    - Complementary slot candidates retrieved.
 *    - Composition & validation with anchor.
 *    - AiMessage recorded with imageRef & expiresAt.
 *    - Response contains anchor, canSaveToWardrobe: true, saveMessageId.
 * 2. Flow B with matched garment image:
 *    - matchWardrobeItem returns matched: true.
 *    - Response contains matchHint, canSaveToWardrobe: false.
 * 3. Non-garment image refusal (Layer 1b):
 *    - Refunds both quotas.
 *    - 0 downstream calls (composition, retrieval, etc. never invoked).
 * 4. Flow A occasion backward compatibility.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import '../../src/common/globals.js';
import orchestrator from '../../src/modules/ai/stylist/stylist.orchestrator.js';
import entitlementService from '../../src/modules/subscriptions/entitlement.service.js';
import scopeGuard from '../../src/modules/ai/stylist/scope.guard.js';
import intentStep from '../../src/modules/ai/stylist/intent.step.js';
import matchStep from '../../src/modules/ai/stylist/match.step.js';
import composeStep from '../../src/modules/ai/stylist/compose.step.js';
import wardrobeService from '../../src/modules/wardrobe/wardrobe.service.js';
import stylePreferenceService from '../../src/modules/ai/preferences/style-preference.service.js';
import outfitService from '../../src/modules/ai/outfits/outfit.service.js';
import conversationService from '../../src/modules/ai/conversation/ai-conversation.service.js';
import knowledgeService from '../../src/modules/ai/knowledge/knowledge.service.js';

describe('Phase 15C Step 7 — Orchestrator Full Image Flow (Flow B)', () => {
  const mockUserId = 'user_orch_123';
  const mockImageRef = `murafiq/ai-chat/${mockUserId}/test-uuid-123`;

  let consumeSpy;
  let refundSpy;
  let classifySpy;
  let matchSpy;
  let composeSpy;
  let getCandidatesSpy;
  let addMessageSpy;

  beforeEach(() => {
    consumeSpy = jest.spyOn(entitlementService, 'consume').mockResolvedValue(true);
    refundSpy = jest.spyOn(entitlementService, 'refundQuota').mockResolvedValue(true);
    jest.spyOn(scopeGuard, 'checkRefusalRateLimit').mockResolvedValue({ allowed: true });
    jest.spyOn(scopeGuard, 'recordScopeRefusal').mockResolvedValue(true);

    jest.spyOn(stylePreferenceService, 'getPreferences').mockResolvedValue({});
    jest.spyOn(outfitService, 'recordOutfit').mockResolvedValue({ _id: 'outfit_rec_1' });

    jest.spyOn(conversationService, 'createConversation').mockResolvedValue({
      _id: 'conv_auto_1',
    });
    jest.spyOn(entitlementService, 'checkQuota').mockResolvedValue({ allowed: false, remaining: 0, planCode: 'client.free' });
    jest.spyOn(knowledgeService, 'searchFashionKnowledge').mockResolvedValue([]);
    addMessageSpy = jest.spyOn(conversationService, 'addMessage').mockResolvedValue({
      _id: 'msg_created_123',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs complete Flow B for unmatched garment image', async () => {
    classifySpy = jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
      inDomain: true,
      refusalCategory: null,
      imageIsGarment: true,
      garmentAnalysis: {
        category: 'top',
        subcategory: 'graphic_tee',
        colors: ['black'],
        colorFamily: 'black',
        pattern: 'graphic',
        formality: 'casual',
      },
      language: 'en',
      eventType: null,
      retrievalQueryEn: 'black graphic tee casual',
      confidence: 0.95,
    });

    matchSpy = jest.spyOn(matchStep, 'matchWardrobeItem').mockResolvedValueOnce({
      matched: false,
      itemId: null,
      itemName: null,
      confidence: 0.4,
    });

    getCandidatesSpy = jest.spyOn(wardrobeService, 'getWardrobeCandidates').mockResolvedValueOnce({
      bottom: [{ _id: 'bottom_10', category: 'bottom', subcategory: 'jeans', primaryColor: 'blue' }],
      shoes: [{ _id: 'shoes_20', category: 'shoes', subcategory: 'sneakers', primaryColor: 'white' }],
      outerwear: [],
      accessory: [],
    });

    composeSpy = jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValueOnce({
      outfits: [
        {
          itemIds: ['anchor_item', 'bottom_10', 'shoes_20'],
          rationale: 'Streetwear look built around the graphic tee',
          score: 90,
        },
      ],
      sufficiency: 'good',
      missingSlots: [],
      usage: { inputTokens: 100, outputTokens: 50 },
      latencyMs: 120,
    });

    jest.spyOn(wardrobeService, 'getWardrobeItemsByIds').mockResolvedValueOnce([
      { _id: 'bottom_10', name: 'Blue Jeans', category: 'bottom', subcategory: 'jeans' },
      { _id: 'shoes_20', name: 'White Sneakers', category: 'shoes', subcategory: 'sneakers' },
    ]);

    const result = await orchestrator.runStylistPipeline({
      userId: mockUserId,
      message: 'What pants and sneakers go with this tee?',
      imageRef: mockImageRef,
      options: {
        imageData: { mimeType: 'image/jpeg', data: 'mock-base64' },
      },
    });

    // 1. Quota verification: free user consumes only lifetime quota (no daily image restriction)
    expect(consumeSpy).toHaveBeenCalledTimes(1);
    expect(consumeSpy).toHaveBeenCalledWith(mockUserId, 'ai.messages.lifetime', 1, 'client');
    expect(refundSpy).not.toHaveBeenCalled();

    // 2. Intent step called with image
    expect(classifySpy).toHaveBeenCalledWith(
      'What pants and sneakers go with this tee?',
      expect.objectContaining({
        imageRef: mockImageRef,
        imageData: { mimeType: 'image/jpeg', data: 'mock-base64' },
      })
    );

    // 3. Match step called with garment analysis
    expect(matchSpy).toHaveBeenCalledWith(
      mockUserId,
      expect.objectContaining({ category: 'top', colorFamily: 'black' }),
      expect.any(Object)
    );

    // 4. Candidate retrieval used complementary slots (bottom, shoes, outerwear, accessory)
    expect(getCandidatesSpy).toHaveBeenCalledWith(
      mockUserId,
      expect.objectContaining({
        slots: ['bottom', 'shoes', 'outerwear', 'accessory'],
      })
    );

    // 5. Composition called with anchor
    expect(composeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        anchor: expect.objectContaining({
          id: 'anchor_item',
          category: 'top',
          matched: false,
        }),
      })
    );

    // 6. AiMessage was recorded with imageRef & analysis
    expect(addMessageSpy).toHaveBeenCalledWith(
      'conv_auto_1',
      mockUserId,
      expect.objectContaining({
        role: 'user',
        imageRef: mockImageRef,
        imageAnalysis: expect.objectContaining({ category: 'top' }),
        matchedWardrobeItemId: null,
      })
    );

    // 7. Response rendering assertions
    expect(result.refused).toBeUndefined();
    expect(result.canSaveToWardrobe).toBe(true);
    expect(result.saveToWardrobeCta).toBeDefined();
    expect(result.saveMessageId).toBe('msg_created_123');
    expect(result.matchHint).toBeNull();
    expect(result.anchor).toMatchObject({
      id: 'anchor_item',
      category: 'top',
      subcategory: 'graphic_tee',
      isAnchor: true,
    });
    expect(result.outfits).toHaveLength(1);
    expect(result.outfits[0].anchor).toBeDefined();
  });

  it('runs Flow B for matched garment image: surfaces soft hint and suppresses Save CTA', async () => {
    classifySpy = jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
      inDomain: true,
      refusalCategory: null,
      imageIsGarment: true,
      garmentAnalysis: {
        category: 'top',
        subcategory: 'oxford_shirt',
        colors: ['red'],
        colorFamily: 'red',
        formality: 'smart_casual',
      },
      language: 'en',
      eventType: null,
      retrievalQueryEn: 'red oxford shirt smart casual',
      confidence: 0.95,
    });

    matchSpy = jest.spyOn(matchStep, 'matchWardrobeItem').mockResolvedValueOnce({
      matched: true,
      itemId: 'owned_red_shirt_55',
      itemName: 'Red Oxford Cotton Shirt',
      confidence: 0.94,
    });

    getCandidatesSpy = jest.spyOn(wardrobeService, 'getWardrobeCandidates').mockResolvedValueOnce({
      bottom: [{ _id: 'chinos_1', category: 'bottom', subcategory: 'chinos' }],
      shoes: [{ _id: 'loafers_1', category: 'shoes', subcategory: 'loafers' }],
    });

    composeSpy = jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValueOnce({
      outfits: [
        {
          itemIds: ['owned_red_shirt_55', 'chinos_1', 'loafers_1'],
          rationale: 'Sophisticated outfit with your red shirt',
          score: 92,
        },
      ],
      sufficiency: 'good',
      missingSlots: [],
    });

    jest.spyOn(wardrobeService, 'getWardrobeItemsByIds').mockResolvedValueOnce([
      { _id: 'owned_red_shirt_55', name: 'Red Oxford Cotton Shirt', category: 'top' },
      { _id: 'chinos_1', name: 'Navy Chinos', category: 'bottom' },
      { _id: 'loafers_1', name: 'Brown Loafers', category: 'shoes' },
    ]);

    const result = await orchestrator.runStylistPipeline({
      userId: mockUserId,
      message: 'What pants go with this shirt?',
      imageRef: mockImageRef,
      options: {
        imageData: { mimeType: 'image/jpeg', data: 'mock-base64' },
      },
    });

    // Verified: Soft match hint surfaced, Save CTA suppressed
    expect(result.canSaveToWardrobe).toBe(false);
    expect(result.saveToWardrobeCta).toBeNull();
    expect(result.matchHint).toContain('Red Oxford Cotton Shirt');
    expect(result.matchHint).toContain('Does this look like your');
    expect(result.anchor).toBeNull(); // Matched item is hydrated from wardrobe, not an external anchor
  });

  it('refuses non-garment image and refunds both daily quotas with zero downstream calls', async () => {
    classifySpy = jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
      inDomain: false,
      refusalCategory: 'non_garment_image',
      imageIsGarment: false,
      garmentAnalysis: null,
      language: 'en',
    });

    matchSpy = jest.spyOn(matchStep, 'matchWardrobeItem');
    getCandidatesSpy = jest.spyOn(wardrobeService, 'getWardrobeCandidates');
    composeSpy = jest.spyOn(composeStep, 'composeAndRankOutfits');

    const result = await orchestrator.runStylistPipeline({
      userId: mockUserId,
      message: 'What breed is this dog?',
      imageRef: mockImageRef,
      options: {
        imageData: { mimeType: 'image/jpeg', data: 'mock-dog-base64' },
      },
    });

    expect(result.refused).toBe(true);
    expect(result.refusalCategory).toBe('non_garment_image');
    expect(result.message).toContain('clothing');

    // Lifetime quota refunded for free user
    expect(refundSpy).toHaveBeenCalledTimes(1);
    expect(refundSpy).toHaveBeenCalledWith(mockUserId, 'ai.messages.lifetime', 1);

    // Zero downstream calls
    expect(matchSpy).not.toHaveBeenCalled();
    expect(getCandidatesSpy).not.toHaveBeenCalled();
    expect(composeSpy).not.toHaveBeenCalled();
  });

  it('runs Flow B for paid subscriber: consumes and refunds both daily quotas on refusal', async () => {
    jest.spyOn(entitlementService, 'getEntitlements').mockResolvedValueOnce({
      planCode: 'client.basic',
      tier: 'basic',
      entitlements: {
        'ai.messages.daily': 5,
        'ai.imageMessages.daily': 3,
      },
    });

    classifySpy = jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
      inDomain: false,
      refusalCategory: 'non_garment_image',
      imageIsGarment: false,
      garmentAnalysis: null,
      language: 'en',
    });

    const result = await orchestrator.runStylistPipeline({
      userId: mockUserId,
      message: 'What breed is this dog?',
      imageRef: mockImageRef,
      options: {
        imageData: { mimeType: 'image/jpeg', data: 'mock-dog-base64' },
      },
    });

    expect(result.refused).toBe(true);
    // Both quotas consumed then refunded for paid tier
    expect(consumeSpy).toHaveBeenCalledWith(mockUserId, 'ai.messages.daily', 1, 'client');
    expect(consumeSpy).toHaveBeenCalledWith(mockUserId, 'ai.imageMessages.daily', 1, 'client');
    expect(refundSpy).toHaveBeenCalledWith(mockUserId, 'ai.messages.daily', 1);
    expect(refundSpy).toHaveBeenCalledWith(mockUserId, 'ai.imageMessages.daily', 1);
  });

  it('runs standard Flow A when no imageRef is attached', async () => {
    classifySpy = jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
      inDomain: true,
      refusalCategory: null,
      language: 'en',
      eventType: 'wedding_formal',
      retrievalQueryEn: 'formal wedding suit',
      confidence: 0.95,
    });

    matchSpy = jest.spyOn(matchStep, 'matchWardrobeItem');

    getCandidatesSpy = jest.spyOn(wardrobeService, 'getWardrobeCandidates').mockResolvedValueOnce({
      top: [{ _id: 'suit_top_1', category: 'top' }],
      bottom: [{ _id: 'suit_bottom_1', category: 'bottom' }],
      shoes: [{ _id: 'oxford_shoes_1', category: 'shoes' }],
    });

    composeSpy = jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValueOnce({
      outfits: [
        {
          itemIds: ['suit_top_1', 'suit_bottom_1', 'oxford_shoes_1'],
          rationale: 'Classic wedding suit',
          score: 95,
        },
      ],
      sufficiency: 'good',
      missingSlots: [],
    });

    jest.spyOn(wardrobeService, 'getWardrobeItemsByIds').mockResolvedValueOnce([
      { _id: 'suit_top_1', name: 'Jacket', category: 'top' },
      { _id: 'suit_bottom_1', name: 'Pants', category: 'bottom' },
      { _id: 'oxford_shoes_1', name: 'Oxfords', category: 'shoes' },
    ]);

    const result = await orchestrator.runStylistPipeline({
      userId: mockUserId,
      message: 'I have a wedding tomorrow evening',
    });

    // Only 1 metric consumed (ai.messages.lifetime)
    expect(consumeSpy).toHaveBeenCalledTimes(1);
    expect(consumeSpy).toHaveBeenCalledWith(mockUserId, 'ai.messages.lifetime', 1, 'client');

    // matchWardrobeItem never called
    expect(matchSpy).not.toHaveBeenCalled();

    expect(result.anchor).toBeNull();
    expect(result.canSaveToWardrobe).toBe(false);
  });
});
