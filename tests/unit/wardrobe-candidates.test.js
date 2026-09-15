import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import WardrobeItem from '../../src/modules/wardrobe/wardrobe-item.model.js';
import * as wardrobeService from '../../src/modules/wardrobe/wardrobe.service.js';

describe('Wardrobe Slot Candidates Retrieval (Unit)', () => {
  const userA = new mongoose.Types.ObjectId();
  const userB = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    await connectTestDB();
    await WardrobeItem.init();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    await WardrobeItem.init();
  });

  describe('Slot Candidate Retrieval & Filtering', () => {
    it('retrieves compact candidates grouped by slot, excluding archived and non-done items', async () => {
      // Seed user A items
      await WardrobeItem.create([
        // 1. Valid done top
        {
          userId: userA,
          imageUrl: 'https://cloudinary.com/top1.jpg',
          category: 'top',
          subcategory: 'dress shirt',
          primaryColor: 'White',
          colorFamily: 'white',
          formality: 'formal',
          season: ['spring', 'fall'],
          classificationStatus: 'done',
          isArchived: false,
          genderPresentation: 'masculine',
        },
        // 2. Archived top (must be excluded)
        {
          userId: userA,
          imageUrl: 'https://cloudinary.com/top2.jpg',
          category: 'top',
          subcategory: 'silk shirt',
          primaryColor: 'Blue',
          colorFamily: 'blue',
          formality: 'formal',
          season: ['spring'],
          classificationStatus: 'done',
          isArchived: true,
          genderPresentation: 'masculine',
        },
        // 3. Pending top (must be excluded)
        {
          userId: userA,
          imageUrl: 'https://cloudinary.com/top3.jpg',
          category: 'top',
          classificationStatus: 'pending',
          isArchived: false,
        },
        // 4. Valid done bottom
        {
          userId: userA,
          imageUrl: 'https://cloudinary.com/bottom1.jpg',
          category: 'bottom',
          subcategory: 'trousers',
          primaryColor: 'Black',
          colorFamily: 'black',
          formality: 'formal',
          season: ['all_season'],
          classificationStatus: 'done',
          isArchived: false,
          genderPresentation: 'unisex',
        },
        // 5. Valid done shoes
        {
          userId: userA,
          imageUrl: 'https://cloudinary.com/shoes1.jpg',
          category: 'shoes',
          subcategory: 'oxfords',
          primaryColor: 'Brown',
          colorFamily: 'brown',
          formality: 'formal',
          season: ['all_season'],
          classificationStatus: 'done',
          isArchived: false,
          genderPresentation: 'masculine',
        },
        // User B items (must be isolated)
        {
          userId: userB,
          imageUrl: 'https://cloudinary.com/userB_top.jpg',
          category: 'top',
          subcategory: 'polo',
          primaryColor: 'Red',
          formality: 'formal',
          season: ['spring'],
          classificationStatus: 'done',
          isArchived: false,
          genderPresentation: 'masculine',
        },
      ]);

      const result = await wardrobeService.getWardrobeCandidates(userA, {
        slots: ['top', 'bottom', 'shoes'],
        formality: ['formal'],
        season: 'spring',
        genderPresentation: 'masculine',
      });

      expect(result).toHaveProperty('top');
      expect(result).toHaveProperty('bottom');
      expect(result).toHaveProperty('shoes');

      // Top: only 1 valid top (archived and pending excluded, userB excluded)
      expect(result.top.length).toBe(1);
      expect(result.top[0].subcategory).toBe('dress shirt');
      expect(result.top[0].colorFamily).toBe('white');

      // Bottom: 1 valid bottom (matches 'all_season' and 'unisex')
      expect(result.bottom.length).toBe(1);
      expect(result.bottom[0].subcategory).toBe('trousers');

      // Shoes: 1 valid shoes
      expect(result.shoes.length).toBe(1);
      expect(result.shoes[0].subcategory).toBe('oxfords');

      // Compact projection assertion: heavy fields and internals must not be present
      const topItem = result.top[0];
      expect(topItem.imageUrl).toBeUndefined();
      expect(topItem.embeddingId).toBeUndefined();
      expect(topItem.sourceUploadRef).toBeUndefined();
      expect(topItem.aiModel).toBeUndefined();
      expect(topItem.createdAt).toBeUndefined();
      expect(topItem.__v).toBeUndefined();
    });

    it('enforces limitPerSlot cap between 1 and 8 (defaults to 6, max 8)', async () => {
      // Seed 10 tops for user A
      const tops = [];
      for (let i = 0; i < 10; i++) {
        tops.push({
          userId: userA,
          imageUrl: `https://cloudinary.com/top_${i}.jpg`,
          category: 'top',
          subcategory: `shirt_${i}`,
          primaryColor: 'White',
          formality: 'casual',
          classificationStatus: 'done',
          isArchived: false,
        });
      }
      await WardrobeItem.create(tops);

      // Request limitPerSlot 15 -> must be capped at 8
      const cappedResult = await wardrobeService.getWardrobeCandidates(userA, {
        slots: ['top'],
        limitPerSlot: 15,
      });
      expect(cappedResult.top.length).toBe(8);

      // Request default limitPerSlot -> returns 6
      const defaultResult = await wardrobeService.getWardrobeCandidates(userA, {
        slots: ['top'],
      });
      expect(defaultResult.top.length).toBe(6);

      // Request limitPerSlot 3 -> returns 3
      const customResult = await wardrobeService.getWardrobeCandidates(userA, {
        slots: ['top'],
        limitPerSlot: 3,
      });
      expect(customResult.top.length).toBe(3);
    });

    it('filters by season and gender presentation accurately', async () => {
      await WardrobeItem.create([
        {
          userId: userA,
          imageUrl: 'https://cloudinary.com/summer_top.jpg',
          category: 'top',
          subcategory: 'linen shirt',
          season: ['summer'],
          genderPresentation: 'masculine',
          classificationStatus: 'done',
          isArchived: false,
        },
        {
          userId: userA,
          imageUrl: 'https://cloudinary.com/winter_top.jpg',
          category: 'top',
          subcategory: 'wool sweater',
          season: ['winter'],
          genderPresentation: 'masculine',
          classificationStatus: 'done',
          isArchived: false,
        },
        {
          userId: userA,
          imageUrl: 'https://cloudinary.com/feminine_top.jpg',
          category: 'top',
          subcategory: 'blouse',
          season: ['summer'],
          genderPresentation: 'feminine',
          classificationStatus: 'done',
          isArchived: false,
        },
      ]);

      // Query summer + masculine
      const summerMasculine = await wardrobeService.getWardrobeCandidates(userA, {
        slots: ['top'],
        season: 'summer',
        genderPresentation: 'masculine',
      });
      expect(summerMasculine.top.length).toBe(1);
      expect(summerMasculine.top[0].subcategory).toBe('linen shirt');

      // Query winter + masculine
      const winterMasculine = await wardrobeService.getWardrobeCandidates(userA, {
        slots: ['top'],
        season: 'winter',
        genderPresentation: 'masculine',
      });
      expect(winterMasculine.top.length).toBe(1);
      expect(winterMasculine.top[0].subcategory).toBe('wool sweater');

      // Query summer + feminine
      const summerFeminine = await wardrobeService.getWardrobeCandidates(userA, {
        slots: ['top'],
        season: 'summer',
        genderPresentation: 'feminine',
      });
      expect(summerFeminine.top.length).toBe(1);
      expect(summerFeminine.top[0].subcategory).toBe('blouse');
    });

    it('maintains strict multi-tenant isolation: user A never sees user B items', async () => {
      await WardrobeItem.create([
        {
          userId: userB,
          imageUrl: 'https://cloudinary.com/userB_item.jpg',
          category: 'top',
          subcategory: 'userB top',
          classificationStatus: 'done',
          isArchived: false,
        },
      ]);

      const result = await wardrobeService.getWardrobeCandidates(userA, {
        slots: ['top'],
      });
      expect(result.top.length).toBe(0);
    });
  });
});
