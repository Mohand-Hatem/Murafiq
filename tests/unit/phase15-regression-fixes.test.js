import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import '../../src/common/globals.js';
import { stylistRequestSchema } from '../../src/modules/ai/ai.validator.js';
import * as aiController from '../../src/modules/ai/ai.controller.js';
import orchestrator from '../../src/modules/ai/stylist/stylist.orchestrator.js';
import conversationService from '../../src/modules/ai/conversation/ai-conversation.service.js';
import entitlementService from '../../src/modules/subscriptions/entitlement.service.js';
import * as llmProvider from '../../src/modules/ai/providers/llm.provider.js';
import errorHandler from '../../src/common/middlewares/error-handler.middleware.js';
import intentStep from '../../src/modules/ai/stylist/intent.step.js';
import composeStep from '../../src/modules/ai/stylist/compose.step.js';
import outfitValidator from '../../src/modules/ai/stylist/outfit.validator.js';
import renderStep from '../../src/modules/ai/stylist/render.step.js';
import aiRouter from '../../src/modules/ai/ai.routes.js';
import garmentResolver, { validateSlotCompatibility } from '../../src/modules/ai/try-on/garment-resolver.js';

describe('Phase 15 — Regression Test Suite (P1 & P2 Fixes)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── 1. Conversation Validation ───────────────────────────────────────
  describe('1. Validate conversation IDs and ownership before AI processing', () => {
    it('rejects malformed conversation IDs with 400 at validator layer', () => {
      const invalidResult = stylistRequestSchema.body.safeParse({
        message: 'Formal wedding outfit',
        conversationId: 'not-an-id',
      });

      expect(invalidResult.success).toBe(false);
      const errors = invalidResult.error.format();
      expect(errors.conversationId).toBeDefined();
    });

    it('accepts valid 24-character hexadecimal MongoDB ObjectIds', () => {
      const validResult = stylistRequestSchema.body.safeParse({
        message: 'Formal wedding outfit',
        conversationId: '507f1f77bcf86cd799439011',
      });

      expect(validResult.success).toBe(true);
    });

    it('accepts requests when conversationId is omitted (new conversation flow)', () => {
      const omittedResult = stylistRequestSchema.body.safeParse({
        message: 'Formal wedding outfit',
      });

      expect(omittedResult.success).toBe(true);
      expect(omittedResult.data.conversationId).toBeUndefined();
    });

    it('rejects nonexistent or non-owned conversations with 404 before calling orchestrator', async () => {
      jest.spyOn(conversationService, 'getConversation').mockResolvedValue(null);
      const orchestratorSpy = jest.spyOn(orchestrator, 'runStylistPipeline');

      const req = {
        user: { id: 'user_123' },
        body: {
          message: 'What should I wear?',
          conversationId: '507f1f77bcf86cd799439011',
        },
      };
      const res = {};
      const next = jest.fn();

      await aiController.handleStylistRequest(req, res, next);

      expect(conversationService.getConversation).toHaveBeenCalledWith('507f1f77bcf86cd799439011', 'user_123');
      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0][0];
      expect(error.statusCode).toBe(404);
      expect(error.message).toContain('AI conversation not found');
      expect(orchestratorSpy).not.toHaveBeenCalled();
    });
  });

  // ── 2. Validate Attached Images Pre-Quota ─────────────────────────────
  describe('2. Validate attached images before expensive AI calls', () => {
    it('rejects foreign user namespace imageRef at controller layer before orchestrator', async () => {
      const orchestratorSpy = jest.spyOn(orchestrator, 'runStylistPipeline');
      const req = {
        user: { id: 'user_alice' },
        body: {
          message: 'Style this shirt',
          imageRef: 'murafiq/ai-chat/user_bob/photo-123',
        },
      };
      const res = {};
      const next = jest.fn();

      await aiController.handleStylistRequest(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0][0];
      expect(error.statusCode).toBe(400);
      expect(error.message).toContain('imageRef does not belong to the authenticated user');
      expect(orchestratorSpy).not.toHaveBeenCalled();
    });

    it('rejects failed or unretrievable image downloads before AI processing', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
      });

      await expect(
        orchestrator.runStylistPipeline({
          userId: 'user_alice',
          message: 'Style this shirt',
          imageRef: 'murafiq/ai-chat/user_alice/missing-photo',
        })
      ).rejects.toThrow('Attached image could not be retrieved');

      globalThis.fetch = originalFetch;
    });

    it('rejects unsupported image content types (e.g. text/html, application/pdf)', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/pdf' }),
        arrayBuffer: async () => new ArrayBuffer(100),
      });

      await expect(
        orchestrator.runStylistPipeline({
          userId: 'user_alice',
          message: 'Style this shirt',
          imageRef: 'murafiq/ai-chat/user_alice/document.pdf',
        })
      ).rejects.toThrow('Unsupported image format');

      globalThis.fetch = originalFetch;
    });
  });

  // ── 3. Timeouts and Retry Behavior ────────────────────────────────────
  describe('3. Fix provider timeouts and retry behavior', () => {
    it('aborts stalled calls via AbortController signal without unbounded retry', async () => {
      let receivedSignal = null;
      const mockGenerateContent = jest.fn().mockImplementation((params) => {
        receivedSignal = params.config?.abortSignal;
        return new Promise((resolve, reject) => {
          if (receivedSignal) {
            receivedSignal.addEventListener('abort', () => {
              const abortErr = new Error('The operation was aborted');
              abortErr.name = 'AbortError';
              reject(abortErr);
            });
          }
        });
      });

      llmProvider.setGenAiClient({
        models: { generateContent: mockGenerateContent },
      });

      const startTime = Date.now();
      await expect(
        llmProvider.complete({
          task: 'reasoning',
          userParts: [{ text: 'Hello' }],
          timeoutMs: 600,
        })
      ).rejects.toThrow('timed out after 600ms');

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(2000);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(receivedSignal).toBeDefined();
      expect(receivedSignal.aborted).toBe(true);

      llmProvider.setGenAiClient(null);
    });
  });

  // ── 4. Error Sanitization ─────────────────────────────────────────────
  describe('4. Stop exposing internal errors to mobile clients', () => {
    it('omits meta.stack, local filesystem paths, and masks 500 errors in production', async () => {
      const app = express();
      app.get('/test-error', (req, res, next) => {
        const err = new Error('Crash in D:\\JOBS\\Test\\Murafiq\\src\\secret.js at line 42');
        err.statusCode = 500;
        next(err);
      });
      app.use(errorHandler);

      const oldEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const res = await request(app).get('/test-error');

      process.env.NODE_ENV = oldEnv;

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Internal Server Error');
      expect(res.body.meta?.stack).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('D:\\JOBS');
    });

    it('maps 504 and 502 to friendly messages for mobile clients in production', async () => {
      const app = express();
      app.get('/test-timeout', (req, res, next) => {
        next(new ApiError(504, 'Underlying LLM request timed out'));
      });
      app.use(errorHandler);

      const oldEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const res = await request(app).get('/test-timeout');

      process.env.NODE_ENV = oldEnv;

      expect(res.status).toBe(504);
      expect(res.body.message).toBe('AI service request timed out. Please try again.');
    });
  });

  // ── 5. Explicit Constraints & Contradictions ──────────────────────────
  describe('5. Enforce explicit user constraints and detect contradictions', () => {
    it('detects season contradiction (summer beach vs heavy winter clothing) and requests clarification', async () => {
      llmProvider.setGenAiClient({
        models: {
          generateContent: jest.fn().mockResolvedValue({
            text: JSON.stringify({
              inDomain: true,
              language: 'en',
              eventType: 'beach_wedding',
              explicitConstraints: ['beach wedding', 'heavy winter coat', 'heavy wool clothing'],
              confidence: 0.95,
            }),
            usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
          }),
        },
      });

      const intent = await intentStep.classifyAndExtract('A summer beach wedding, but make it heavy winter clothing.');

      expect(intent.confidence).toBe(0.3);
      expect(intent.clarificationQuestion).toBeDefined();
      expect(intent.clarificationQuestion).toContain('summer');

      llmProvider.setGenAiClient(null);
    });

    it('detects color contradiction (all-black vs no black pieces) and requests clarification', async () => {
      llmProvider.setGenAiClient({
        models: {
          generateContent: jest.fn().mockResolvedValue({
            text: JSON.stringify({
              inDomain: true,
              language: 'en',
              eventType: 'evening_party',
              explicitConstraints: ['entirely black outfit', 'no black pieces'],
              confidence: 0.95,
            }),
            usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
          }),
        },
      });

      const intent = await intentStep.classifyAndExtract('I want an entirely black outfit, but no black pieces.');

      expect(intent.confidence).toBe(0.3);
      expect(intent.clarificationQuestion).toBeDefined();
      expect(intent.clarificationQuestion).toContain('black');

      llmProvider.setGenAiClient(null);
    });

    it('injects explicitConstraints section into compose user prompt', async () => {
      let capturedPrompt = '';
      llmProvider.setGenAiClient({
        models: {
          generateContent: jest.fn().mockImplementation((params) => {
            capturedPrompt = params.contents[0].parts[0].text;
            return {
              text: JSON.stringify({
                outfits: [],
                sufficiency: 'none',
                missingSlots: ['top', 'bottom'],
              }),
              usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 10 },
            };
          }),
        },
      });

      await composeStep.composeAndRankOutfits({
        candidatesBySlot: {},
        resolvedDressCode: {},
        preferences: {},
        eventContext: { explicitConstraints: ['all-white linens only', 'outdoor garden'] },
        explicitConstraints: ['all-white linens only', 'outdoor garden'],
      });

      expect(capturedPrompt).toContain('<explicit_user_constraints>');
      expect(capturedPrompt).toContain('- all-white linens only');
      expect(capturedPrompt).toContain('- outdoor garden');

      llmProvider.setGenAiClient(null);
    });
  });

  // ── 6. Outfit Integrity Fallback ──────────────────────────────────────
  describe('6. Handle outfit-integrity failures safely', () => {
    it('filterValidOutfits retains only outfits where all items are valid candidates', () => {
      const candidatesBySlot = {
        top: [{ _id: 'top_1' }],
        bottom: [{ _id: 'bottom_2' }],
      };

      const proposedOutfits = [
        { itemIds: ['top_1', 'bottom_2'], score: 90 }, // strictly valid
        { itemIds: ['top_1', 'forged_999'], score: 85 }, // contains hallucinated item
      ];

      const safeOutfits = outfitValidator.filterValidOutfits(proposedOutfits, candidatesBySlot);

      expect(safeOutfits).toHaveLength(1);
      expect(safeOutfits[0].itemIds).toEqual(['top_1', 'bottom_2']);
    });

    it('filterValidOutfits returns empty array if all outfits contain invalid IDs', () => {
      const candidatesBySlot = {
        top: [{ _id: 'top_1' }],
      };

      const proposedOutfits = [
        { itemIds: ['forged_1'], score: 80 },
        { itemIds: ['top_1', 'forged_2'], score: 75 },
      ];

      const safeOutfits = outfitValidator.filterValidOutfits(proposedOutfits, candidatesBySlot);
      expect(safeOutfits).toHaveLength(0);
    });
  });

  // ── 7. Meaningful Wardrobe Item Names ─────────────────────────────────
  describe('7. Return meaningful wardrobe item names', () => {
    it('generates title-cased English names from garment attributes', () => {
      const item = {
        category: 'outerwear',
        subcategory: 'blazer',
        primaryColor: 'navy',
      };
      expect(renderStep.formatWardrobeItemName(item, 'en')).toBe('Navy Blazer');
    });

    it('generates natural Arabic names from garment attributes', () => {
      const item = {
        category: 'outerwear',
        subcategory: 'blazer',
        primaryColor: 'navy',
      };
      expect(renderStep.formatWardrobeItemName(item, 'ar')).toBe('بليزر كحلي');

      const shoes = {
        category: 'shoes',
        subcategory: 'loafers',
        primaryColor: 'brown',
      };
      expect(renderStep.formatWardrobeItemName(shoes, 'ar')).toBe('حذاء لوفر بني');
    });

    it('preserves explicit custom names without alteration', () => {
      expect(renderStep.formatWardrobeItemName({ name: 'Custom Italian Suit' }, 'en')).toBe('Custom Italian Suit');
      expect(renderStep.formatWardrobeItemName({ name: 'فستان زفاف مطرز' }, 'ar')).toBe('فستان زفاف مطرز');
    });
  });

  // ── 8. Route Registration (P2 Dead Duplicate Removal) ──────────────────
  describe('8. Preserves active shape-model and try-on route registrations in ai.routes.js', () => {
    it('registers all 7 shape-model and try-on routes with tryOnGuard on aiRouter', () => {
      const registeredRoutes = [];

      aiRouter.stack.forEach((layer) => {
        if (layer.route) {
          const path = layer.route.path;
          const methods = Object.keys(layer.route.methods);
          methods.forEach((method) => {
            registeredRoutes.push({ method: method.toUpperCase(), path });
          });
        }
      });

      // Verify Shape Model endpoints
      expect(registeredRoutes).toContainEqual({ method: 'POST', path: '/shape-model' });
      expect(registeredRoutes).toContainEqual({ method: 'GET', path: '/shape-model' });
      expect(registeredRoutes).toContainEqual({ method: 'DELETE', path: '/shape-model' });

      // Verify Virtual Try-On endpoints
      expect(registeredRoutes).toContainEqual({ method: 'POST', path: '/try-on' });
      expect(registeredRoutes).toContainEqual({ method: 'GET', path: '/try-on/:id' });
      expect(registeredRoutes).toContainEqual({ method: 'GET', path: '/try-on' });
      expect(registeredRoutes).toContainEqual({ method: 'DELETE', path: '/try-on/:id' });
    });
  });

  // ── 9. Layered Tops Disambiguation in Virtual Try-On ──────────────────
  describe('9. Disambiguate layered tops (shirt + blazer/jacket) in virtual try-on', () => {
    it('promotes outer top to outerwear when two tops are provided and outerwear is vacant', () => {
      const garments = [
        { slot: 'top', label: 'White Oxford Shirt' },
        { slot: 'top', label: 'Navy Wool Blazer' },
      ];

      validateSlotCompatibility(garments);

      expect(garments[0].slot).toBe('top');
      expect(garments[1].slot).toBe('outerwear');
    });

    it('identifies outerwear-like garment keywords and sets slot to outerwear', () => {
      const garments = [
        { slot: 'top', label: 'Black Leather Jacket' },
        { slot: 'top', label: 'Crewneck T-Shirt' },
      ];

      validateSlotCompatibility(garments);

      // The jacket should be promoted to outerwear regardless of order
      const jacket = garments.find((g) => g.label.includes('Jacket'));
      const tee = garments.find((g) => g.label.includes('T-Shirt'));

      expect(jacket.slot).toBe('outerwear');
      expect(tee.slot).toBe('top');
    });

    it('still rejects duplicate bottom slots with 400', () => {
      const garments = [
        { slot: 'bottom', label: 'Blue Jeans' },
        { slot: 'bottom', label: 'Khaki Chinos' },
      ];

      expect(() => validateSlotCompatibility(garments)).toThrow(
        /Multiple garments specified for slot 'bottom'/
      );
    });

    it('rejects three tops if outerwear is already occupied', () => {
      const garments = [
        { slot: 'top', label: 'Shirt 1' },
        { slot: 'top', label: 'Shirt 2' },
        { slot: 'outerwear', label: 'Blazer' },
      ];

      expect(() => validateSlotCompatibility(garments)).toThrow(
        /Multiple garments specified for slot 'top'/
      );
    });
  });
});
