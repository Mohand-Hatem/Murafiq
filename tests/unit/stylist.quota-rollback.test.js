import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import entitlementService from '../../src/modules/subscriptions/entitlement.service.js';
import intentStep from '../../src/modules/ai/stylist/intent.step.js';
import scopeGuard from '../../src/modules/ai/stylist/scope.guard.js';
import orchestrator from '../../src/modules/ai/stylist/stylist.orchestrator.js';

describe('Unit — Stylist Orchestrator Quota Rollback', () => {
  const userId = '507f1f77bcf86cd799439011';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('refunds consumed quotas when downstream intent classification throws an unexpected error', async () => {
    jest.spyOn(entitlementService, 'getEntitlements').mockResolvedValue({
      entitlements: { 'ai.messages.daily': 10 },
    });
    const consumeSpy = jest.spyOn(entitlementService, 'consume').mockResolvedValue({ allowed: true });
    const refundSpy = jest.spyOn(entitlementService, 'refundQuota').mockResolvedValue({ refunded: true });
    jest.spyOn(scopeGuard, 'validateLayer1').mockReturnValue({ valid: true });
    jest.spyOn(scopeGuard, 'checkRefusalRateLimit').mockResolvedValue({ allowed: true });

    // Downstream failure
    jest.spyOn(intentStep, 'classifyAndExtract').mockRejectedValue(new Error('Gemini upstream network timeout'));

    await expect(
      orchestrator.runStylistPipeline({
        userId,
        message: 'Looking for a classic navy blazer look',
      })
    ).rejects.toThrow('Gemini upstream network timeout');

    expect(consumeSpy).toHaveBeenCalledWith(userId, 'ai.messages.daily', 1, 'client');
    expect(refundSpy).toHaveBeenCalledWith(userId, 'ai.messages.daily', 1);
  });

  it('refunds message and image quotas when multimodal image request fails downstream', async () => {
    jest.spyOn(entitlementService, 'getEntitlements').mockResolvedValue({
      entitlements: { 'ai.messages.daily': 10, 'ai.imageMessages.daily': 5 },
    });
    const consumeSpy = jest.spyOn(entitlementService, 'consume').mockResolvedValue({ allowed: true });
    const refundSpy = jest.spyOn(entitlementService, 'refundQuota').mockResolvedValue({ refunded: true });
    jest.spyOn(scopeGuard, 'validateLayer1').mockReturnValue({ valid: true });
    jest.spyOn(scopeGuard, 'checkRefusalRateLimit').mockResolvedValue({ allowed: true });

    // Downstream error
    jest.spyOn(intentStep, 'classifyAndExtract').mockRejectedValue(new Error('Multimodal vision parsing failed'));

    await expect(
      orchestrator.runStylistPipeline({
        userId,
        message: 'Pair this garment',
        imageRef: 'murafiq/ai-chat/507f1f77bcf86cd799439011/img.jpg',
      })
    ).rejects.toThrow('Multimodal vision parsing failed');

    expect(consumeSpy).toHaveBeenCalledWith(userId, 'ai.messages.daily', 1, 'client');
    expect(consumeSpy).toHaveBeenCalledWith(userId, 'ai.imageMessages.daily', 1, 'client');

    expect(refundSpy).toHaveBeenCalledWith(userId, 'ai.imageMessages.daily', 1);
    expect(refundSpy).toHaveBeenCalledWith(userId, 'ai.messages.daily', 1);
  });

  it('refunds quotas on Scope Gate Layer 1 validation failure', async () => {
    jest.spyOn(entitlementService, 'getEntitlements').mockResolvedValue({
      entitlements: { 'ai.messages.daily': 10 },
    });
    const consumeSpy = jest.spyOn(entitlementService, 'consume').mockResolvedValue({ allowed: true });
    const refundSpy = jest.spyOn(entitlementService, 'refundQuota').mockResolvedValue({ refunded: true });
    jest.spyOn(scopeGuard, 'validateLayer1').mockReturnValue({ valid: false, refusalCategory: 'empty_prompt' });

    await expect(
      orchestrator.runStylistPipeline({
        userId,
        message: '   ',
      })
    ).rejects.toThrow();

    expect(consumeSpy).toHaveBeenCalledWith(userId, 'ai.messages.daily', 1, 'client');
    expect(refundSpy).toHaveBeenCalledWith(userId, 'ai.messages.daily', 1);
  });
});
