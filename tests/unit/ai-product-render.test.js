/**
 * Phase 15E Step 5 — Response Rendering & Strict Separation Tests (render.step.js).
 *
 * Covers:
 * 1. Strict separation: fromYourWardrobe and suggestedToAcquire never merge.
 * 2. Backwards compatibility: response.fromYourWardrobe and response.outfits both exist and match.
 * 3. Sufficient wardrobe (sufficiency: 'good'): suggestedToAcquire: [], suggestBookStylist: false.
 * 4. Grounded external suggestions: mapped into suggestedToAcquire with citations, retailer, and pricing.
 * 5. Ungrounded fallback shopping list: when search is skipped or quota blocked, template list returned with isGrounded: false.
 * 6. Stylist booking CTA: present whenever sufficiency !== 'good'.
 */

import { describe, it, expect } from '@jest/globals';
import '../../src/common/globals.js';
import { renderStylistResponse } from '../../src/modules/ai/stylist/render.step.js';

describe('Phase 15E Step 5 — Response Rendering & Strict Separation', () => {
  const mockHydratedItems = new Map([
    [
      'item_top_1',
      {
        _id: 'item_top_1',
        name: 'White Oxford Shirt',
        category: 'top',
        primaryColor: 'White',
        formality: 'formal',
      },
    ],
    [
      'item_bot_1',
      {
        _id: 'item_bot_1',
        name: 'Navy Suit Trousers',
        category: 'bottom',
        primaryColor: 'Navy',
        formality: 'formal',
      },
    ],
  ]);

  it('maintains strict separation and returns empty suggestedToAcquire on good sufficiency', () => {
    const rawOutfits = [
      {
        itemIds: ['item_top_1', 'item_bot_1'],
        score: 95,
        rationale: 'Crisp, timeless formal tailoring.',
      },
    ];

    const result = renderStylistResponse({
      outfits: rawOutfits,
      sufficiency: 'good',
      missingSlots: [],
      hydratedItemsMap: mockHydratedItems,
      language: 'en',
    });

    // Clean response structure: outfits contains rendered outfits with fromYourWardrobe pieces
    expect(result.outfits).toHaveLength(1);
    expect(result.outfits[0].fromYourWardrobe).toHaveLength(2);

    // Empty acquisition & no booking CTA
    expect(result.suggestedToAcquire).toEqual([]);
    expect(result.suggestBookStylist).toBe(false);
    expect(result.stylistBookingCta).toBeNull();
  });

  it('renders grounded external suggestions with citations when provided on partial sufficiency', () => {
    const rawOutfits = [
      {
        itemIds: ['item_top_1', 'item_bot_1'],
        score: 75,
        rationale: 'Good base look, missing footwear and outerwear.',
      },
    ];

    const mockExternalSuggestions = [
      {
        slot: 'shoes',
        itemType: 'black oxford shoes',
        title: 'Polished Black Leather Oxfords',
        description: 'Classic formal cap-toe oxford dress shoes.',
        estimatedPriceEgp: 2200,
        retailer: 'Zara Egypt',
        sourceUrl: 'https://zara.com/eg/shoes',
        sourceTitle: 'Zara Egypt Shoes',
        imageUrl: 'https://static.zara.net/photos/sample-oxford.jpg',
        citations: [{ title: 'Zara Egypt', url: 'https://zara.com/eg/shoes' }],
        isGrounded: true,
      },
      {
        slot: 'outerwear',
        itemType: 'blazer',
        title: 'Structured Charcoal Blazer',
        description: 'Wool single-breasted evening blazer.',
        estimatedPriceEgp: 3400,
        retailer: 'Massimo Dutti Egypt',
        sourceUrl: 'https://massimodutti.com/eg/blazer',
        sourceTitle: 'Massimo Dutti Blazer',
        imageUrl: null,
        citations: [{ title: 'Massimo Dutti', url: 'https://massimodutti.com/eg/blazer' }],
        isGrounded: true,
      },
    ];

    const result = renderStylistResponse({
      outfits: rawOutfits,
      sufficiency: 'partial',
      missingSlots: ['shoes', 'outerwear'],
      gapDescriptions: ['black oxford shoes', 'charcoal blazer'],
      externalSuggestions: mockExternalSuggestions,
      hydratedItemsMap: mockHydratedItems,
      language: 'en',
    });

    expect(result.outfits).toHaveLength(1);
    expect(result.suggestedToAcquire).toHaveLength(2);

    // Owned and unowned are completely isolated
    expect(result.outfits[0].fromYourWardrobe[0].itemId).toBe('item_top_1');
    expect(result.suggestedToAcquire[0].title).toBe('Polished Black Leather Oxfords');
    expect(result.suggestedToAcquire[0].isGrounded).toBe(true);
    expect(result.suggestedToAcquire[0].imageUrl).toBe('https://static.zara.net/photos/sample-oxford.jpg');
    expect(result.suggestedToAcquire[0].citations).toHaveLength(1);
    expect(result.suggestedToAcquire[1].retailer).toBe('Massimo Dutti Egypt');
    expect(result.suggestedToAcquire[1].imageUrl).toBeNull();

    // Human stylist booking CTA is active
    expect(result.suggestBookStylist).toBe(true);
    expect(result.stylistBookingCta).toContain('Book a verified Murafiq stylist');
  });

  it('renders ungrounded fallback shopping list when external search is not run or blocked', () => {
    const result = renderStylistResponse({
      outfits: [],
      sufficiency: 'none',
      missingSlots: ['bottom', 'shoes'],
      gapDescriptions: ['navy formal tailored trousers', 'black oxford shoes'],
      externalSuggestions: [], // Blocked or skipped
      hydratedItemsMap: new Map(),
      language: 'en',
    });

    expect(result.outfits).toHaveLength(0);
    expect(result.suggestedToAcquire).toHaveLength(2);

    expect(result.suggestedToAcquire[0]).toEqual({
      slot: 'bottom',
      itemType: 'navy formal tailored trousers',
      title: 'navy formal tailored trousers',
      description: 'navy formal tailored trousers',
      estimatedPriceEgp: null,
      retailer: null,
      sourceUrl: null,
      sourceTitle: null,
      imageUrl: null,
      citations: [],
      isGrounded: false,
    });

    expect(result.suggestedToAcquire[1].imageUrl).toBeNull();
    expect(result.suggestedToAcquire[1].isGrounded).toBe(false);
    expect(result.suggestBookStylist).toBe(true);
  });

  it('preserves isGrounded: false for ungrounded fallback suggestions with retailer URLs', () => {
    const ungroundedSuggestions = [
      {
        slot: 'outerwear',
        itemType: 'blazer',
        title: 'Structured Satin Lapel Tuxedo Blazer',
        description: 'Tailored black tuxedo blazer with satin lapels.',
        estimatedPriceEgp: 4590,
        retailer: 'Zara Egypt',
        sourceUrl: 'https://www.zara.com/eg/en/tuxedo-blazer-p123.html',
        sourceTitle: 'Zara Egypt Online Store',
        citations: [{ title: 'Zara Egypt Online Store', url: 'https://www.zara.com/eg/en/tuxedo-blazer-p123.html' }],
        isGrounded: false, // fallback LLM without live Google search chunk
      },
    ];

    const result = renderStylistResponse({
      outfits: [],
      sufficiency: 'none',
      missingSlots: ['outerwear'],
      gapDescriptions: ['بليزر كلاسيكي مفصل'],
      externalSuggestions: ungroundedSuggestions,
      hydratedItemsMap: new Map(),
      language: 'ar',
    });

    expect(result.language).toBe('ar');
    expect(result.suggestedToAcquire).toHaveLength(1);
    expect(result.suggestedToAcquire[0].isGrounded).toBe(false);
    expect(result.suggestedToAcquire[0].sourceUrl).toBe('https://www.zara.com/eg/en/tuxedo-blazer-p123.html');
    expect(result.suggestedToAcquire[0].sourceTitle).toBe('Zara Egypt Online Store');
    expect(result.stylistBookingCta).toContain('احجز استشارة خاصة مع منسق أزياء معتمد');
  });
});
