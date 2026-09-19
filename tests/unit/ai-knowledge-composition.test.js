/**
 * Phase 15D Step 6 — Knowledge Composition & Orchestrator Integration Tests.
 *
 * Covers:
 * 1. buildSystemPrompt injects <fashion_editorial_knowledge> with title and body.
 * 2. buildSystemPrompt omits knowledge section when chunks array is empty.
 * 3. Editorial knowledge is strictly framed as advisory context; candidate provenance invariant preserved.
 * 4. composeAndRankOutfits delivers grounded systemPrompt to llmProvider.complete.
 * 5. Orchestrator calls searchFashionKnowledge for in-domain requests and logs trace step.
 * 6. Orchestrator NEVER calls searchFashionKnowledge for out-of-domain refusals (0 downstream calls).
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import '../../src/common/globals.js';
import {
  buildSystemPrompt,
  composeAndRankOutfits,
} from '../../src/modules/ai/stylist/compose.step.js';
import orchestrator from '../../src/modules/ai/stylist/stylist.orchestrator.js';
import knowledgeService from '../../src/modules/ai/knowledge/knowledge.service.js';
import entitlementService from '../../src/modules/subscriptions/entitlement.service.js';
import intentStep from '../../src/modules/ai/stylist/intent.step.js';
import wardrobeService from '../../src/modules/wardrobe/wardrobe.service.js';
import outfitService from '../../src/modules/ai/outfits/outfit.service.js';
import stylePreferenceService from '../../src/modules/ai/preferences/style-preference.service.js';
import scopeGuard from '../../src/modules/ai/stylist/scope.guard.js';
import { setGenAiClient } from '../../src/modules/ai/providers/llm.provider.js';

describe('Phase 15D Step 6 — Composition Grounding & Orchestrator Wiring', () => {
  describe('buildSystemPrompt with Fashion Knowledge', () => {
    it('injects <fashion_editorial_knowledge> and advisory instructions when chunks are provided', () => {
      const mockChunks = [
        {
          title: 'Black Tie and Gala Attire',
          body: 'A midnight blue or black tuxedo with satin lapels is non-negotiable.',
        },
        {
          title: 'Cairo Luxury Hotel Weddings',
          body: 'Grand ballroom weddings demand high glamour and opulent fabrics.',
        },
      ];

      const prompt = buildSystemPrompt('en', false, mockChunks);

      expect(prompt).toContain('<fashion_editorial_knowledge>');
      expect(prompt).toContain('### Black Tie and Gala Attire');
      expect(prompt).toContain('midnight blue or black tuxedo');
      expect(prompt).toContain('### Cairo Luxury Hotel Weddings');
      expect(prompt).toContain('</fashion_editorial_knowledge>');
      expect(prompt).toContain('EDITORIAL ADVISORY GUIDELINES');
      expect(prompt).toContain('CANDIDATE PROVENANCE');
    });

    it('omits <fashion_editorial_knowledge> when chunks are empty', () => {
      const prompt = buildSystemPrompt('en', false, []);
      expect(prompt).not.toContain('<fashion_editorial_knowledge>');
      expect(prompt).toContain('CANDIDATE PROVENANCE');
    });
  });

  describe('composeAndRankOutfits Grounded Execution', () => {
    let mockGenerateContent;

    beforeEach(() => {
      mockGenerateContent = jest.fn().mockResolvedValue({
        text: JSON.stringify({
          outfits: [
            {
              itemIds: ['top_1', 'bottom_1', 'shoes_1'],
              rationale: 'Tuxedo jacket paired with trousers and patent shoes per black tie norms.',
              score: 95,
            },
          ],
          sufficiency: 'good',
          missingSlots: [],
        }),
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 50 },
      });
      setGenAiClient({
        models: {
          generateContent: mockGenerateContent,
        },
      });
    });

    afterEach(() => {
      setGenAiClient(null);
      jest.restoreAllMocks();
    });

    it('passes knowledge chunks in systemPrompt to llmProvider.complete', async () => {
      const mockChunks = [
        {
          title: 'Black Tie Standards',
          body: 'Patent leather shoes and bow tie.',
        },
      ];

      const result = await composeAndRankOutfits({
        candidatesBySlot: {
          top: [{ _id: 'top_1', name: 'Dinner Jacket', category: 'top' }],
          bottom: [{ _id: 'bottom_1', name: 'Tuxedo Trousers', category: 'bottom' }],
          shoes: [{ _id: 'shoes_1', name: 'Patent Oxfords', category: 'shoes' }],
        },
        fashionKnowledgeChunks: mockChunks,
      });

      expect(result.outfits).toHaveLength(1);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.config.systemInstruction).toContain('<fashion_editorial_knowledge>');
      expect(callArgs.config.systemInstruction).toContain('Black Tie Standards');
    });
  });

  describe('Orchestrator Knowledge Wiring', () => {
    let searchKnowledgeSpy;
    let mockGenerateContent;

    beforeEach(() => {
      mockGenerateContent = jest.fn().mockResolvedValue({
        text: JSON.stringify({
          outfits: [
            {
              itemIds: ['top_1', 'bottom_1', 'shoes_1'],
              rationale: 'Classic black tie wedding look.',
              score: 95,
            },
          ],
          sufficiency: 'good',
          missingSlots: [],
        }),
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 50 },
      });
      setGenAiClient({
        models: {
          generateContent: mockGenerateContent,
        },
      });

      jest.spyOn(entitlementService, 'consume').mockResolvedValue(true);
      jest.spyOn(entitlementService, 'refundQuota').mockResolvedValue(true);
      jest.spyOn(entitlementService, 'checkQuota').mockResolvedValue({ allowed: false, remaining: 0, planCode: 'client.free' });
      jest.spyOn(scopeGuard, 'checkRefusalRateLimit').mockResolvedValue({ allowed: true });
      jest.spyOn(scopeGuard, 'recordScopeRefusal').mockResolvedValue(true);
      jest.spyOn(stylePreferenceService, 'getPreferences').mockResolvedValue({});
      jest.spyOn(outfitService, 'recordOutfit').mockResolvedValue({ _id: 'outfit_1' });

      searchKnowledgeSpy = jest.spyOn(knowledgeService, 'searchFashionKnowledge').mockResolvedValue([
        {
          id: 'kb_wedding_1',
          title: 'Egyptian Wedding Conventions',
          body: 'Formal dark tailoring or tuxedo for Cairo evening weddings.',
        },
      ]);
    });

    afterEach(() => {
      setGenAiClient(null);
      jest.restoreAllMocks();
    });

    it('calls searchFashionKnowledge for in-domain request and passes chunks into composition', async () => {
      jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
        inDomain: true,
        refusalCategory: null,
        occasion: 'wedding',
        formality: 'formal',
        retrievalQueryEn: 'formal wedding tuxedo',
        language: 'en',
      });

      jest.spyOn(wardrobeService, 'getWardrobeCandidates').mockResolvedValueOnce({
        top: [{ _id: 'top_1', name: 'Tuxedo Jacket', category: 'top' }],
        bottom: [{ _id: 'bottom_1', name: 'Trousers', category: 'bottom' }],
        shoes: [{ _id: 'shoes_1', name: 'Oxfords', category: 'shoes' }],
      });

      jest.spyOn(wardrobeService, 'getWardrobeItemsByIds').mockResolvedValueOnce([
        { _id: 'top_1', name: 'Tuxedo Jacket', category: 'top' },
        { _id: 'bottom_1', name: 'Trousers', category: 'bottom' },
        { _id: 'shoes_1', name: 'Oxfords', category: 'shoes' },
      ]);

      const result = await orchestrator.runStylistPipeline({
        userId: 'user_rag_test_1',
        message: 'What should I wear to a formal Cairo wedding?',
      });

      expect(searchKnowledgeSpy).toHaveBeenCalledWith(
        'formal wedding tuxedo',
        expect.objectContaining({
          eventType: 'wedding',
        })
      );
      expect(result.sufficiency).toBe('good');
      expect(result.outfits).toHaveLength(1);
    });

    it('NEVER calls searchFashionKnowledge when request is refused (out-of-domain)', async () => {
      jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValueOnce({
        inDomain: false,
        refusalCategory: 'medical_advice',
        language: 'en',
      });

      const result = await orchestrator.runStylistPipeline({
        userId: 'user_rag_test_1',
        message: 'What medicine cures my headache?',
      });

      expect(result.refused).toBe(true);
      expect(result.refusalCategory).toBe('medical_advice');
      // Absolute invariant: zero downstream calls for out-of-domain refusals
      expect(searchKnowledgeSpy).not.toHaveBeenCalled();
    });
  });
});
