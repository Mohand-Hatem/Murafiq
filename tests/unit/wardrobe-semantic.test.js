import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import WardrobeItem from '../../src/modules/wardrobe/wardrobe-item.model.js';
import * as wardrobeService from '../../src/modules/wardrobe/wardrobe.service.js';
import vectorConfig from '../../src/config/vector.config.js';

describe('Semantic Wardrobe Search (Unit)', () => {
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

  describe('searchWardrobeSemantic Functionality', () => {
    it('returns empty array for falsy, whitespace, or invalid queries without calling vector DB', async () => {
      expect(await wardrobeService.searchWardrobeSemantic(userA, '')).toEqual([]);
      expect(await wardrobeService.searchWardrobeSemantic(userA, '   ')).toEqual([]);
      expect(await wardrobeService.searchWardrobeSemantic(userA, null)).toEqual([]);
      expect(await wardrobeService.searchWardrobeSemantic(userA, undefined)).toEqual([]);
    });

    it('queries vector namespace and hydrates items with semanticScore, preserving ranking', async () => {
      // 1. Create items in MongoDB
      const [item1, item2] = await WardrobeItem.create([
        {
          userId: userA,
          imageUrl: 'https://cloudinary.com/item1.jpg',
          category: 'top',
          subcategory: 'linen shirt',
          aiDescription: 'Lightweight sky blue relaxed linen button-down shirt',
          classificationStatus: 'done',
          isArchived: false,
        },
        {
          userId: userA,
          imageUrl: 'https://cloudinary.com/item2.jpg',
          category: 'bottom',
          subcategory: 'linen trousers',
          aiDescription: 'Beige tailored relaxed summer linen pants',
          classificationStatus: 'done',
          isArchived: false,
        },
      ]);

      // 2. Index items into userA's in-memory vector namespace
      const vectorNs = vectorConfig.getUserVectorNamespace(userA);
      await vectorNs.upsert({
        id: item1._id.toString(),
        data: item1.aiDescription,
        metadata: { category: item1.category },
      });
      await vectorNs.upsert({
        id: item2._id.toString(),
        data: item2.aiDescription,
        metadata: { category: item2.category },
      });

      // 3. Perform semantic search
      const results = await wardrobeService.searchWardrobeSemantic(userA, 'blue linen shirt', { topK: 5 });

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]._id.toString()).toBe(item1._id.toString());
      expect(results[0].subcategory).toBe('linen shirt');
      expect(results[0].semanticScore).toBeDefined();
    });

    it('excludes archived items from semantic search hydration', async () => {
      const archivedItem = await WardrobeItem.create({
        userId: userA,
        imageUrl: 'https://cloudinary.com/archived.jpg',
        category: 'top',
        subcategory: 'vintage polo',
        aiDescription: 'Vintage green cotton polo shirt',
        classificationStatus: 'done',
        isArchived: true,
      });

      const vectorNs = vectorConfig.getUserVectorNamespace(userA);
      await vectorNs.upsert({
        id: archivedItem._id.toString(),
        data: archivedItem.aiDescription,
        metadata: { category: 'top' },
      });

      const results = await wardrobeService.searchWardrobeSemantic(userA, 'vintage green polo');
      expect(results.length).toBe(0);
    });

    it('enforces strict multi-tenant isolation: never hydrates another user items', async () => {
      // User B item
      const itemB = await WardrobeItem.create({
        userId: userB,
        imageUrl: 'https://cloudinary.com/itemB.jpg',
        category: 'top',
        subcategory: 'secret jacket',
        aiDescription: 'User B private designer leather jacket',
        classificationStatus: 'done',
        isArchived: false,
      });

      const vectorNsB = vectorConfig.getUserVectorNamespace(userB);
      await vectorNsB.upsert({
        id: itemB._id.toString(),
        data: itemB.aiDescription,
        metadata: { category: 'top' },
      });

      // User A searches for leather jacket in user A's namespace
      const resultsA = await wardrobeService.searchWardrobeSemantic(userA, 'leather jacket');
      expect(resultsA.length).toBe(0);

      // Even if vector returned user B ID, user A query cannot hydrate it
      const resultsSpoof = await wardrobeService.searchWardrobeSemantic(userA, 'User B private designer', { topK: 5 });
      expect(resultsSpoof.length).toBe(0);
    });
  });

  describe('getMyWardrobe Integration with Semantic Search', () => {
    it('uses semantic search and ID filtering when query.search is present', async () => {
      const item = await WardrobeItem.create({
        userId: userA,
        imageUrl: 'https://cloudinary.com/item.jpg',
        category: 'shoes',
        subcategory: 'sneakers',
        aiDescription: 'White minimalist leather low-top sneakers',
        classificationStatus: 'done',
        isArchived: false,
      });

      const vectorNs = vectorConfig.getUserVectorNamespace(userA);
      await vectorNs.upsert({
        id: item._id.toString(),
        data: item.aiDescription,
        metadata: { category: 'shoes' },
      });

      // Query with search keyword
      const res = await wardrobeService.getMyWardrobe(userA, { search: 'white minimalist sneakers' });
      expect(res.items.length).toBe(1);
      expect(res.items[0]._id.toString()).toBe(item._id.toString());
      expect(res.pagination.total).toBe(1);

      // Query with unmatched search keyword
      const emptyRes = await wardrobeService.getMyWardrobe(userA, { search: 'neon pink space boots' });
      expect(emptyRes.items.length).toBe(0);
      expect(emptyRes.pagination.total).toBe(0);
    });
  });
});
