import '../../src/common/globals.js';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../src/app.js';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import StylePreference from '../../src/modules/ai/preferences/style-preference.model.js';
import Outfit from '../../src/modules/ai/outfits/outfit.model.js';
import AiConversation from '../../src/modules/ai/conversation/ai-conversation.model.js';
import AiMessage from '../../src/modules/ai/conversation/ai-message.model.js';
import WardrobeItem from '../../src/modules/wardrobe/wardrobe-item.model.js';
import * as wardrobeService from '../../src/modules/wardrobe/wardrobe.service.js';
import * as stylePreferenceService from '../../src/modules/ai/preferences/style-preference.service.js';
import * as outfitService from '../../src/modules/ai/outfits/outfit.service.js';
import * as conversationService from '../../src/modules/ai/conversation/ai-conversation.service.js';
import vectorConfig from '../../src/config/vector.config.js';

describe('Phase 15A Integration — Index Verification, Multi-Tenant Isolation & Scope Gates', () => {
  const clientAId = new mongoose.Types.ObjectId();
  const clientBId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    await connectTestDB();
    // Build real indexes on all collections
    await Promise.all([
      StylePreference.init(),
      Outfit.init(),
      AiConversation.init(),
      AiMessage.init(),
      WardrobeItem.init(),
    ]);
  });

  afterAll(async () => {
    await clearTestDB();
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    await Promise.all([
      StylePreference.init(),
      Outfit.init(),
      AiConversation.init(),
      AiMessage.init(),
      WardrobeItem.init(),
    ]);
  });

  describe('1. Real MongoDB Index Verification (getIndexes())', () => {
    it('verifies StylePreference has unique index on userId', async () => {
      const indexes = await StylePreference.collection.getIndexes();
      expect(indexes).toHaveProperty('userId_1');
      expect(indexes.userId_1).toBeDefined();
    });

    it('verifies Outfit has compound index on { userId: 1, createdAt: -1 } and NO visualizationUrl', async () => {
      const indexes = await Outfit.collection.getIndexes();
      expect(indexes).toHaveProperty('userId_1_createdAt_-1');
      expect(Outfit.schema.paths.visualizationUrl).toBeUndefined();
    });

    it('verifies AiConversation has compound index on { userId: 1, lastMessageAt: -1 }', async () => {
      const indexes = await AiConversation.collection.getIndexes();
      expect(indexes).toHaveProperty('userId_1_lastMessageAt_-1');
    });

    it('verifies AiMessage has compound index on { conversationId: 1, createdAt: 1 }', async () => {
      const indexes = await AiMessage.collection.getIndexes();
      expect(indexes).toHaveProperty('conversationId_1_createdAt_1');
    });

    it('verifies WardrobeItem has compound index on { userId: 1, category: 1, formality: 1 }', async () => {
      const indexes = await WardrobeItem.collection.getIndexes();
      expect(indexes).toHaveProperty('userId_1_category_1_formality_1');
    });
  });

  describe('2. Multi-Tenant Isolation: Path A (Slot Candidate Retrieval)', () => {
    it('strictly isolates slot candidate retrieval: Client A queries NEVER return Client B garments', async () => {
      // Seed identical clothes for Client A and Client B
      const [itemA] = await WardrobeItem.create([
        {
          userId: clientAId,
          imageUrl: 'https://res.cloudinary.com/clientA_shirt.jpg',
          category: 'top',
          subcategory: 'linen shirt',
          primaryColor: 'Sky Blue',
          colorFamily: 'blue',
          formality: 'smart_casual',
          season: ['summer'],
          genderPresentation: 'masculine',
          classificationStatus: 'done',
          isArchived: false,
        },
      ]);

      const [itemB] = await WardrobeItem.create([
        {
          userId: clientBId,
          imageUrl: 'https://res.cloudinary.com/clientB_shirt.jpg',
          category: 'top',
          subcategory: 'linen shirt',
          primaryColor: 'Sky Blue',
          colorFamily: 'blue',
          formality: 'smart_casual',
          season: ['summer'],
          genderPresentation: 'masculine',
          classificationStatus: 'done',
          isArchived: false,
        },
      ]);

      // Client A queries
      const candidatesA = await wardrobeService.getWardrobeCandidates(clientAId, {
        slots: ['top'],
        formality: ['smart_casual'],
        season: 'summer',
        genderPresentation: 'masculine',
      });

      expect(candidatesA.top.length).toBe(1);
      expect(candidatesA.top[0]._id.toString()).toBe(itemA._id.toString());
      expect(candidatesA.top.some((i) => i._id.toString() === itemB._id.toString())).toBe(false);

      // Client B queries
      const candidatesB = await wardrobeService.getWardrobeCandidates(clientBId, {
        slots: ['top'],
        formality: ['smart_casual'],
        season: 'summer',
        genderPresentation: 'masculine',
      });

      expect(candidatesB.top.length).toBe(1);
      expect(candidatesB.top[0]._id.toString()).toBe(itemB._id.toString());
      expect(candidatesB.top.some((i) => i._id.toString() === itemA._id.toString())).toBe(false);
    });
  });

  describe('3. Multi-Tenant Isolation: Path B (Semantic Search)', () => {
    it('strictly isolates semantic search: Client A search NEVER returns Client B garments', async () => {
      const [itemA, itemB] = await WardrobeItem.create([
        {
          userId: clientAId,
          imageUrl: 'https://res.cloudinary.com/clientA_suit.jpg',
          category: 'outerwear',
          subcategory: 'blazer',
          aiDescription: 'Client A exclusive tailored navy wool suit blazer',
          classificationStatus: 'done',
          isArchived: false,
        },
        {
          userId: clientBId,
          imageUrl: 'https://res.cloudinary.com/clientB_suit.jpg',
          category: 'outerwear',
          subcategory: 'blazer',
          aiDescription: 'Client B exclusive tailored navy wool suit blazer',
          classificationStatus: 'done',
          isArchived: false,
        },
      ]);

      const vectorNsA = vectorConfig.getUserVectorNamespace(clientAId);
      await vectorNsA.upsert({
        id: itemA._id.toString(),
        data: itemA.aiDescription,
        metadata: { category: 'outerwear' },
      });

      const vectorNsB = vectorConfig.getUserVectorNamespace(clientBId);
      await vectorNsB.upsert({
        id: itemB._id.toString(),
        data: itemB.aiDescription,
        metadata: { category: 'outerwear' },
      });

      // Client A searches for navy blazer
      const resultsA = await wardrobeService.searchWardrobeSemantic(clientAId, 'navy wool blazer');
      expect(resultsA.length).toBe(1);
      expect(resultsA[0]._id.toString()).toBe(itemA._id.toString());
      expect(resultsA[0].aiDescription).toContain('Client A');
      expect(resultsA.some((i) => i._id.toString() === itemB._id.toString())).toBe(false);

      // Client B searches for navy blazer
      const resultsB = await wardrobeService.searchWardrobeSemantic(clientBId, 'navy wool blazer');
      expect(resultsB.length).toBe(1);
      expect(resultsB[0]._id.toString()).toBe(itemB._id.toString());
      expect(resultsB[0].aiDescription).toContain('Client B');
      expect(resultsB.some((i) => i._id.toString() === itemA._id.toString())).toBe(false);
    });
  });

  describe('4. Multi-Tenant Isolation: Outfits, Conversations & Preferences', () => {
    it('isolates outfits, preferences, and conversations across users', async () => {
      // Style Preferences
      await stylePreferenceService.updatePreferences(clientAId, { modestyPreference: 'modest' });
      await stylePreferenceService.updatePreferences(clientBId, { modestyPreference: 'relaxed' });

      const prefA = await stylePreferenceService.getPreferences(clientAId);
      const prefB = await stylePreferenceService.getPreferences(clientBId);
      expect(prefA.modestyPreference).toBe('modest');
      expect(prefB.modestyPreference).toBe('relaxed');

      // Outfits
      const outfitA = await outfitService.recordOutfit({
        userId: clientAId,
        items: [new mongoose.Types.ObjectId()],
        rationale: 'Client A private outfit',
      });

      expect(await outfitService.getOutfitById(outfitA._id, clientAId)).toBeDefined();
      expect(await outfitService.getOutfitById(outfitA._id, clientBId)).toBeNull();

      // Conversations
      const convA = await conversationService.createConversation(clientAId, 'Client A Chat');
      expect(await conversationService.getConversation(convA._id, clientAId)).toBeDefined();
      expect(await conversationService.getConversation(convA._id, clientBId)).toBeNull();
    });
  });

  describe('5. Architectural Guard: No /api/v1/ai Route Mounted in Phase 15A', () => {
    it('returns 404 for any /api/v1/ai endpoint (not mounted until Phase 15B)', async () => {
      const getRes = await request(app).get('/api/v1/ai');
      expect(getRes.status).toBe(404);

      const postRes = await request(app).post('/api/v1/ai');
      expect(postRes.status).toBe(404);

      const chatRes = await request(app).post('/api/v1/ai/chat').send({ prompt: 'style me' });
      expect(chatRes.status).toBe(404);
    });
  });
});
