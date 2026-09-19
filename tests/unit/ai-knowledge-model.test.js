/**
 * Phase 15D Step 2 — FashionKnowledgeDoc Model & Repository Tests.
 *
 * Covers:
 * 1. Schema fields, types, and defaults.
 * 2. Topic enum constraint ('dress_codes', 'egyptian_norms', 'color_theory', 'silhouette', 'fabrics').
 * 3. Compound unique index { slug: 1, chunkIndex: 1 } and vectorId uniqueness.
 * 4. Text search index on { title: 'text', body: 'text' }.
 * 5. Repository functions: upsertChunk, findBySlugAndChunk, findChunksByTopic, countChunks, searchByText.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import FashionKnowledgeDoc, {
  KNOWLEDGE_TOPICS,
} from '../../src/modules/ai/knowledge/fashion-knowledge.model.js';
import fashionKnowledgeRepo from '../../src/modules/ai/knowledge/fashion-knowledge.repository.js';

describe('Phase 15D Step 2 — FashionKnowledgeDoc Model & Repository', () => {
  describe('FashionKnowledgeDoc Model Schema', () => {
    it('defines all required fields and default values', () => {
      const paths = FashionKnowledgeDoc.schema.paths;

      expect(paths.slug).toBeDefined();
      expect(paths.slug.instance).toBe('String');
      expect(paths.slug.isRequired).toBe(true);

      expect(paths.title).toBeDefined();
      expect(paths.title.instance).toBe('String');
      expect(paths.title.isRequired).toBe(true);

      expect(paths.topic).toBeDefined();
      expect(paths.topic.instance).toBe('String');
      expect(paths.topic.isRequired).toBe(true);

      expect(paths.locale).toBeDefined();
      expect(paths.locale.instance).toBe('String');
      expect(paths.locale.defaultValue).toBe('en');

      expect(paths.body).toBeDefined();
      expect(paths.body.instance).toBe('String');
      expect(paths.body.isRequired).toBe(true);

      expect(paths.chunkIndex).toBeDefined();
      expect(paths.chunkIndex.instance).toBe('Number');
      expect(paths.chunkIndex.isRequired).toBe(true);

      expect(paths.promptVersion).toBeDefined();
      expect(paths.promptVersion.instance).toBe('Number');
      expect(paths.promptVersion.defaultValue).toBe(1);

      expect(paths.vectorId).toBeDefined();
      expect(paths.vectorId.instance).toBe('String');
      expect(paths.vectorId.isRequired).toBe(true);
    });

    it('enforces KNOWLEDGE_TOPICS enum correctly', () => {
      expect(KNOWLEDGE_TOPICS).toEqual([
        'dress_codes',
        'egyptian_norms',
        'color_theory',
        'silhouette',
        'fabrics',
      ]);

      const docValid = new FashionKnowledgeDoc({
        slug: 'dress-codes',
        title: 'Black Tie',
        topic: 'dress_codes',
        body: 'Full tuxedo is required.',
        chunkIndex: 0,
        vectorId: 'kb_dress-codes_0',
      });
      expect(docValid.validateSync()).toBeUndefined();

      const docInvalid = new FashionKnowledgeDoc({
        slug: 'dress-codes',
        title: 'Black Tie',
        topic: 'invalid_non_fashion_topic',
        body: 'Full tuxedo is required.',
        chunkIndex: 0,
        vectorId: 'kb_dress-codes_0',
      });
      const err = docInvalid.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.topic).toBeDefined();
    });

    it('defines compound unique index on slug and chunkIndex', () => {
      const indexes = FashionKnowledgeDoc.schema.indexes();
      const compoundIndex = indexes.find(
        ([fields, options]) => fields.slug === 1 && fields.chunkIndex === 1 && options?.unique === true
      );
      expect(compoundIndex).toBeDefined();
    });

    it('defines text index on title and body', () => {
      const indexes = FashionKnowledgeDoc.schema.indexes();
      const textIndex = indexes.find(
        ([fields]) => fields.title === 'text' && fields.body === 'text'
      );
      expect(textIndex).toBeDefined();
    });
  });

  describe('FashionKnowledgeRepository Methods', () => {
    let mockFindOneAndUpdate;
    let mockFindOne;
    let mockFind;
    let mockCountDocuments;

    beforeEach(() => {
      mockFindOneAndUpdate = jest.spyOn(FashionKnowledgeDoc, 'findOneAndUpdate');
      mockFindOne = jest.spyOn(FashionKnowledgeDoc, 'findOne');
      mockFind = jest.spyOn(FashionKnowledgeDoc, 'find');
      mockCountDocuments = jest.spyOn(FashionKnowledgeDoc, 'countDocuments');
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('upsertChunk calls findOneAndUpdate with upsert: true and setDefaultsOnInsert: true', async () => {
      const sampleChunk = {
        slug: 'color-theory',
        title: 'Neutral Foundations',
        topic: 'color_theory',
        body: 'Navy and charcoal anchor outfits.',
        chunkIndex: 0,
        vectorId: 'kb_color-theory_0',
      };

      mockFindOneAndUpdate.mockResolvedValueOnce({ ...sampleChunk, _id: 'doc_123' });

      const result = await fashionKnowledgeRepo.upsertChunk(sampleChunk);

      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        { slug: 'color-theory', chunkIndex: 0 },
        { $set: sampleChunk },
        expect.objectContaining({
          upsert: true,
          returnDocument: 'after',
          setDefaultsOnInsert: true,
        })
      );
      expect(result._id).toBe('doc_123');
    });

    it('findBySlugAndChunk queries by slug and chunkIndex', async () => {
      const leanMock = jest.fn().mockResolvedValueOnce({
        slug: 'silhouette-layering',
        chunkIndex: 2,
        title: 'Volume Contrast',
      });
      mockFindOne.mockReturnValueOnce({ lean: leanMock });

      const result = await fashionKnowledgeRepo.findBySlugAndChunk('silhouette-layering', 2);

      expect(mockFindOne).toHaveBeenCalledWith({ slug: 'silhouette-layering', chunkIndex: 2 });
      expect(result.title).toBe('Volume Contrast');
    });

    it('findChunksByTopic sorts by chunkIndex ascending', async () => {
      const leanMock = jest.fn().mockResolvedValueOnce([
        { chunkIndex: 0, title: 'Chunk 0' },
        { chunkIndex: 1, title: 'Chunk 1' },
      ]);
      const sortMock = jest.fn().mockReturnValueOnce({ lean: leanMock });
      mockFind.mockReturnValueOnce({ sort: sortMock });

      const result = await fashionKnowledgeRepo.findChunksByTopic('fabrics');

      expect(mockFind).toHaveBeenCalledWith({ topic: 'fabrics' });
      expect(sortMock).toHaveBeenCalledWith({ chunkIndex: 1 });
      expect(result).toHaveLength(2);
    });

    it('countChunks delegates to FashionKnowledgeDoc.countDocuments', async () => {
      mockCountDocuments.mockResolvedValueOnce(25);

      const count = await fashionKnowledgeRepo.countChunks({ topic: 'dress_codes' });

      expect(mockCountDocuments).toHaveBeenCalledWith({ topic: 'dress_codes' });
      expect(count).toBe(25);
    });

    it('searchByText falls back to regex matching on title and body', async () => {
      const leanMock = jest.fn().mockResolvedValueOnce([
        { title: 'Egyptian Linen', body: 'Breathable flax linen.' },
      ]);
      const limitMock = jest.fn().mockReturnValueOnce({ lean: leanMock });
      // Simulate text search failure to trigger regex fallback
      mockFind.mockImplementationOnce(() => {
        throw new Error('No text index on mock');
      });
      mockFind.mockReturnValueOnce({ limit: limitMock });

      const results = await fashionKnowledgeRepo.searchByText('linen summer', {
        topic: 'fabrics',
        limit: 2,
      });

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Egyptian Linen');
    });
  });
});
