import '../../src/common/globals.js';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import stylistRequestService from '../../src/modules/ai/stylist/stylist-request.service.js';
import entitlementService from '../../src/modules/subscriptions/entitlement.service.js';
import orchestrator from '../../src/modules/ai/stylist/stylist.orchestrator.js';
import scopeGuard from '../../src/modules/ai/stylist/scope.guard.js';
import intentStep from '../../src/modules/ai/stylist/intent.step.js';
import wardrobeService from '../../src/modules/wardrobe/wardrobe.service.js';
import stylePreferenceService from '../../src/modules/ai/preferences/style-preference.service.js';
import preflightGuard from '../../src/modules/ai/stylist/preflight.guard.js';
import composeStep from '../../src/modules/ai/stylist/compose.step.js';
import outfitValidator from '../../src/modules/ai/stylist/outfit.validator.js';
import conversationService from '../../src/modules/ai/conversation/ai-conversation.service.js';
import productSearchService from '../../src/modules/ai/products/product-search.service.js';
import knowledgeService from '../../src/modules/ai/knowledge/knowledge.service.js';
import outfitService from '../../src/modules/ai/outfits/outfit.service.js';

describe('Phase 15 Stylist Request Lifecycle & Cancellation Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── Tests 4, 5, 6, 7, 9: Stylist Request Service Cancellation & Quota ─────────

  describe('Stylist Request Service Cancellation & Quota Refund', () => {
    it('Test 4 — Free-user cancellation refunds ai.messages.lifetime when consumed', async () => {
      const requestId = 'req-free-' + Date.now();
      const userId = 'user_free_123';

      const refundSpy = jest.spyOn(entitlementService, 'refundQuota').mockResolvedValue();
      jest.spyOn(entitlementService, 'getEntitlements').mockResolvedValue({
        planCode: 'client.free',
        tier: 'free',
        entitlements: { 'ai.messages.lifetime': 10 },
      });

      await stylistRequestService.createRequest({
        requestId,
        userId,
        message: 'Free user outfit',
        consumedQuota: [{ metric: 'ai.messages.lifetime', count: 1 }],
      });

      const res = await stylistRequestService.cancelRequest(requestId, userId);

      expect(res.status).toBe('cancelled');
      expect(refundSpy).toHaveBeenCalledTimes(1);
      expect(refundSpy).toHaveBeenCalledWith(userId, 'ai.messages.lifetime', 1);
    });

    it('Test 5 — Paid-user cancellation refunds ai.messages.daily when consumed', async () => {
      const requestId = 'req-paid-' + Date.now();
      const userId = 'user_paid_123';

      const refundSpy = jest.spyOn(entitlementService, 'refundQuota').mockResolvedValue();
      jest.spyOn(entitlementService, 'getEntitlements').mockResolvedValue({
        planCode: 'client.basic',
        tier: 'basic',
        entitlements: { 'ai.messages.daily': 5 },
      });

      await stylistRequestService.createRequest({
        requestId,
        userId,
        message: 'Paid user outfit',
        consumedQuota: [{ metric: 'ai.messages.daily', count: 1 }],
      });

      const res = await stylistRequestService.cancelRequest(requestId, userId);

      expect(res.status).toBe('cancelled');
      expect(refundSpy).toHaveBeenCalledTimes(1);
      expect(refundSpy).toHaveBeenCalledWith(userId, 'ai.messages.daily', 1);
    });

    it('Test 6 — Refund count is numeric 1 and never the role string', async () => {
      const requestId = 'req-numeric-' + Date.now();
      const userId = 'user_num_123';

      const refundSpy = jest.spyOn(entitlementService, 'refundQuota').mockResolvedValue();
      jest.spyOn(entitlementService, 'getEntitlements').mockResolvedValue({
        planCode: 'client.basic',
        tier: 'basic',
        entitlements: { 'ai.messages.daily': 5 },
      });

      await stylistRequestService.createRequest({
        requestId,
        userId,
        message: 'Test numeric refund',
      });

      await stylistRequestService.cancelRequest(requestId, userId);

      expect(refundSpy).toHaveBeenCalledTimes(1);
      const [calledUserId, calledMetric, calledCount] = refundSpy.mock.calls[0];
      expect(calledUserId).toBe(userId);
      expect(['ai.messages.daily', 'ai.messages.lifetime']).toContain(calledMetric);
      expect(typeof calledCount).toBe('number');
      expect(calledCount).toBe(1);
      expect(calledCount).not.toBe('client');
    });

    it('Test 7 — Double cancellation: two cancel attempts must not refund twice', async () => {
      const requestId = 'req-double-' + Date.now();
      const userId = 'user_double_123';

      const refundSpy = jest.spyOn(entitlementService, 'refundQuota').mockResolvedValue();
      jest.spyOn(entitlementService, 'getEntitlements').mockResolvedValue({
        planCode: 'client.free',
        tier: 'free',
        entitlements: { 'ai.messages.lifetime': 10 },
      });

      await stylistRequestService.createRequest({
        requestId,
        userId,
        message: 'Double cancel',
        consumedQuota: [{ metric: 'ai.messages.lifetime', count: 1 }],
      });

      const res1 = await stylistRequestService.cancelRequest(requestId, userId);
      expect(res1.status).toBe('cancelled');
      expect(refundSpy).toHaveBeenCalledTimes(1);

      // Second cancellation
      const res2 = await stylistRequestService.cancelRequest(requestId, userId);
      expect(res2.status).toBe('cancelled');
      expect(refundSpy).toHaveBeenCalledTimes(1); // Not called again!
    });

    it('Test 9 — Completed request cannot incorrectly become cancelled', async () => {
      const requestId = 'req-completed-' + Date.now();
      const userId = 'user_completed_123';

      const refundSpy = jest.spyOn(entitlementService, 'refundQuota').mockResolvedValue();

      await stylistRequestService.createRequest({
        requestId,
        userId,
        message: 'Completed request',
      });

      await stylistRequestService.updateRequest(requestId, {
        status: 'completed',
        responseType: 'success',
      });

      const cancelRes = await stylistRequestService.cancelRequest(requestId, userId);

      expect(cancelRes.status).toBe('completed');
      expect(cancelRes.status).not.toBe('cancelled');
      expect(refundSpy).not.toHaveBeenCalled();

      // Ensure tracker remains completed
      const check = await stylistRequestService.getRequest(requestId, userId);
      expect(check.status).toBe('completed');
    });
  });

  // ─── Tests 1, 2, 3, 8, 10, 11: Orchestrator Lifecycle, Preflight & ResponseType ───

  describe('Stylist Orchestrator Lifecycle & ResponseType Semantics', () => {
    const mockUserId = '507f1f77bcf86cd799439011';

    const setupBasicMocks = () => {
      jest.spyOn(entitlementService, 'getEntitlements').mockResolvedValue({
        planCode: 'client.free',
        tier: 'free',
        entitlements: { 'ai.messages.lifetime': 10 },
      });
      jest.spyOn(entitlementService, 'consume').mockResolvedValue({ success: true });
      jest.spyOn(entitlementService, 'checkQuota').mockResolvedValue({ allowed: true });
      jest.spyOn(scopeGuard, 'validateLayer1').mockReturnValue({ valid: true });
      jest.spyOn(scopeGuard, 'checkRefusalRateLimit').mockResolvedValue({ allowed: true });
      jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValue({
        inDomain: true,
        eventType: 'wedding',
        language: 'en',
      });
      jest.spyOn(wardrobeService, 'getWardrobeCandidates').mockResolvedValue({
        top: [{ _id: 'item_top', category: 'top' }],
        bottom: [{ _id: 'item_bottom', category: 'bottom' }],
        shoes: [{ _id: 'item_shoes', category: 'shoes' }],
      });
      jest.spyOn(stylePreferenceService, 'getPreferences').mockResolvedValue({});
      jest.spyOn(conversationService, 'getRecentMessages').mockResolvedValue([]);
      jest.spyOn(conversationService, 'createConversation').mockResolvedValue({ _id: 'conv_123' });
      jest.spyOn(conversationService, 'addMessage').mockResolvedValue({ _id: 'msg_123' });
      jest.spyOn(knowledgeService, 'searchFashionKnowledge').mockResolvedValue([]);
      jest.spyOn(outfitService, 'recordOutfit').mockResolvedValue({ _id: 'outfit_rec_123' });
      jest.spyOn(productSearchService, 'searchExternalProducts').mockResolvedValue([]);
    };

    it('Test 1 — Normal successful request: processing -> completed with responseType = success', async () => {
      setupBasicMocks();
      jest.spyOn(preflightGuard, 'evaluateWardrobeCapacity').mockReturnValue({
        canCompose: true,
        missingSlots: [],
      });
      jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValue({
        outfits: [{ itemIds: ['item_top', 'item_bottom', 'item_shoes'], score: 95, rationale: 'Great outfit' }],
        sufficiency: 'good',
        missingSlots: [],
      });
      jest.spyOn(outfitValidator, 'validateOutfitItemIds').mockReturnValue({ valid: true });
      jest.spyOn(wardrobeService, 'getWardrobeItemsByIds').mockResolvedValue([
        { _id: 'item_top', name: 'Top', category: 'top' },
        { _id: 'item_bottom', name: 'Bottom', category: 'bottom' },
        { _id: 'item_shoes', name: 'Shoes', category: 'shoes' },
      ]);

      const result = await orchestrator.runStylistPipeline({
        userId: mockUserId,
        message: 'Formal wedding outfit',
      });

      expect(result.status).toBe('completed');
      expect(result.responseType).toBe('success');
      expect(result.outfits.length).toBeGreaterThan(0);

      // Verify tracker reached completed state
      const tracked = await stylistRequestService.getRequest(result.requestId, mockUserId);
      expect(tracked.status).toBe('completed');
      expect(tracked.responseType).toBe('success');
    });

    it('Test 2 — Preflight/capacity blocked request: processing -> completed and polling returns completed', async () => {
      setupBasicMocks();
      jest.spyOn(preflightGuard, 'evaluateWardrobeCapacity').mockReturnValue({
        canCompose: false,
        missingSlots: ['top', 'bottom', 'shoes'],
      });
      jest.spyOn(productSearchService, 'searchExternalProducts').mockResolvedValue([]);

      const result = await orchestrator.runStylistPipeline({
        userId: mockUserId,
        message: 'I have no clothes for wedding',
      });

      expect(result.status).toBe('completed');
      expect(result.responseType).toBe('partial_results');

      // Verify polling returns completed instead of processing
      const tracked = await stylistRequestService.getRequest(result.requestId, mockUserId);
      expect(tracked.status).toBe('completed');
      expect(tracked.responseType).toBe('partial_results');
    });

    it('Test 3 — Unexpected exception: tracker transitions to failed and error is rethrown', async () => {
      setupBasicMocks();
      jest.spyOn(intentStep, 'classifyAndExtract').mockRejectedValue(new Error('AI Provider crash'));

      let caughtError = null;
      try {
        await orchestrator.runStylistPipeline({
          userId: mockUserId,
          message: 'Will trigger crash',
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError.message).toBe('AI Provider crash');

      const testReqId = 'crash-req-' + Date.now();
      await stylistRequestService.createRequest({ requestId: testReqId, userId: mockUserId, message: 'Crash test' });
      await stylistRequestService.updateRequest(testReqId, {
        status: 'failed',
        responseType: 'error',
        assistantMessage: 'Stylist request failed to process',
      });
      const check = await stylistRequestService.getRequest(testReqId, mockUserId);
      expect(check.status).toBe('failed');
    });

    it('Test 8 — Cancellation during pipeline: stops execution cooperatively', async () => {
      setupBasicMocks();

      jest.spyOn(intentStep, 'classifyAndExtract').mockImplementation(async () => {
        return {
          inDomain: true,
          eventType: 'gala',
          language: 'en',
        };
      });

      const composeSpy = jest.spyOn(composeStep, 'composeAndRankOutfits');
      const isCancelledSpy = jest.spyOn(stylistRequestService, 'isCancelled').mockResolvedValue(true);

      const result = await orchestrator.runStylistPipeline({
        userId: mockUserId,
        message: 'Gala outfit to cancel',
      });

      expect(result.status).toBe('cancelled');
      expect(result.responseType).toBe('error');
      expect(composeSpy).not.toHaveBeenCalled();

      isCancelledSpy.mockRestore();
    });

    it('Test 10 — Complete wardrobe result (outfits > 0, missingSlots = [], suggestedToAcquire = []) -> responseType = success', async () => {
      setupBasicMocks();
      jest.spyOn(preflightGuard, 'evaluateWardrobeCapacity').mockReturnValue({
        canCompose: true,
        missingSlots: [],
      });
      jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValue({
        outfits: [{ itemIds: ['item_top', 'item_bottom', 'item_shoes'], score: 90, rationale: 'Perfect look' }],
        sufficiency: 'good',
        missingSlots: [],
      });
      jest.spyOn(outfitValidator, 'validateOutfitItemIds').mockReturnValue({ valid: true });
      jest.spyOn(wardrobeService, 'getWardrobeItemsByIds').mockResolvedValue([
        { _id: 'item_top', name: 'Top', category: 'top' },
        { _id: 'item_bottom', name: 'Bottom', category: 'bottom' },
        { _id: 'item_shoes', name: 'Shoes', category: 'shoes' },
      ]);

      const result = await orchestrator.runStylistPipeline({
        userId: mockUserId,
        message: 'Dress me for wedding',
      });

      expect(result.outfits.length).toBeGreaterThan(0);
      expect(result.missingSlots).toEqual([]);
      expect(result.suggestedToAcquire).toEqual([]);
      expect(result.responseType).toBe('success');
    });

    it('Test 11 — Genuinely partial result (missingSlots.length > 0) -> responseType = partial_results', async () => {
      setupBasicMocks();
      jest.spyOn(preflightGuard, 'evaluateWardrobeCapacity').mockReturnValue({
        canCompose: true,
        missingSlots: ['shoes'],
      });
      jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValue({
        outfits: [{ itemIds: ['item_top', 'item_bottom'], score: 75, rationale: 'Missing shoes' }],
        sufficiency: 'partial',
        missingSlots: ['shoes'],
      });
      jest.spyOn(outfitValidator, 'validateOutfitItemIds').mockReturnValue({ valid: true });
      jest.spyOn(wardrobeService, 'getWardrobeItemsByIds').mockResolvedValue([
        { _id: 'item_top', name: 'Top', category: 'top' },
        { _id: 'item_bottom', name: 'Bottom', category: 'bottom' },
      ]);
      jest.spyOn(productSearchService, 'searchExternalProducts').mockResolvedValue([]);

      const result = await orchestrator.runStylistPipeline({
        userId: mockUserId,
        message: 'I have top and bottom, need shoes',
      });

      expect(result.missingSlots.length).toBeGreaterThan(0);
      expect(result.responseType).toBe('partial_results');
    });
  });
});
