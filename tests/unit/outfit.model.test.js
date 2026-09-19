import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import Outfit from '../../src/modules/ai/outfits/outfit.model.js';
import * as outfitService from '../../src/modules/ai/outfits/outfit.service.js';

describe('Outfit Model & Service (Unit)', () => {
  const userId = new mongoose.Types.ObjectId();
  const otherUserId = new mongoose.Types.ObjectId();
  const item1Id = new mongoose.Types.ObjectId();
  const item2Id = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    await connectTestDB();
    await Outfit.init();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    await Outfit.init();
  });

  describe('Architectural Invariants & Schema Verification', () => {
    it('CRITICAL: Outfit schema MUST NOT have visualizationUrl (reserved for Phase 15F TryOnGeneration)', () => {
      expect(Outfit.schema.paths.visualizationUrl).toBeUndefined();
    });

    it('has compound index on { userId: 1, createdAt: -1 }', () => {
      const indexes = Outfit.schema.indexes();
      const hasCompoundIndex = indexes.some(([fields]) => {
        return fields.userId === 1 && fields.createdAt === -1;
      });
      expect(hasCompoundIndex).toBe(true);
    });

    it('requires userId', async () => {
      const outfit = new Outfit({
        items: [item1Id],
      });
      let err;
      try {
        await outfit.validate();
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      expect(err.errors.userId).toBeDefined();
    });

    it('defaults source to wardrobe and userFeedback to null', async () => {
      const outfit = await Outfit.create({
        userId,
        items: [item1Id, item2Id],
        rationale: 'Classic smart casual outfit',
      });

      expect(outfit.source).toBe('wardrobe');
      expect(outfit.userFeedback).toBeNull();
      expect(outfit.promptVersion).toBe('v1.0.0');
    });

    it('rejects invalid userFeedback enum', async () => {
      const outfit = new Outfit({
        userId,
        items: [item1Id],
        userFeedback: 'love_it_so_much',
      });
      let err;
      try {
        await outfit.validate();
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      expect(err.errors.userFeedback).toBeDefined();
    });
  });

  describe('Outfit Service Operations', () => {
    it('records an outfit with full eventContext and external suggestions', async () => {
      const created = await outfitService.recordOutfit({
        userId,
        items: [item1Id, item2Id],
        anchorItemId: item1Id,
        eventContext: {
          eventType: 'business_meeting',
          formality: ['business', 'smart_casual'],
          season: 'spring',
          timeOfDay: 'morning',
          setting: 'office',
        },
        externalSuggestions: [
          {
            type: 'accessory',
            description: 'Minimalist leather briefcase',
            sourceUrl: 'https://example.com/briefcase',
            sourceTitle: 'Leather Briefcase',
          },
        ],
        rationale: 'Navy blazer paired with tailored trousers and complementary leather accessories.',
        score: 94,
        source: 'wardrobe',
      });

      expect(created._id).toBeDefined();
      expect(created.items.length).toBe(2);
      expect(created.anchorItemId.toString()).toBe(item1Id.toString());
      expect(created.eventContext.eventType).toBe('business_meeting');
      expect(created.externalSuggestions.length).toBe(1);
      expect(created.externalSuggestions[0].sourceTitle).toBe('Leather Briefcase');
      expect(created.score).toBe(94);
    });

    it('getUserOutfits retrieves paginated outfits for the user ordered by recency', async () => {
      await Outfit.create({
        userId,
        items: [item1Id],
        rationale: 'First outfit',
        createdAt: new Date('2026-09-01T10:00:00Z'),
      });
      await Outfit.create({
        userId,
        items: [item2Id],
        rationale: 'Second outfit (newer)',
        createdAt: new Date('2026-09-02T10:00:00Z'),
      });

      const result = await outfitService.getUserOutfits(userId);
      expect(result.total).toBe(2);
      expect(result.items.length).toBe(2);
      expect(result.items[0].rationale).toBe('Second outfit (newer)');
      expect(result.items[1].rationale).toBe('First outfit');
    });

    it('getOutfitById respects user boundary (returns null for non-owner)', async () => {
      const outfit = await Outfit.create({
        userId,
        items: [item1Id],
        rationale: 'Owner only',
      });

      const forOwner = await outfitService.getOutfitById(outfit._id, userId);
      expect(forOwner).toBeDefined();
      expect(forOwner.rationale).toBe('Owner only');

      const forOther = await outfitService.getOutfitById(outfit._id, otherUserId);
      expect(forOther).toBeNull();
    });

    it('setUserFeedback records feedback accurately', async () => {
      const outfit = await Outfit.create({
        userId,
        items: [item1Id],
        rationale: 'Pending feedback',
      });

      const updated = await outfitService.setUserFeedback(outfit._id, userId, 'liked');
      expect(updated.userFeedback).toBe('liked');

      const changedAgain = await outfitService.setUserFeedback(outfit._id, userId, 'disliked');
      expect(changedAgain.userFeedback).toBe('disliked');

      await expect(outfitService.setUserFeedback(outfit._id, userId, 'invalid')).rejects.toThrow(
        'Invalid feedback value'
      );
    });
  });
});
