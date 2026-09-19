import '../../src/common/globals.js';
import {
  extractCandidateIdSet,
  validateOutfitItemIds,
  buildCorrectivePrompt,
} from '../../src/modules/ai/stylist/outfit.validator.js';

describe('Unit — AI Anti-Hallucination Gate (outfit.validator.js)', () => {
  const candidateMap = {
    top: [{ _id: 'item_top_1', name: 'White Shirt' }],
    bottom: [{ _id: 'item_bottom_1', name: 'Black Trousers' }],
    shoes: [{ _id: 'item_shoes_1', name: 'Leather Loafers' }],
  };

  const candidateArray = [
    { _id: 'item_top_1' },
    { _id: 'item_bottom_1' },
    { _id: 'item_shoes_1' },
  ];

  describe('1. extractCandidateIdSet', () => {
    it('extracts ID strings from categorized candidate slot map', () => {
      const set = extractCandidateIdSet(candidateMap);
      expect(set.size).toBe(3);
      expect(set.has('item_top_1')).toBe(true);
      expect(set.has('item_bottom_1')).toBe(true);
      expect(set.has('item_shoes_1')).toBe(true);
    });

    it('extracts ID strings from flat candidate array', () => {
      const set = extractCandidateIdSet(candidateArray);
      expect(set.size).toBe(3);
      expect(set.has('item_top_1')).toBe(true);
    });

    it('passes through Set instance directly', () => {
      const existingSet = new Set(['id1', 'id2']);
      expect(extractCandidateIdSet(existingSet)).toBe(existingSet);
    });

    it('handles null, undefined, or empty candidates gracefully', () => {
      expect(extractCandidateIdSet(null).size).toBe(0);
      expect(extractCandidateIdSet(undefined).size).toBe(0);
      expect(extractCandidateIdSet({}).size).toBe(0);
    });
  });

  describe('2. validateOutfitItemIds', () => {
    it('returns valid: true when all outfit items exist in candidates', () => {
      const outfits = [
        { itemIds: ['item_top_1', 'item_bottom_1', 'item_shoes_1'], rationale: 'Looks good' },
      ];

      const result = validateOutfitItemIds(outfits, candidateMap);

      expect(result.valid).toBe(true);
      expect(result.invalidIds).toEqual([]);
      expect(result.verifiedOutfits).toEqual(outfits);
    });

    it('returns valid: false and captures hallucinated IDs when foreign IDs are found', () => {
      const outfits = [
        {
          itemIds: ['item_top_1', 'hallucinated_item_999', 'item_shoes_1'],
          rationale: 'Mixed outfit',
        },
      ];

      const result = validateOutfitItemIds(outfits, candidateMap);

      expect(result.valid).toBe(false);
      expect(result.invalidIds).toEqual(['hallucinated_item_999']);
      expect(result.verifiedOutfits).toEqual([]);
    });

    it('deduplicates invalid IDs if repeated across multiple outfits', () => {
      const outfits = [
        { itemIds: ['forged_id_1', 'item_top_1'] },
        { itemIds: ['forged_id_1', 'forged_id_2'] },
      ];

      const result = validateOutfitItemIds(outfits, candidateMap);

      expect(result.valid).toBe(false);
      expect(result.invalidIds).toEqual(['forged_id_1', 'forged_id_2']);
    });

    it('handles empty or null outfits without errors', () => {
      expect(validateOutfitItemIds([], candidateMap)).toEqual({
        valid: true,
        invalidIds: [],
        verifiedOutfits: [],
      });

      expect(validateOutfitItemIds(null, candidateMap)).toEqual({
        valid: true,
        invalidIds: [],
        verifiedOutfits: [],
      });
    });

    it('flags empty or missing itemId entries as invalid', () => {
      const outfits = [{ itemIds: ['item_top_1', '', null] }];
      const result = validateOutfitItemIds(outfits, candidateMap);

      expect(result.valid).toBe(false);
      expect(result.invalidIds).toContain('empty_or_null_id');
    });
  });

  describe('3. buildCorrectivePrompt', () => {
    it('constructs a targeted corrective prompt with invalid and permitted IDs', () => {
      const invalidIds = ['hallucinated_123'];
      const prompt = buildCorrectivePrompt(invalidIds, candidateMap);

      expect(prompt).toContain('CORRECTION REQUIRED');
      expect(prompt).toContain('hallucinated_123');
      expect(prompt).toContain('item_top_1');
      expect(prompt).toContain('item_bottom_1');
      expect(prompt).toContain('item_shoes_1');
    });
  });
});
