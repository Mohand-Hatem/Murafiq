/**
 * Phase 15C Step 5 — Wardrobe Match Step Tests (match.step.js).
 *
 * Covers:
 * 1. buildGarmentQueryEn query synthesis.
 * 2. High-confidence match (>= 0.85) sets matched: true.
 * 3. Low-confidence match (< 0.85) stays silent (matched: false).
 * 4. Category prefiltering (cross-category candidates ignored).
 * 5. Custom confidence threshold option.
 * 6. Resilient fail-open error handling.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import '../../src/common/globals.js';
import {
  buildGarmentQueryEn,
  matchWardrobeItem,
} from '../../src/modules/ai/stylist/match.step.js';
import wardrobeService from '../../src/modules/wardrobe/wardrobe.service.js';

describe('Phase 15C Step 5 — match.step.js', () => {
  describe('buildGarmentQueryEn', () => {
    it('constructs descriptive English query from garment analysis', () => {
      const query = buildGarmentQueryEn({
        category: 'top',
        subcategory: 'oxford_shirt',
        colorFamily: 'white',
        pattern: 'striped',
        material: 'cotton',
      });
      expect(query).toBe('white oxford_shirt striped cotton');
    });

    it('omits solid pattern and other material from query', () => {
      const query = buildGarmentQueryEn({
        category: 'bottom',
        subcategory: 'chinos',
        colorFamily: 'navy',
        pattern: 'solid',
        material: 'other',
      });
      expect(query).toBe('navy chinos');
    });

    it('falls back to category when subcategory is null', () => {
      const query = buildGarmentQueryEn({
        category: 'shoes',
        subcategory: null,
        colorFamily: 'brown',
        pattern: 'solid',
        material: 'leather',
      });
      expect(query).toBe('brown shoes leather');
    });

    it('returns empty string for null or invalid analysis', () => {
      expect(buildGarmentQueryEn(null)).toBe('');
      expect(buildGarmentQueryEn(undefined)).toBe('');
      expect(buildGarmentQueryEn({})).toBe('');
    });
  });

  describe('matchWardrobeItem', () => {
    const mockUserId = 'user_match_123';
    let searchSpy;

    beforeEach(() => {
      searchSpy = jest.spyOn(wardrobeService, 'searchWardrobeSemantic');
    });

    afterEach(() => {
      searchSpy.mockRestore();
    });

    it('returns matched: true when semantic similarity is >= 0.85', async () => {
      searchSpy.mockResolvedValueOnce([
        {
          _id: 'item_seeded_top_1',
          category: 'top',
          subcategory: 'linen shirt',
          colorFamily: 'blue',
          aiDescription: 'Blue relaxed summer linen button-down shirt',
          semanticScore: 0.92,
        },
      ]);

      const result = await matchWardrobeItem(mockUserId, {
        category: 'top',
        subcategory: 'linen_shirt',
        colorFamily: 'blue',
        material: 'linen',
      });

      expect(searchSpy).toHaveBeenCalledWith(
        mockUserId,
        expect.stringContaining('blue linen_shirt linen'),
        { topK: 5 }
      );
      expect(result.matched).toBe(true);
      expect(result.itemId).toBe('item_seeded_top_1');
      expect(result.itemName).toBe('linen shirt');
      expect(result.confidence).toBe(0.92);
      expect(result.item).toBeDefined();
    });

    it('stays silent (matched: false) when semantic similarity is < 0.85', async () => {
      searchSpy.mockResolvedValueOnce([
        {
          _id: 'item_loose_match_2',
          category: 'top',
          subcategory: 'polo shirt',
          colorFamily: 'blue',
          aiDescription: 'Light blue cotton polo',
          semanticScore: 0.74,
        },
      ]);

      const result = await matchWardrobeItem(mockUserId, {
        category: 'top',
        subcategory: 'oxford_shirt',
        colorFamily: 'blue',
      });

      expect(result.matched).toBe(false);
      expect(result.itemId).toBeNull();
      expect(result.confidence).toBe(0.74);
      expect(result.item).toBeNull();
    });

    it('ignores candidates from a different category', async () => {
      searchSpy.mockResolvedValueOnce([
        {
          _id: 'item_bottom_1',
          category: 'bottom', // Wrong category!
          subcategory: 'blue chinos',
          semanticScore: 0.95,
        },
      ]);

      const result = await matchWardrobeItem(mockUserId, {
        category: 'top',
        subcategory: 'shirt',
        colorFamily: 'blue',
      });

      expect(result.matched).toBe(false);
      expect(result.itemId).toBeNull();
    });

    it('supports custom confidence threshold option', async () => {
      searchSpy.mockResolvedValueOnce([
        {
          _id: 'item_custom_thresh',
          category: 'shoes',
          subcategory: 'white sneakers',
          semanticScore: 0.78,
        },
      ]);

      const result = await matchWardrobeItem(
        mockUserId,
        { category: 'shoes', subcategory: 'sneakers', colorFamily: 'white' },
        { confidenceThreshold: 0.75 }
      );

      expect(result.matched).toBe(true);
      expect(result.itemId).toBe('item_custom_thresh');
    });

    it('returns matched: false on missing or empty inputs', async () => {
      expect((await matchWardrobeItem(null, { category: 'top' })).matched).toBe(false);
      expect((await matchWardrobeItem(mockUserId, null)).matched).toBe(false);
      expect((await matchWardrobeItem(mockUserId, {})).matched).toBe(false);
    });

    it('fails open to unmatched: false if semantic search throws', async () => {
      searchSpy.mockRejectedValueOnce(new Error('Vector DB connection timeout'));

      const result = await matchWardrobeItem(mockUserId, {
        category: 'top',
        subcategory: 't_shirt',
      });

      expect(result.matched).toBe(false);
      expect(result.itemId).toBeNull();
      expect(result.confidence).toBe(0);
    });
  });
});
