import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import WardrobeItem from '../../src/modules/wardrobe/wardrobe-item.model.js';
import { backfillWardrobeAttributes } from '../../scripts/backfill-wardrobe-attributes.js';

describe('Backfill Wardrobe Attributes Script Unit Tests', () => {
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

  it('should backfill missing attributes and run idempotently (0 changes on 2nd run)', async () => {
    // 1. Insert raw items without the new fields using collection.insertOne to bypass Mongoose schema defaults
    const item1Id = new mongoose.Types.ObjectId();
    const item2Id = new mongoose.Types.ObjectId();

    await WardrobeItem.collection.insertMany([
      {
        _id: item1Id,
        userId: mockUserId,
        imageUrl: 'https://res.cloudinary.com/test1.jpg',
        category: 'top',
        primaryColor: 'White',
      },
      {
        _id: item2Id,
        userId: mockUserId,
        imageUrl: 'https://res.cloudinary.com/test2.jpg',
        category: 'bottom',
        primaryColor: 'Red',
      },
    ]);

    // 2. First backfill run: should process and update both items
    const firstRun = await backfillWardrobeAttributes();
    expect(firstRun.processed).toBe(2);
    expect(firstRun.updated).toBe(2);

    const doc1 = await WardrobeItem.findById(item1Id);
    expect(doc1.isArchived).toBe(false);
    expect(doc1.wearCount).toBe(0);
    expect(doc1.origin).toBe('upload');
    expect(doc1.genderPresentation).toBe('unisex');
    expect(doc1.aiPromptVersion).toBe('legacy');
    expect(doc1.isNeutral).toBe(true); // White is neutral

    const doc2 = await WardrobeItem.findById(item2Id);
    expect(doc2.isNeutral).toBe(false); // Red is not neutral

    // 3. Second backfill run: should find 0 documents requiring backfill (idempotency check)
    const secondRun = await backfillWardrobeAttributes();
    expect(secondRun.processed).toBe(0);
    expect(secondRun.updated).toBe(0);
  });
});
