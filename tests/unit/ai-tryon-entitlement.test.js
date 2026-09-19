/**
 * Phase 15F Step 2 — Try-On Entitlements & Subscription Configuration Tests.
 *
 * Covers:
 * 1. CANONICAL_PLANS configuration for ai.tryOn.monthly (0, 5, 15, 30, 75) and ai.tryOn.trial.lifetime (1 on free, 0 on paid).
 * 2. FALLBACK_FREE_ENTITLEMENTS for client try-on quotas.
 * 3. resolvePeriodDetails for monthly (YYYY-MM, Cairo), lifetime, and daily keys.
 * 4. consumeTryOnQuota cascading logic:
 *    - Consumes monthly quota first if available.
 *    - Falls back to lifetime trial if monthly is 0 or exhausted.
 *    - Throws ApiError 429 when both monthly and lifetime are exhausted.
 * 5. refundQuota supporting monthly and lifetime metrics.
 */

import { describe, it, expect, jest, afterEach } from '@jest/globals';
import '../../src/common/globals.js';
import {
  CANONICAL_PLANS,
  FALLBACK_FREE_ENTITLEMENTS,
} from '../../src/modules/subscriptions/plan.constants.js';
import {
  resolvePeriodDetails,
  consumeTryOnQuota,
  refundQuota,
} from '../../src/modules/subscriptions/entitlement.service.js';
import subscriptionRepository from '../../src/modules/subscriptions/subscription.repository.js';
import planRepository from '../../src/modules/subscriptions/plan.repository.js';
import UsageCounter from '../../src/modules/subscriptions/usage-counter.model.js';

describe('Phase 15F Step 2 — Try-On Entitlements Configuration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Plan Constants Definition', () => {
    it('defines ai.tryOn.monthly: 0 and ai.tryOn.trial.lifetime: 1 for client.free', () => {
      const freePlan = CANONICAL_PLANS.find((p) => p.code === 'client.free');
      expect(freePlan).toBeDefined();
      expect(freePlan.entitlements['ai.tryOn.monthly']).toBe(0);
      expect(freePlan.entitlements['ai.tryOn.trial.lifetime']).toBe(1);
    });

    it('defines ai.tryOn.monthly: 5 and ai.tryOn.trial.lifetime: 0 for client.basic', () => {
      const basicPlan = CANONICAL_PLANS.find((p) => p.code === 'client.basic');
      expect(basicPlan).toBeDefined();
      expect(basicPlan.entitlements['ai.tryOn.monthly']).toBe(5);
      expect(basicPlan.entitlements['ai.tryOn.trial.lifetime']).toBe(0);
    });

    it('defines ai.tryOn.monthly: 15 and ai.tryOn.trial.lifetime: 0 for client.mid', () => {
      const midPlan = CANONICAL_PLANS.find((p) => p.code === 'client.mid');
      expect(midPlan).toBeDefined();
      expect(midPlan.entitlements['ai.tryOn.monthly']).toBe(15);
      expect(midPlan.entitlements['ai.tryOn.trial.lifetime']).toBe(0);
    });

    it('defines ai.tryOn.monthly: 30 and ai.tryOn.trial.lifetime: 0 for client.pro', () => {
      const proPlan = CANONICAL_PLANS.find((p) => p.code === 'client.pro');
      expect(proPlan).toBeDefined();
      expect(proPlan.entitlements['ai.tryOn.monthly']).toBe(30);
      expect(proPlan.entitlements['ai.tryOn.trial.lifetime']).toBe(0);
    });

    it('defines ai.tryOn.monthly: 75 and ai.tryOn.trial.lifetime: 0 for client.enterprise', () => {
      const entPlan = CANONICAL_PLANS.find((p) => p.code === 'client.enterprise');
      expect(entPlan).toBeDefined();
      expect(entPlan.entitlements['ai.tryOn.monthly']).toBe(75);
      expect(entPlan.entitlements['ai.tryOn.trial.lifetime']).toBe(0);
    });

    it('defines fallback free client entitlements correctly', () => {
      expect(FALLBACK_FREE_ENTITLEMENTS.client['ai.tryOn.monthly']).toBe(0);
      expect(FALLBACK_FREE_ENTITLEMENTS.client['ai.tryOn.trial.lifetime']).toBe(1);
    });
  });

  describe('resolvePeriodDetails', () => {
    it('resolves .monthly metric to YYYY-MM format with 400-day TTL', () => {
      const details = resolvePeriodDetails('ai.tryOn.monthly');
      expect(details.granularity).toBe('monthly');
      expect(details.periodKey).toMatch(/^\d{4}-\d{2}$/);
      expect(details.expiresAt).toBeInstanceOf(Date);
      const diffDays = (details.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(390);
    });

    it('resolves .lifetime metric to "lifetime" with null expiresAt', () => {
      const details = resolvePeriodDetails('ai.tryOn.trial.lifetime');
      expect(details.granularity).toBe('lifetime');
      expect(details.periodKey).toBe('lifetime');
      expect(details.expiresAt).toBeNull();
    });

    it('resolves default / daily metric to YYYY-MM-DD format with 40-day TTL', () => {
      const details = resolvePeriodDetails('ai.messages.daily');
      expect(details.granularity).toBe('daily');
      expect(details.periodKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(details.expiresAt).toBeInstanceOf(Date);
      const diffDays = (details.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(35);
    });
  });

  describe('consumeTryOnQuota Cascading Logic', () => {
    it('consumes monthly quota when available on paid plan', async () => {
      jest.spyOn(subscriptionRepository, 'findActiveByUserId').mockResolvedValue({
        planCode: 'client.basic',
        currentPeriodEnd: null,
      });
      jest.spyOn(planRepository, 'findByCode').mockResolvedValue({
        code: 'client.basic',
        tier: 'basic',
        entitlements: {
          'ai.tryOn.monthly': 5,
          'ai.tryOn.trial.lifetime': 0,
        },
      });
      jest.spyOn(UsageCounter, 'findOne').mockResolvedValue(null);
      jest.spyOn(UsageCounter, 'findOneAndUpdate').mockResolvedValue({ used: 1 });

      const result = await consumeTryOnQuota('paid_user_1', 'client');
      expect(result.success).toBe(true);
      expect(result.quotaSource).toBe('monthly');
    });

    it('falls back to lifetime trial on free tier when monthly quota is 0', async () => {
      jest.spyOn(subscriptionRepository, 'findActiveByUserId').mockResolvedValue(null);
      jest.spyOn(UsageCounter, 'findOne').mockResolvedValue(null);
      jest.spyOn(UsageCounter, 'findOneAndUpdate').mockResolvedValue({ used: 1 });

      const result = await consumeTryOnQuota('free_user_1', 'client');
      expect(result.success).toBe(true);
      expect(result.quotaSource).toBe('lifetime');
    });

    it('throws ApiError 429 when free tier user has already consumed lifetime trial', async () => {
      jest.spyOn(subscriptionRepository, 'findActiveByUserId').mockResolvedValue(null);
      // findOne returns used: 1 for lifetime metric
      jest.spyOn(UsageCounter, 'findOne').mockImplementation(({ metric }) => {
        if (metric === 'ai.tryOn.trial.lifetime') {
          return Promise.resolve({ used: 1 });
        }
        return Promise.resolve(null);
      });

      await expect(consumeTryOnQuota('free_user_exhausted', 'client')).rejects.toThrow(ApiError);
    });

    it('throws ApiError 429 when paid tier user has exhausted monthly quota', async () => {
      jest.spyOn(subscriptionRepository, 'findActiveByUserId').mockResolvedValue({
        planCode: 'client.basic',
        currentPeriodEnd: null,
      });
      jest.spyOn(planRepository, 'findByCode').mockResolvedValue({
        code: 'client.basic',
        tier: 'basic',
        entitlements: {
          'ai.tryOn.monthly': 5,
          'ai.tryOn.trial.lifetime': 0,
        },
      });
      jest.spyOn(UsageCounter, 'findOne').mockImplementation(({ metric }) => {
        if (metric === 'ai.tryOn.monthly') {
          return Promise.resolve({ used: 5 });
        }
        return Promise.resolve(null);
      });

      await expect(consumeTryOnQuota('paid_user_exhausted', 'client')).rejects.toThrow(ApiError);
    });
  });

  describe('refundQuota', () => {
    it('refunds monthly quota using Cairo YYYY-MM periodKey', async () => {
      const updateSpy = jest.spyOn(UsageCounter, 'updateOne').mockResolvedValue({});

      await refundQuota('user_refund_1', 'ai.tryOn.monthly', 1);

      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectId: 'user_refund_1',
          metric: 'ai.tryOn.monthly',
          periodKey: expect.stringMatching(/^\d{4}-\d{2}$/),
        }),
        { $inc: { used: -1 } }
      );
    });

    it('refunds lifetime quota using "lifetime" periodKey', async () => {
      const updateSpy = jest.spyOn(UsageCounter, 'updateOne').mockResolvedValue({});

      await refundQuota('user_refund_2', 'ai.tryOn.trial.lifetime', 1);

      expect(updateSpy).toHaveBeenCalledWith(
        {
          subjectId: 'user_refund_2',
          metric: 'ai.tryOn.trial.lifetime',
          periodKey: 'lifetime',
        },
        { $inc: { used: -1 } }
      );
    });
  });
});
