import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import { evaluateWardrobeCapacity } from '../../src/modules/ai/stylist/preflight.guard.js';
import wardrobeService from '../../src/modules/wardrobe/wardrobe.service.js';
import wardrobeRepo from '../../src/modules/wardrobe/wardrobe.repository.js';

describe('Unit — AI Pre-Flight Guard & Wardrobe Service Hydration (preflight.guard.js)', () => {
  describe('1. evaluateWardrobeCapacity', () => {
    it('returns canCompose: true when all required slots have candidates', () => {
      const candidatesBySlot = {
        top: [{ _id: '1', name: 'White Shirt' }],
        bottom: [{ _id: '2', name: 'Navy Trousers' }],
        shoes: [{ _id: '3', name: 'Oxford Shoes' }],
        outerwear: [],
      };

      const result = evaluateWardrobeCapacity(candidatesBySlot, ['top', 'bottom', 'shoes']);

      expect(result.canCompose).toBe(true);
      expect(result.missingSlots).toEqual([]);
      expect(result.totalCandidates).toBe(3);
    });

    it('returns canCompose: false and flags missing slot when shoes are missing', () => {
      const candidatesBySlot = {
        top: [{ _id: '1' }],
        bottom: [{ _id: '2' }],
        shoes: [],
      };

      const result = evaluateWardrobeCapacity(candidatesBySlot, ['top', 'bottom', 'shoes']);

      expect(result.canCompose).toBe(false);
      expect(result.missingSlots).toEqual(['shoes']);
      expect(result.totalCandidates).toBe(2);
    });

    it('returns canCompose: false for completely empty wardrobe', () => {
      const result = evaluateWardrobeCapacity({}, ['top', 'bottom', 'shoes']);

      expect(result.canCompose).toBe(false);
      expect(result.missingSlots).toEqual(['top', 'bottom', 'shoes']);
      expect(result.totalCandidates).toBe(0);
    });

    it('allows dress to satisfy top and bottom requirements', () => {
      const candidatesBySlot = {
        top: [],
        bottom: [],
        dress: [{ _id: '4', name: 'Evening Gown' }],
        shoes: [{ _id: '3', name: 'Heels' }],
      };

      const result = evaluateWardrobeCapacity(candidatesBySlot, ['top', 'bottom', 'shoes']);

      expect(result.canCompose).toBe(true);
      expect(result.hasDress).toBe(true);
      expect(result.missingSlots).toEqual([]);
    });

    it('flags missing shoes even when dress is present', () => {
      const candidatesBySlot = {
        top: [],
        bottom: [],
        dress: [{ _id: '4', name: 'Evening Gown' }],
        shoes: [],
      };

      const result = evaluateWardrobeCapacity(candidatesBySlot, ['top', 'bottom', 'shoes']);

      expect(result.canCompose).toBe(false);
      expect(result.hasDress).toBe(true);
      expect(result.missingSlots).toEqual(['shoes']);
    });
  });

  describe('2. wardrobeService.getWardrobeItemsByIds', () => {
    it('returns empty array when itemIds is empty or not an array', async () => {
      expect(await wardrobeService.getWardrobeItemsByIds('user1', [])).toEqual([]);
      expect(await wardrobeService.getWardrobeItemsByIds('user1', null)).toEqual([]);
      expect(await wardrobeService.getWardrobeItemsByIds('user1', undefined)).toEqual([]);
    });

    it('delegates to wardrobeRepo.findItemsByIds with userId and itemIds', async () => {
      const mockItems = [{ _id: 'item1', name: 'Black Blazer' }];
      const spy = jest.spyOn(wardrobeRepo, 'findItemsByIds').mockResolvedValueOnce(mockItems);

      const res = await wardrobeService.getWardrobeItemsByIds('user_123', ['item1']);

      expect(spy).toHaveBeenCalledWith('user_123', ['item1']);
      expect(res).toEqual(mockItems);

      spy.mockRestore();
    });
  });
});
