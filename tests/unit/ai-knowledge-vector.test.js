/**
 * Phase 15D Step 3 — Knowledge Vector Store & Namespace Isolation Tests.
 *
 * Covers:
 * 1. getKnowledgeVectorIndex configuration and exports.
 * 2. getKnowledgeVectorNamespace provides topic-isolated vector operations.
 * 3. In-memory mock works reliably offline in test environment.
 * 4. Isolation: Chunks stored under 'dress_codes' are never returned in 'fabrics'.
 * 5. Cross-system isolation: Knowledge vectors never leak into user wardrobe vector namespaces.
 */

import { describe, it, expect } from '@jest/globals';
import {
  getKnowledgeVectorIndex,
  getKnowledgeVectorNamespace,
  getUserVectorNamespace,
} from '../../src/config/vector.config.js';

describe('Phase 15D Step 3 — Knowledge Vector Configuration', () => {
  it('exports getKnowledgeVectorIndex and getKnowledgeVectorNamespace', () => {
    expect(typeof getKnowledgeVectorIndex).toBe('function');
    expect(typeof getKnowledgeVectorNamespace).toBe('function');
  });

  it('performs upsert, query, and delete within a topic namespace in test mode', async () => {
    const dressCodesClient = getKnowledgeVectorNamespace('dress_codes');

    // 1. Upsert chunks
    await dressCodesClient.upsert({
      id: 'kb_dress_0',
      data: 'Black tie tuxedo guidelines and patent shoes',
      metadata: { slug: 'dress-codes', title: 'Black Tie', topic: 'dress_codes' },
    });

    await dressCodesClient.upsert({
      id: 'kb_dress_1',
      data: 'Business casual blazer and chinos guidelines',
      metadata: { slug: 'dress-codes', title: 'Business Casual', topic: 'dress_codes' },
    });

    // 2. Query with keyword match
    const queryResults = await dressCodesClient.query({
      data: 'tuxedo patent',
      topK: 1,
    });

    expect(queryResults).toHaveLength(1);
    expect(queryResults[0].id).toBe('kb_dress_0');
    expect(queryResults[0].metadata.title).toBe('Black Tie');
    expect(queryResults[0].score).toBeGreaterThan(0.8);

    // 3. Delete chunk
    await dressCodesClient.delete('kb_dress_0');

    const afterDelete = await dressCodesClient.query({
      data: 'tuxedo patent',
      topK: 1,
    });
    expect(afterDelete).toHaveLength(0);
  });

  it('maintains strict topic namespace isolation within knowledge base', async () => {
    const fabricsClient = getKnowledgeVectorNamespace('fabrics');
    const colorClient = getKnowledgeVectorNamespace('color_theory');

    await fabricsClient.upsert({
      id: 'kb_fabrics_0',
      data: 'Breathable Egyptian Giza cotton and linen weaves for summer heat',
      metadata: { topic: 'fabrics' },
    });

    await colorClient.upsert({
      id: 'kb_color_0',
      data: 'Warm olive undertones and jewel tone contrast',
      metadata: { topic: 'color_theory' },
    });

    // Query color namespace for fabric terms
    const colorResults = await colorClient.query({
      data: 'Egyptian linen cotton',
      topK: 5,
    });
    expect(colorResults).toHaveLength(0);

    // Query fabric namespace for fabric terms
    const fabricResults = await fabricsClient.query({
      data: 'Egyptian linen cotton',
      topK: 5,
    });
    expect(fabricResults).toHaveLength(1);
    expect(fabricResults[0].id).toBe('kb_fabrics_0');
  });

  it('maintains absolute isolation between knowledge vectors and user wardrobe vectors', async () => {
    const mockUserId = 'user_wardrobe_test_123';
    const userWardrobeClient = getUserVectorNamespace(mockUserId);
    const knowledgeClient = getKnowledgeVectorNamespace('egyptian_norms');

    await userWardrobeClient.upsert({
      id: 'item_user_shirt_99',
      data: 'Navy blue linen shirt from personal wardrobe',
      metadata: { category: 'top' },
    });

    await knowledgeClient.upsert({
      id: 'kb_norms_wedding_0',
      data: 'Cairo luxury hotel wedding glamour guidelines',
      metadata: { topic: 'egyptian_norms' },
    });

    // Wardrobe query must NEVER see knowledge items
    const wardrobeResults = await userWardrobeClient.query({
      data: 'luxury wedding glamour',
      topK: 5,
    });
    expect(wardrobeResults.some((r) => r.id.startsWith('kb_'))).toBe(false);

    // Knowledge query must NEVER see user wardrobe items
    const kbResults = await knowledgeClient.query({
      data: 'Navy blue linen shirt personal',
      topK: 5,
    });
    expect(kbResults.some((r) => r.id === 'item_user_shirt_99')).toBe(false);
  });
});
