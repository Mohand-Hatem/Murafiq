/**
 * Phase 15E Step 4 — Gap Analysis & Two-Suggestion Composition Tests (compose.step.js).
 *
 * Covers:
 * 1. Two-Suggestion Rule: slices returned outfits to at most 2 distinct outfits.
 * 2. Two-Suggestion Rule: handles 2 distinct outfits with candidate IDs and scores.
 * 3. Sufficient Wardrobe (sufficiency: 'good') yields gapDescriptions: [].
 * 4. Partially Sufficient Wardrobe (sufficiency: 'partial') yields outfits + concrete gapDescriptions.
 * 5. Insufficient Wardrobe (sufficiency: 'none') yields outfits: [] + concrete gapDescriptions.
 * 6. Fallback gap formulation: synthesizes gapDescriptions from missingSlots and formality when model returns empty array.
 * 7. System prompt verification: contains TWO-SUGGESTION RULE and concrete gap guidelines.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import '../../src/common/globals.js';
import {
  composeAndRankOutfits,
  COMPOSE_RESPONSE_SCHEMA,
  buildSystemPrompt,
} from '../../src/modules/ai/stylist/compose.step.js';
import { setGenAiClient } from '../../src/modules/ai/providers/llm.provider.js';

describe('Phase 15E Step 4 — Gap Analysis & Two-Suggestion Composition', () => {
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

  const mockCandidates = {
    top: [
      { _id: 'item_top_1', name: 'White Dress Shirt', category: 'top', formality: 'formal' },
      { _id: 'item_top_2', name: 'Light Blue Button Down', category: 'top', formality: 'smart_casual' },
    ],
    bottom: [
      { _id: 'item_bot_1', name: 'Charcoal Wool Trousers', category: 'bottom', formality: 'formal' },
      { _id: 'item_bot_2', name: 'Dark Navy Chinos', category: 'bottom', formality: 'smart_casual' },
    ],
    shoes: [
      { _id: 'item_shoe_1', name: 'Black Leather Oxfords', category: 'shoes', formality: 'formal' },
    ],
  };

  const mockDressCode = {
    eventType: 'formal_gala',
    formality: ['formal'],
    requiredSlots: ['top', 'bottom', 'shoes'],
    optionalSlots: ['outerwear', 'accessory'],
  };

  describe('Two-Suggestion Rule', () => {
    it('slices returned outfits to at most 2 distinct outfits if model returns 3', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          outfits: [
            { itemIds: ['item_top_1', 'item_bot_1', 'item_shoe_1'], rationale: 'Look 1 (Monochrome formal)', score: 95 },
            { itemIds: ['item_top_2', 'item_bot_1', 'item_shoe_1'], rationale: 'Look 2 (Subtle contrast)', score: 88 },
            { itemIds: ['item_top_1', 'item_bot_2', 'item_shoe_1'], rationale: 'Look 3 (Extra option)', score: 82 },
          ],
          sufficiency: 'good',
          missingSlots: [],
          gapDescriptions: [],
        }),
        usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 90 },
      });

      const result = await composeAndRankOutfits({
        candidatesBySlot: mockCandidates,
        resolvedDressCode: mockDressCode,
      });

      expect(result.outfits).toHaveLength(2);
      expect(result.outfits[0].rationale).toContain('Look 1');
      expect(result.outfits[1].rationale).toContain('Look 2');
      expect(result.sufficiency).toBe('good');
      expect(result.gapDescriptions).toEqual([]);
    });

    it('returns exactly 1 outfit without error if only 1 can be composed', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          outfits: [
            { itemIds: ['item_top_1', 'item_bot_1', 'item_shoe_1'], rationale: 'The single viable look', score: 90 },
          ],
          sufficiency: 'good',
          missingSlots: [],
          gapDescriptions: [],
        }),
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40 },
      });

      const result = await composeAndRankOutfits({
        candidatesBySlot: mockCandidates,
        resolvedDressCode: mockDressCode,
      });

      expect(result.outfits).toHaveLength(1);
      expect(result.sufficiency).toBe('good');
    });
  });

  describe('Sufficiency & Concrete Gap Formulation', () => {
    it('returns empty gapDescriptions when sufficiency is good', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          outfits: [
            { itemIds: ['item_top_1', 'item_bot_1', 'item_shoe_1'], rationale: 'Perfect gala pairing', score: 94 },
          ],
          sufficiency: 'good',
          missingSlots: [],
          gapDescriptions: [],
        }),
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40 },
      });

      const result = await composeAndRankOutfits({
        candidatesBySlot: mockCandidates,
        resolvedDressCode: mockDressCode,
      });

      expect(result.sufficiency).toBe('good');
      expect(result.gapDescriptions).toEqual([]);
    });

    it('returns outfits AND concrete gapDescriptions when sufficiency is partial', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          outfits: [
            {
              itemIds: ['item_top_1', 'item_bot_1', 'item_shoe_1'],
              rationale: 'Solid base, but lacks formal black-tie outerwear and tie.',
              score: 75,
            },
          ],
          sufficiency: 'partial',
          missingSlots: ['outerwear', 'accessory'],
          gapDescriptions: [
            'black wool single-breasted tuxedo dinner jacket',
            'silk black bowtie',
          ],
        }),
        usageMetadata: { promptTokenCount: 140, candidatesTokenCount: 60 },
      });

      const result = await composeAndRankOutfits({
        candidatesBySlot: mockCandidates,
        resolvedDressCode: mockDressCode,
      });

      expect(result.sufficiency).toBe('partial');
      expect(result.outfits).toHaveLength(1);
      expect(result.missingSlots).toEqual(['outerwear', 'accessory']);
      expect(result.gapDescriptions).toEqual([
        'black wool single-breasted tuxedo dinner jacket',
        'silk black bowtie',
      ]);
    });

    it('returns empty outfits and concrete gapDescriptions when sufficiency is none', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          outfits: [],
          sufficiency: 'none',
          missingSlots: ['top', 'bottom', 'shoes'],
          gapDescriptions: [
            'navy tailored wool formal suit trousers',
            'crisp white poplin formal dress shirt',
            'polished black leather oxford shoes',
          ],
        }),
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      });

      const result = await composeAndRankOutfits({
        candidatesBySlot: {},
        resolvedDressCode: mockDressCode,
      });

      expect(result.sufficiency).toBe('none');
      expect(result.outfits).toHaveLength(0);
      expect(result.gapDescriptions).toHaveLength(3);
      expect(result.gapDescriptions[0]).toBe('navy tailored wool formal suit trousers');
    });

    it('synthesizes fallback gapDescriptions if model outputs none on partial/none', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          outfits: [],
          sufficiency: 'none',
          missingSlots: ['bottom', 'shoes'],
        }),
        usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20 },
      });

      const result = await composeAndRankOutfits({
        candidatesBySlot: {},
        resolvedDressCode: { formality: ['black_tie'] },
      });

      expect(result.sufficiency).toBe('none');
      expect(result.gapDescriptions).toEqual(['black_tie bottom', 'black_tie shoes']);
    });
  });

  describe('Prompt Invariants & Schema Verification', () => {
    it('verifies buildSystemPrompt contains Two-Suggestion Rule and concrete gap instructions', () => {
      const promptEn = buildSystemPrompt('en', false, []);
      expect(promptEn).toContain('TWO-SUGGESTION RULE');
      expect(promptEn).toContain('Propose up to 2 distinct ranked outfits');
      expect(promptEn).toContain('GAP ANALYSIS & CONCRETE DESCRIPTIONS');
      expect(promptEn).toContain('navy formal tailored trousers');

      const promptAr = buildSystemPrompt('ar', false, []);
      expect(promptAr).toContain('TWO-SUGGESTION RULE');
      expect(promptAr).toContain('Arabic');
    });

    it('verifies COMPOSE_RESPONSE_SCHEMA includes gapDescriptions', () => {
      expect(COMPOSE_RESPONSE_SCHEMA.properties.gapDescriptions).toEqual({
        type: 'ARRAY',
        items: { type: 'STRING' },
      });
    });
  });
});
