import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import {
  CANONICAL_PLANS,
  FALLBACK_FREE_ENTITLEMENTS,
} from '../../src/modules/subscriptions/plan.constants.js';
import { runStylistPipeline } from '../../src/modules/ai/stylist/stylist.orchestrator.js';
import entitlementService from '../../src/modules/subscriptions/entitlement.service.js';
import scopeGuard from '../../src/modules/ai/stylist/scope.guard.js';
import intentStep from '../../src/modules/ai/stylist/intent.step.js';
import wardrobeService from '../../src/modules/wardrobe/wardrobe.service.js';
import stylePreferenceService from '../../src/modules/ai/preferences/style-preference.service.js';
import composeStep from '../../src/modules/ai/stylist/compose.step.js';
import outfitValidator from '../../src/modules/ai/stylist/outfit.validator.js';
import renderStep from '../../src/modules/ai/stylist/render.step.js';

describe('Phase 15C Step 1: AI Image Entitlements & Orchestrator Two-Metric Quota', () => {
  const userId = 'user_image_quota_test_001';

  beforeEach(() => {
    jest.clearAllMocks();
    scopeGuard.resetInMemoryRefusalStore();

    // Default mocks for standard flow
    jest.spyOn(entitlementService, 'consume').mockResolvedValue({ success: true });
    jest.spyOn(entitlementService, 'refundQuota').mockResolvedValue();
    jest.spyOn(scopeGuard, 'checkRefusalRateLimit').mockResolvedValue({ allowed: true });
    jest.spyOn(wardrobeService, 'getWardrobeCandidates').mockResolvedValue({
      top: [{ _id: 'top1', category: 'top' }],
      bottom: [{ _id: 'bot1', category: 'bottom' }],
      shoes: [{ _id: 'shoe1', category: 'shoes' }],
    });
    jest.spyOn(stylePreferenceService, 'getPreferences').mockResolvedValue({ favoriteColors: [] });
    jest.spyOn(composeStep, 'composeAndRankOutfits').mockResolvedValue({
      outfits: [{ itemIds: ['top1', 'bot1', 'shoe1'], items: [{ itemId: 'top1' }, { itemId: 'bot1' }, { itemId: 'shoe1' }] }],
      sufficiency: 'good',
    });
    jest.spyOn(outfitValidator, 'validateOutfitItemIds').mockReturnValue({ valid: true });
    jest.spyOn(wardrobeService, 'getWardrobeItemsByIds').mockResolvedValue([
      { _id: 'top1', category: 'top' },
      { _id: 'bot1', category: 'bottom' },
      { _id: 'shoe1', category: 'shoes' },
    ]);
    jest.spyOn(renderStep, 'renderStylistResponse').mockReturnValue({
      outfits: [],
      sufficiency: 'good',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('1. Plan Constants Definition', () => {
    it('defines ai.imageMessages.daily across all canonical client plan tiers', () => {
      const clientPlans = CANONICAL_PLANS.filter((p) => p.role === 'client');
      const expectedLimits = {
        'client.free': 1,
        'client.basic': 3,
        'client.mid': 10,
        'client.pro': 25,
        'client.enterprise': 60,
      };

      for (const plan of clientPlans) {
        expect(plan.entitlements['ai.imageMessages.daily']).toBe(expectedLimits[plan.code]);
      }
    });

    it('defines ai.imageMessages.daily as 1 in FALLBACK_FREE_ENTITLEMENTS for clients', () => {
      expect(FALLBACK_FREE_ENTITLEMENTS.client['ai.imageMessages.daily']).toBe(1);
    });
  });

  describe('2. Orchestrator Two-Metric Quota Consumption & Rollback', () => {
    it('consumes ONLY ai.messages.daily when imageRef is absent', async () => {
      jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValue({
        inDomain: true,
        eventType: 'wedding',
        language: 'en',
      });

      await runStylistPipeline({
        userId,
        message: 'I have a wedding tomorrow evening',
      });

      expect(entitlementService.consume).toHaveBeenCalledTimes(1);
      expect(entitlementService.consume).toHaveBeenCalledWith(
        userId,
        'ai.messages.daily',
        1,
        'client'
      );
    });

    it('consumes ai.messages.daily and ai.imageMessages.daily sequentially when imageRef is present', async () => {
      jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValue({
        inDomain: true,
        eventType: 'dinner',
        language: 'en',
      });

      await runStylistPipeline({
        userId,
        message: 'What pants go well with this shirt?',
        imageRef: 'murafiq/ai-chat/user_image_quota_test_001/abc-123',
      });

      expect(entitlementService.consume).toHaveBeenCalledTimes(2);
      expect(entitlementService.consume).toHaveBeenNthCalledWith(
        1,
        userId,
        'ai.messages.daily',
        1,
        'client'
      );
      expect(entitlementService.consume).toHaveBeenNthCalledWith(
        2,
        userId,
        'ai.imageMessages.daily',
        1,
        'client'
      );
    });

    it('refunds ai.messages.daily and throws 429 when ai.imageMessages.daily quota is exceeded', async () => {
      const quotaError = new ApiError(429, 'Daily quota exceeded for ai.imageMessages.daily');
      jest
        .spyOn(entitlementService, 'consume')
        .mockResolvedValueOnce({ success: true }) // ai.messages.daily succeeds
        .mockRejectedValueOnce(quotaError); // ai.imageMessages.daily fails

      const classifySpy = jest.spyOn(intentStep, 'classifyAndExtract');

      await expect(
        runStylistPipeline({
          userId,
          message: 'What pants go well with this shirt?',
          imageRef: 'murafiq/ai-chat/user_image_quota_test_001/abc-123',
        })
      ).rejects.toThrow('Daily quota exceeded for ai.imageMessages.daily');

      // Assert rollback: ai.messages.daily was refunded
      expect(entitlementService.refundQuota).toHaveBeenCalledWith(
        userId,
        'ai.messages.daily',
        1
      );
      // Assert no downstream model call was made
      expect(classifySpy).not.toHaveBeenCalled();
    });

    it('refunds BOTH ai.messages.daily and ai.imageMessages.daily on Layer 1 invalid message', async () => {
      await expect(
        runStylistPipeline({
          userId,
          message: '   ', // whitespace only -> fails Layer 1
          imageRef: 'murafiq/ai-chat/user_image_quota_test_001/abc-123',
        })
      ).rejects.toThrow(ApiError);

      expect(entitlementService.refundQuota).toHaveBeenCalledWith(
        userId,
        'ai.messages.daily',
        1
      );
      expect(entitlementService.refundQuota).toHaveBeenCalledWith(
        userId,
        'ai.imageMessages.daily',
        1
      );
    });

    it('refunds BOTH ai.messages.daily and ai.imageMessages.daily on Layer 1 rate limit refusal', async () => {
      jest.spyOn(scopeGuard, 'checkRefusalRateLimit').mockResolvedValue({
        allowed: false,
        refusalCategory: 'rate_limited',
      });

      const res = await runStylistPipeline({
        userId,
        message: 'What pants go with this?',
        imageRef: 'murafiq/ai-chat/user_image_quota_test_001/abc-123',
      });

      expect(res.refused).toBe(true);
      expect(res.refusalCategory).toBe('rate_limited');
      expect(entitlementService.refundQuota).toHaveBeenCalledWith(
        userId,
        'ai.messages.daily',
        1
      );
      expect(entitlementService.refundQuota).toHaveBeenCalledWith(
        userId,
        'ai.imageMessages.daily',
        1
      );
    });

    it('refunds BOTH quotas on Layer 1b scope refusal', async () => {
      jest.spyOn(intentStep, 'classifyAndExtract').mockResolvedValue({
        inDomain: false,
        refusalCategory: 'general_knowledge',
        language: 'en',
      });
      const recordRefusalSpy = jest.spyOn(scopeGuard, 'recordScopeRefusal').mockResolvedValue();

      const res = await runStylistPipeline({
        userId,
        message: 'Write Python code for me',
        imageRef: 'murafiq/ai-chat/user_image_quota_test_001/abc-123',
      });

      expect(res.refused).toBe(true);
      expect(res.refusalCategory).toBe('general_knowledge');
      expect(recordRefusalSpy).toHaveBeenCalledWith(userId);
      expect(entitlementService.refundQuota).toHaveBeenCalledWith(
        userId,
        'ai.messages.daily',
        1
      );
      expect(entitlementService.refundQuota).toHaveBeenCalledWith(
        userId,
        'ai.imageMessages.daily',
        1
      );
    });
  });
});
