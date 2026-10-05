import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import WardrobeItem, { CLASSIFICATION_STATUS } from '../../src/modules/wardrobe/wardrobe-item.model.js';
import {
  backfillWardrobeCategories,
  inferCategoryFromGarmentData,
} from '../../scripts/backfill-wardrobe-categories.js';
import vectorConfig from '../../src/config/vector.config.js';

describe('Backfill Wardrobe Categories Script Unit Tests', () => {
  const mockUserId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  describe('inferCategoryFromGarmentData', () => {
    it('infers top clothes from subcategory or description', () => {
      expect(inferCategoryFromGarmentData({ subcategory: 't-shirt' })).toBe('top');
      expect(inferCategoryFromGarmentData({ subcategory: 'blouse' })).toBe('top');
      expect(inferCategoryFromGarmentData({ aiDescription: 'Casual cotton polo shirt' })).toBe('top');
      expect(inferCategoryFromGarmentData({ subcategory: 'blazer' })).toBe('top');
    });

    it('infers bottom clothes from subcategory or description', () => {
      expect(inferCategoryFromGarmentData({ subcategory: 'jeans' })).toBe('bottom');
      expect(inferCategoryFromGarmentData({ subcategory: 'trousers' })).toBe('bottom');
      expect(inferCategoryFromGarmentData({ aiDescription: 'Pleated midi skirt' })).toBe('bottom');
    });

    it('infers dress from gowns, suits, co-ords, or legacy outfit key', () => {
      expect(inferCategoryFromGarmentData({ category: 'outfit' })).toBe('dress');
      expect(inferCategoryFromGarmentData({ subcategory: 'evening gown' })).toBe('dress');
      expect(inferCategoryFromGarmentData({ aiDescription: 'Two-piece matching pantsuit' })).toBe('dress');
    });

    it('infers outerwear from winter coats, puffers, or heavy jackets', () => {
      expect(inferCategoryFromGarmentData({ subcategory: 'puffer' })).toBe('outerwear');
      expect(inferCategoryFromGarmentData({ category: 'winter_heavy' })).toBe('outerwear');
      expect(inferCategoryFromGarmentData({ aiDescription: 'Heavy wool winter coat' })).toBe('outerwear');
    });

    it('infers shoes from footwear keywords', () => {
      expect(inferCategoryFromGarmentData({ subcategory: 'sneakers' })).toBe('shoes');
      expect(inferCategoryFromGarmentData({ aiDescription: 'Leather running shoes' })).toBe('shoes');
    });

    it('infers accessory from bag, watch, hat keywords', () => {
      expect(inferCategoryFromGarmentData({ subcategory: 'handbag' })).toBe('accessory');
      expect(inferCategoryFromGarmentData({ aiDescription: 'Classic leather watch' })).toBe('accessory');
    });

    it('strictly falls back to "others" for unknown or ambiguous items (NEVER "top")', () => {
      expect(inferCategoryFromGarmentData({})).toBe('others');
      expect(inferCategoryFromGarmentData({ subcategory: 'unknown_mystery_item' })).toBe('others');
      expect(inferCategoryFromGarmentData({ aiDescription: 'Unrecognizable textile object' })).toBe('others');
    });
  });

  describe('backfillWardrobeCategories execution', () => {
    it('backfills missing categories, preserves existing dress/outerwear, and is idempotent', async () => {
      const validDressId = new mongoose.Types.ObjectId();
      const validOuterwearId = new mongoose.Types.ObjectId();
      const validTopId = new mongoose.Types.ObjectId();
      const missingCatJeansId = new mongoose.Types.ObjectId();
      const missingCatSneakersId = new mongoose.Types.ObjectId();
      const legacyOutfitId = new mongoose.Types.ObjectId();
      const unknownItemBlankId = new mongoose.Types.ObjectId();

      await WardrobeItem.collection.insertMany([
        // Valid existing items - MUST NOT be changed
        {
          _id: validDressId,
          userId: mockUserId,
          imageUrl: 'https://res.cloudinary.com/dress.jpg',
          category: 'dress',
          subcategory: 'cocktail dress',
        },
        {
          _id: validOuterwearId,
          userId: mockUserId,
          imageUrl: 'https://res.cloudinary.com/outerwear.jpg',
          category: 'outerwear',
          subcategory: 'trench coat',
        },
        {
          _id: validTopId,
          userId: mockUserId,
          imageUrl: 'https://res.cloudinary.com/top.jpg',
          category: 'top',
          subcategory: 'cotton shirt',
        },
        // Items requiring backfill
        {
          _id: missingCatJeansId,
          userId: mockUserId,
          imageUrl: 'https://res.cloudinary.com/jeans.jpg',
          category: null,
          subcategory: 'jeans',
          primaryColor: 'Blue',
        },
        {
          _id: missingCatSneakersId,
          userId: mockUserId,
          imageUrl: 'https://res.cloudinary.com/sneakers.jpg',
          // category omitted
          subcategory: 'sneakers',
          primaryColor: 'White',
        },
        {
          _id: legacyOutfitId,
          userId: mockUserId,
          imageUrl: 'https://res.cloudinary.com/outfit.jpg',
          category: 'outfit', // invalid/legacy category
          subcategory: 'linen suit',
        },
        {
          _id: unknownItemBlankId,
          userId: mockUserId,
          imageUrl: 'https://res.cloudinary.com/unknown.jpg',
          category: null,
          subcategory: null,
          aiDescription: null,
        },
      ]);

      // 1. First run: processes 4 items requiring backfill
      const firstRun = await backfillWardrobeCategories({ syncVector: true });
      expect(firstRun.processed).toBe(4);
      expect(firstRun.updated).toBe(4);

      // Verify untouched items
      const dressDoc = await WardrobeItem.findById(validDressId);
      expect(dressDoc.category).toBe('dress');

      const outerwearDoc = await WardrobeItem.findById(validOuterwearId);
      expect(outerwearDoc.category).toBe('outerwear');

      const topDoc = await WardrobeItem.findById(validTopId);
      expect(topDoc.category).toBe('top');

      // Verify backfilled items
      const jeansDoc = await WardrobeItem.findById(missingCatJeansId);
      expect(jeansDoc.category).toBe('bottom');

      const sneakersDoc = await WardrobeItem.findById(missingCatSneakersId);
      expect(sneakersDoc.category).toBe('shoes');

      const outfitDoc = await WardrobeItem.findById(legacyOutfitId);
      expect(outfitDoc.category).toBe('dress'); // Mapped to dress, not outfit

      const unknownDoc = await WardrobeItem.findById(unknownItemBlankId);
      expect(unknownDoc.category).toBe('others'); // Fallback to others, never top!
      expect(unknownDoc.classificationStatus).toBe(CLASSIFICATION_STATUS.NEEDS_REVIEW);

      // Verify vector namespace has synced metadata
      const vectorNs = vectorConfig.getUserVectorNamespace(mockUserId);
      const queriedSneakers = await vectorNs.query({ topK: 10 });
      const sneakerVec = queriedSneakers.find((v) => v.id === missingCatSneakersId.toString());
      expect(sneakerVec).toBeDefined();
      expect(sneakerVec.metadata.category).toBe('shoes');

      // 2. Second run: idempotency check
      const secondRun = await backfillWardrobeCategories({ syncVector: true });
      expect(secondRun.processed).toBe(0);
      expect(secondRun.updated).toBe(0);
    });
  });
});
