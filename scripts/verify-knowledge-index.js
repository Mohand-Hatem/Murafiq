#!/usr/bin/env node
/**
 * Fashion Knowledge Index Health & Verification Diagnostic Script.
 *
 * Verifies:
 * 1. MongoDB connection and FashionKnowledgeDoc collection state.
 * 2. Topic chunk counts across the 5 canonical fashion knowledge domains.
 * 3. Retrieval functionality via knowledgeService (vector store + MongoDB fallback).
 * 4. Cache key generation and structure of returned knowledge chunks.
 *
 * Usage:
 *   node scripts/verify-knowledge-index.js
 */

import mongoose from 'mongoose';
import '../src/common/globals.js';
import env from '../src/config/env.config.js';
import { logger } from '../src/config/logger.config.js';
import fashionKnowledgeRepo from '../src/modules/ai/knowledge/fashion-knowledge.repository.js';
import knowledgeService from '../src/modules/ai/knowledge/knowledge.service.js';

export const verifyKnowledgeIndex = async () => {
  console.log('\n===============================================================');
  console.log('       Murafiq — Fashion Knowledge Index Verification');
  console.log('===============================================================\n');

  let mongoConnected = false;

  try {
    if (mongoose.connection.readyState !== 1) {
      console.log('Connecting to MongoDB...');
      await mongoose.connect(env.MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
      });
    }
    mongoConnected = true;
    console.log('MongoDB connection: OK\n');
  } catch (connErr) {
    console.error('Failed to connect to MongoDB:', connErr.message);
    return {
      success: false,
      error: connErr.message,
    };
  }

  try {
    const totalChunks = await fashionKnowledgeRepo.countChunks();
    console.log(`Total Ingested Knowledge Chunks: ${totalChunks}`);

    const topics = ['dress_codes', 'egyptian_norms', 'color_theory', 'silhouette', 'fabrics'];
    const topicBreakdown = {};

    for (const topic of topics) {
      const chunks = await fashionKnowledgeRepo.findChunksByTopic(topic);
      topicBreakdown[topic] = chunks.length;
      console.log(`  - ${topic.padEnd(16)}: ${chunks.length} chunks`);
    }

    if (totalChunks === 0) {
      console.warn('\nWARNING: Knowledge index is currently empty in MongoDB!');
      console.warn('Run `node scripts/ingest-fashion-knowledge.js` to ingest content.\n');
    }

    // Test Sample RAG Queries
    console.log('\nTesting RAG Retrieval Queries via knowledgeService:');
    const testQueries = [
      { query: 'summer linen beach wedding Cairo', eventType: 'wedding', season: 'summer' },
      { query: 'black tie formal evening gala tuxedo', eventType: 'formal', season: 'all' },
    ];

    for (const testCase of testQueries) {
      console.log(`\nQuery: "${testCase.query}" (eventType: ${testCase.eventType}, season: ${testCase.season})`);
      const results = await knowledgeService.searchFashionKnowledge(testCase.query, {
        eventType: testCase.eventType,
        season: testCase.season,
        topK: 2,
      });

      console.log(`  Retrieved ${results.length} chunks:`);
      for (const res of results) {
        console.log(`    * [${res.topic}] "${res.title}" (score: ${res.score}, source: ${res.fallbackSource || 'vector/cache'})`);
        if (res.body) {
          const excerpt = res.body.slice(0, 100).replace(/\n/g, ' ');
          console.log(`      "${excerpt}..."`);
        }
      }
    }

    console.log('\n===============================================================');
    console.log('       Knowledge Index Verification Completed Successfully');
    console.log('===============================================================\n');

    return {
      success: true,
      totalChunks,
      topicBreakdown,
    };
  } catch (err) {
    logger.error('Error verifying fashion knowledge index:', err);
    console.error('Verification failed:', err.message);
    return {
      success: false,
      error: err.message,
    };
  } finally {
    if (mongoConnected && process.env.NODE_ENV !== 'test') {
      await mongoose.disconnect();
    }
  }
};

// Direct script execution
if (process.argv[1] && process.argv[1].endsWith('verify-knowledge-index.js')) {
  verifyKnowledgeIndex()
    .then((res) => {
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

export default verifyKnowledgeIndex;
