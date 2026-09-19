/**
 * Phase 15C Step 6 — Anchor Threading Tests (compose.step, outfit.validator, render.step).
 *
 * Covers:
 * 1. compose.step: Anchor pinning, prompt inclusion, and fallback when model omits anchor.
 * 2. outfit.validator: Unmatched anchor exemption and matched anchor real-ID validation.
 * 3. render.step: Soft match hint vs. Save-to-Wardrobe CTA, bilingual rendering.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import '../../src/common/globals.js';
import { composeAndRankOutfits } from '../../src/modules/ai/stylist/compose.step.js';
import { validateOutfitItemIds } from '../../src/modules/ai/stylist/outfit.validator.js';
import { renderStylistResponse } from '../../src/modules/ai/stylist/render.step.js';
import { setGenAiClient } from '../../src/modules/ai/providers/llm.provider.js';

describe('Phase 15C Step 6 — Anchor Threading in Composition', () => {
  let mockGenerateContent;

  beforeEach(() => {
    mockGenerateContent = jest.fn();
    setGenAiClient({
      models: {
        generateContent: mockGenerateContent,
      },
    });
  });

  afterEach(() => {
    setGenAiClient(null);
    jest.clearAllMocks();
  });

  it('pins anchor ID into every outfit even if the model omitted it', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        outfits: [
          {
            itemIds: ['bottom_1', 'shoes_1'], // Model forgot anchor_item!
            rationale: 'Clean smart casual look',
            score: 85,
          },
        ],
        sufficiency: 'good',
        missingSlots: [],
      }),
      usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 50 },
    });

    const anchor = {
      id: 'anchor_item',
      matched: false,
      category: 'top',
      subcategory: 'linen_shirt',
      colorFamily: 'blue',
      formality: 'smart_casual',
    };

    const candidatesBySlot = {
      bottom: [{ _id: 'bottom_1', category: 'bottom', subcategory: 'chinos', primaryColor: 'beige' }],
      shoes: [{ _id: 'shoes_1', category: 'shoes', subcategory: 'loafers', primaryColor: 'brown' }],
    };

    const result = await composeAndRankOutfits({
      candidatesBySlot,
      anchor,
      language: 'en',
    });

    expect(result.outfits).toHaveLength(1);
    // Anchor ID MUST be pinned into itemIds
    expect(result.outfits[0].itemIds).toContain('anchor_item');
    expect(result.outfits[0].itemIds[0]).toBe('anchor_item');

    // Verify prompt had anchor section
    const promptArg = mockGenerateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptArg).toContain('<anchor_garment>');
    expect(promptArg).toContain('ID: "anchor_item"');
    expect(promptArg).toContain('Category: top');
  });

  it('keeps anchor ID if model already included it', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        outfits: [
          {
            itemIds: ['anchor_item', 'bottom_1'],
            rationale: 'Complementary palette',
            score: 90,
          },
        ],
        sufficiency: 'good',
        missingSlots: [],
      }),
      usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 50 },
    });

    const anchor = {
      id: 'anchor_item',
      category: 'top',
      colorFamily: 'white',
    };

    const result = await composeAndRankOutfits({
      candidatesBySlot: {
        bottom: [{ _id: 'bottom_1', category: 'bottom' }],
      },
      anchor,
    });

    // Should not duplicate anchor_item
    expect(result.outfits[0].itemIds).toEqual(['anchor_item', 'bottom_1']);
  });
});

describe('Phase 15C Step 6 — Anchor Exemption in Outfit Validator', () => {
  const candidatePool = new Set(['bottom_100', 'shoes_200']);

  it('exempts unmatched anchor ID from candidate pool check', () => {
    const outfits = [
      {
        itemIds: ['anchor_item', 'bottom_100', 'shoes_200'],
      },
    ];

    const anchor = {
      id: 'anchor_item',
      matched: false,
    };

    const validation = validateOutfitItemIds(outfits, candidatePool, anchor);

    expect(validation.valid).toBe(true);
    expect(validation.invalidIds).toHaveLength(0);
    expect(validation.verifiedOutfits).toHaveLength(1);
  });

  it('validates matched anchor as a real wardrobe item ID', () => {
    const outfits = [
      {
        itemIds: ['item_owned_top', 'bottom_100'],
      },
    ];

    const anchor = {
      id: 'item_owned_top',
      itemId: 'item_owned_top',
      matched: true,
    };

    const validation = validateOutfitItemIds(outfits, candidatePool, anchor);

    expect(validation.valid).toBe(true);
    expect(validation.invalidIds).toHaveLength(0);
  });

  it('still rejects true hallucinated IDs even when anchor is present', () => {
    const outfits = [
      {
        itemIds: ['anchor_item', 'bottom_100', 'hallucinated_item_999'],
      },
    ];

    const anchor = {
      id: 'anchor_item',
      matched: false,
    };

    const validation = validateOutfitItemIds(outfits, candidatePool, anchor);

    expect(validation.valid).toBe(false);
    expect(validation.invalidIds).toContain('hallucinated_item_999');
    expect(validation.invalidIds).not.toContain('anchor_item');
  });
});

describe('Phase 15C Step 6 — Anchor Rendering in render.step.js', () => {
  const mockHydratedMap = new Map([
    [
      'bottom_100',
      {
        _id: 'bottom_100',
        name: 'Slim Chinos',
        category: 'bottom',
        subcategory: 'chinos',
        imageUrl: 'https://cloudinary.com/chinos.jpg',
        primaryColor: 'beige',
        formality: 'smart_casual',
      },
    ],
  ]);

  it('renders Save CTA and anchor garment when anchor is unmatched', () => {
    const anchor = {
      id: 'anchor_item',
      category: 'top',
      subcategory: 'linen_shirt',
      imageUrl: 'https://cloudinary.com/ai-chat/u1/shirt.jpg',
      colorFamily: 'blue',
      formality: 'smart_casual',
      material: 'linen',
    };

    const outfits = [{ itemIds: ['anchor_item', 'bottom_100'], score: 88, rationale: 'Great fit' }];

    const result = renderStylistResponse({
      outfits,
      hydratedItemsMap: mockHydratedMap,
      language: 'en',
      anchor,
      matchResult: { matched: false },
      messageId: 'msg_123',
    });

    expect(result.canSaveToWardrobe).toBe(true);
    expect(result.saveToWardrobeCta).toContain('save this piece to your wardrobe');
    expect(result.saveMessageId).toBe('msg_123');
    expect(result.matchHint).toBeNull();
    expect(result.anchor).toMatchObject({
      id: 'anchor_item',
      category: 'top',
      subcategory: 'linen_shirt',
      isAnchor: true,
    });
    expect(result.outfits[0].anchor).toBeDefined();
  });

  it('renders soft match hint and suppresses Save CTA when anchor matches owned item', () => {
    const anchor = {
      id: 'item_top_owned',
      matched: true,
      category: 'top',
    };

    const matchResult = {
      matched: true,
      itemId: 'item_top_owned',
      itemName: 'Blue Linen Oxford Shirt',
      confidence: 0.93,
    };

    const outfits = [{ itemIds: ['item_top_owned', 'bottom_100'], score: 90, rationale: 'Superb' }];

    const result = renderStylistResponse({
      outfits,
      hydratedItemsMap: mockHydratedMap,
      language: 'en',
      anchor,
      matchResult,
      messageId: 'msg_123',
    });

    expect(result.canSaveToWardrobe).toBe(false);
    expect(result.saveToWardrobeCta).toBeNull();
    expect(result.matchHint).toContain('Blue Linen Oxford Shirt');
    expect(result.matchHint).toContain('Does this look like your');
    expect(result.anchor).toBeNull();
  });

  it('renders Arabic match hint and Save CTA accurately', () => {
    const anchor = { id: 'anchor_item', category: 'top' };

    // Arabic Unmatched
    const resultUnmatched = renderStylistResponse({
      outfits: [],
      language: 'ar',
      anchor,
      matchResult: { matched: false },
    });
    expect(resultUnmatched.saveToWardrobeCta).toContain('حفظ هذه القطعة في خزانة ملابسك');

    // Arabic Matched
    const resultMatched = renderStylistResponse({
      outfits: [],
      language: 'ar',
      anchor,
      matchResult: { matched: true, itemName: 'قميص كتان أزرق' },
    });
    expect(resultMatched.matchHint).toContain('قميص كتان أزرق');
    expect(resultMatched.matchHint).toContain('هل هذه القطعة تشبه');
  });

  it('maintains clean backward compatibility for occasion requests without anchor', () => {
    const outfits = [{ itemIds: ['bottom_100'], score: 80, rationale: 'Simple' }];

    const result = renderStylistResponse({
      outfits,
      hydratedItemsMap: mockHydratedMap,
      language: 'en',
    });

    expect(result.anchor).toBeNull();
    expect(result.matchHint).toBeNull();
    expect(result.canSaveToWardrobe).toBe(false);
    expect(result.saveToWardrobeCta).toBeNull();
  });
});
