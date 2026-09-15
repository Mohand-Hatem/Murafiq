#!/usr/bin/env node
/**
 * Phase 15D Step 4 — Fashion Knowledge Ingestion Pipeline.
 *
 * Reads editorial markdown files from content/fashion-knowledge/,
 * extracts structured chunk documents, upserts into MongoDB
 * (FashionKnowledgeDoc), and indexes vectors into Upstash KB vector store.
 *
 * Idempotent: running multiple times updates records in place without duplicates.
 *
 * Usage:
 *   node scripts/ingest-fashion-knowledge.js
 *   node scripts/ingest-fashion-knowledge.js --dry-run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import '../src/common/globals.js';
import env from '../src/config/env.config.js';
import { logger } from '../src/config/logger.config.js';
import fashionKnowledgeRepo from '../src/modules/ai/knowledge/fashion-knowledge.repository.js';
import vectorConfig from '../src/config/vector.config.js';

export const FILE_TOPIC_MAP = {
  'dress-codes.md': 'dress_codes',
  'egyptian-regional-norms.md': 'egyptian_norms',
  'color-theory.md': 'color_theory',
  'silhouette-layering.md': 'silhouette',
  'fabric-seasonality.md': 'fabrics',
};

const DEFAULT_CORPUS_DIR = path.resolve(process.cwd(), 'content/fashion-knowledge');

/**
 * Parse an editorial markdown file into discrete chunks by '## ' headings.
 *
 * @param {string} filePath
 * @param {string} fileName
 * @returns {Array<Object>}
 */
export const parseMarkdownFile = (filePath, fileName) => {
  const content = fs.readFileSync(filePath, 'utf-8');
  const slug = path.basename(fileName, '.md');
  const topic = FILE_TOPIC_MAP[fileName] || 'dress_codes';

  // Split on '## ' sections
  const rawSections = content.split(/^##\s+/m);
  const chunks = [];

  // Skip index 0 which contains '# Document Title'
  for (let i = 1; i < rawSections.length; i += 1) {
    const section = rawSections[i].trim();
    if (!section) continue;

    const firstLineEnd = section.indexOf('\n');
    const title = firstLineEnd !== -1 ? section.slice(0, firstLineEnd).trim() : section;
    const body = firstLineEnd !== -1 ? section.slice(firstLineEnd + 1).trim() : '';

    const chunkIndex = i - 1;
    const vectorId = `kb_${slug}_${chunkIndex}`;

    chunks.push({
      slug,
      title,
      topic,
      locale: 'en',
      body,
      chunkIndex,
      promptVersion: 1,
      vectorId,
      metadata: {
        slug,
        title,
        topic,
        chunkIndex,
        bodySnippet: body.slice(0, 200),
      },
    });
  }

  return chunks;
};

/**
 * Ingest fashion knowledge corpus into MongoDB and Upstash KB Vector Store.
 *
 * @param {Object} [options={}]
 * @param {boolean} [options.dryRun=false]
 * @param {string} [options.corpusDir]
 * @returns {Promise<{ filesProcessed: number, chunksProcessed: number, success: boolean }>}
 */
export const ingestFashionKnowledge = async ({
  dryRun = false,
  corpusDir = DEFAULT_CORPUS_DIR,
} = {}) => {
  if (!fs.existsSync(corpusDir)) {
    throw new Error(`Fashion knowledge corpus directory not found: ${corpusDir}`);
  }

  const files = fs.readdirSync(corpusDir).filter((f) => f.endsWith('.md'));
  let totalChunks = 0;
  let filesProcessed = 0;

  logger.info(`[FashionKB] Starting ingestion from ${corpusDir} (files: ${files.length}, dryRun: ${dryRun})`);

  for (const file of files) {
    const filePath = path.join(corpusDir, file);
    const chunks = parseMarkdownFile(filePath, file);

    for (const chunk of chunks) {
      totalChunks += 1;

      if (!dryRun) {
        // 1. Source of truth: Upsert to MongoDB
        await fashionKnowledgeRepo.upsertChunk(chunk);

        // 2. Vector indexing: Upsert to topic namespace
        const vectorNamespace = vectorConfig.getKnowledgeVectorNamespace(chunk.topic);
        await vectorNamespace.upsert({
          id: chunk.vectorId,
          data: `${chunk.title}\n\n${chunk.body}`,
          metadata: {
            slug: chunk.slug,
            title: chunk.title,
            topic: chunk.topic,
            chunkIndex: chunk.chunkIndex,
            body: chunk.body,
          },
        });
      }
    }

    filesProcessed += 1;
    logger.info(`[FashionKB] Processed ${file}: ${chunks.length} chunks`);
  }

  logger.info(
    `[FashionKB] Ingestion complete: ${filesProcessed} files, ${totalChunks} chunks processed.`
  );

  return {
    filesProcessed,
    chunksProcessed: totalChunks,
    success: true,
  };
};

// CLI Execution Entrypoint
const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const isDryRun = process.argv.includes('--dry-run');

  (async () => {
    try {
      if (!isDryRun && mongoose.connection.readyState === 0) {
        await mongoose.connect(env.MONGO_URI);
        logger.info('[FashionKB] Connected to MongoDB');
      }

      const result = await ingestFashionKnowledge({ dryRun: isDryRun });
      console.log(`\nFashion Knowledge Ingestion Successful!`);
      console.log(`Files Processed: ${result.filesProcessed}`);
      console.log(`Chunks Processed: ${result.chunksProcessed}`);
      console.log(`Dry Run: ${isDryRun}\n`);

      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
      process.exit(0);
    } catch (err) {
      logger.error('[FashionKB] Ingestion failed:', err);
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
      process.exit(1);
    }
  })();
}

export default ingestFashionKnowledge;
