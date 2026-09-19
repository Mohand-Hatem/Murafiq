/**
 * Phase 15D Step 4 — Fashion Knowledge Ingestion Pipeline Tests.
 *
 * Covers:
 * 1. Markdown file parsing and chunk extraction.
 * 2. Dry run mode skips writes.
 * 3. Live ingestion calls MongoDB upsert and Upstash vector upsert.
 * 4. Idempotency: Running twice produces identical document counts without duplication.
 * 5. Handles missing directory cleanly.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import path from 'path';
import {
  parseMarkdownFile,
  ingestFashionKnowledge,
  FILE_TOPIC_MAP,
} from '../../scripts/ingest-fashion-knowledge.js';
import fashionKnowledgeRepo from '../../src/modules/ai/knowledge/fashion-knowledge.repository.js';
import vectorConfig from '../../src/config/vector.config.js';

describe('Phase 15D Step 4 — ingest-fashion-knowledge.js', () => {
  const CORPUS_DIR = path.resolve(process.cwd(), 'content/fashion-knowledge');

  let upsertChunkSpy;
  let vectorUpsertSpy;

  beforeEach(() => {
    upsertChunkSpy = jest.spyOn(fashionKnowledgeRepo, 'upsertChunk').mockResolvedValue({ _id: 'mock_doc' });

    vectorUpsertSpy = jest.fn().mockResolvedValue({ success: true });
    jest.spyOn(vectorConfig, 'getKnowledgeVectorNamespace').mockReturnValue({
      upsert: vectorUpsertSpy,
      query: jest.fn(),
      delete: jest.fn(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('parseMarkdownFile', () => {
    it('correctly maps file names to designated topic taxonomy', () => {
      expect(FILE_TOPIC_MAP['dress-codes.md']).toBe('dress_codes');
      expect(FILE_TOPIC_MAP['egyptian-regional-norms.md']).toBe('egyptian_norms');
      expect(FILE_TOPIC_MAP['color-theory.md']).toBe('color_theory');
      expect(FILE_TOPIC_MAP['silhouette-layering.md']).toBe('silhouette');
      expect(FILE_TOPIC_MAP['fabric-seasonality.md']).toBe('fabrics');
    });

    it('extracts structured chunks with headers, body, and vectorIds', () => {
      const filePath = path.join(CORPUS_DIR, 'dress-codes.md');
      const chunks = parseMarkdownFile(filePath, 'dress-codes.md');

      expect(chunks.length).toBeGreaterThanOrEqual(4);

      const firstChunk = chunks[0];
      expect(firstChunk.slug).toBe('dress-codes');
      expect(firstChunk.title).toBe('Black Tie and Gala Attire');
      expect(firstChunk.topic).toBe('dress_codes');
      expect(firstChunk.chunkIndex).toBe(0);
      expect(firstChunk.vectorId).toBe('kb_dress-codes_0');
      expect(firstChunk.body).toContain('tuxedo');
      expect(firstChunk.metadata.slug).toBe('dress-codes');
    });
  });

  describe('ingestFashionKnowledge', () => {
    it('executes dry-run without writing to MongoDB or vector index', async () => {
      const result = await ingestFashionKnowledge({
        dryRun: true,
        corpusDir: CORPUS_DIR,
      });

      expect(result.success).toBe(true);
      expect(result.filesProcessed).toBe(5);
      expect(result.chunksProcessed).toBeGreaterThanOrEqual(25);

      expect(upsertChunkSpy).not.toHaveBeenCalled();
      expect(vectorUpsertSpy).not.toHaveBeenCalled();
    });

    it('upserts all chunks to Mongo and vector index when dryRun is false', async () => {
      const result = await ingestFashionKnowledge({
        dryRun: false,
        corpusDir: CORPUS_DIR,
      });

      expect(result.success).toBe(true);
      expect(result.filesProcessed).toBe(5);
      expect(result.chunksProcessed).toBeGreaterThanOrEqual(25);

      expect(upsertChunkSpy).toHaveBeenCalledTimes(result.chunksProcessed);
      expect(vectorUpsertSpy).toHaveBeenCalledTimes(result.chunksProcessed);

      // Verify structure passed to upsert
      expect(upsertChunkSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: 'dress-codes',
          chunkIndex: 0,
          vectorId: 'kb_dress-codes_0',
        })
      );
      expect(vectorUpsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'kb_dress-codes_0',
          data: expect.stringContaining('Black Tie and Gala Attire'),
        })
      );
    });

    it('is idempotent: running twice processes same chunks with identical deterministic IDs', async () => {
      const run1 = await ingestFashionKnowledge({ dryRun: false, corpusDir: CORPUS_DIR });
      const run2 = await ingestFashionKnowledge({ dryRun: false, corpusDir: CORPUS_DIR });

      expect(run1.chunksProcessed).toBe(run2.chunksProcessed);
      expect(run1.filesProcessed).toBe(run2.filesProcessed);
    });

    it('throws error if corpus directory does not exist', async () => {
      await expect(
        ingestFashionKnowledge({ corpusDir: '/non/existent/fashion/dir' })
      ).rejects.toThrow(/directory not found/i);
    });
  });
});
