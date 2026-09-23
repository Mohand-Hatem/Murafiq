/**
 * Phase 15E Step 1 — Product Search Entitlements & Subscription Configuration Tests.
 *
 * Covers:
 * 1. CANONICAL_PLANS tier configuration for ai.productSearch.monthly (0, 15, 30, 45, 60).
 * 2. FALLBACK_FREE_ENTITLEMENTS includes ai.productSearch.monthly: 0.
 * 3. checkQuota returns allowed: false for free tier (0 limit) without throwing.
 * 4. checkQuota returns allowed: true for paid tier with remaining quota.
 * 5. checkQuota returns allowed: false when paid tier quota is exhausted.
 * 6. consume throws ApiError 429 when quota is 0 or exhausted.
 * 7. consume succeeds when user has remaining quota on paid tier.
 */

import { describe, it, expect, jest, afterEach } from '@jest/globals';
import '../../src/common/globals.js';
import {
  CANONICAL_PLANS,
  FALLBACK_FREE_ENTITLEMENTS,
} from '../../src/modules/subscriptions/plan.constants.js';
import {
  checkQuota,
  consume,
} from '../../src/modules/subscriptions/entitlement.service.js';
import subscriptionRepository from '../../src/modules/subscriptions/subscription.repository.js';
import planRepository from '../../src/modules/subscriptions/plan.repository.js';
import UsageCounter from '../../src/modules/subscriptions/usage-counter.model.js';

describe('Phase 15E Step 1 — Product Search Entitlements Configuration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Plan Constants Definition', () => {
    it('defines ai.productSearch.monthly: 0 for client.free', () => {
      const freePlan = CANONICAL_PLANS.find((p) => p.code === 'client.free');
      expect(freePlan).toBeDefined();
      expect(freePlan.entitlements['ai.productSearch.monthly']).toBe(0);
    });

    it('defines ai.productSearch.monthly: 15 for client.basic', () => {
      const basicPlan = CANONICAL_PLANS.find((p) => p.code === 'client.basic');
      expect(basicPlan).toBeDefined();
      expect(basicPlan.entitlements['ai.productSearch.monthly']).toBe(15);
    });

    it('defines ai.productSearch.monthly: 30 for client.mid', () => {
      const midPlan = CANONICAL_PLANS.find((p) => p.code === 'client.mid');
      expect(midPlan).toBeDefined();
      expect(midPlan.entitlements['ai.productSearch.monthly']).toBe(30);
    });

    it('defines ai.productSearch.monthly: 45 for client.pro', () => {
      const proPlan = CANONICAL_PLANS.find((p) => p.code === 'client.pro');
      expect(proPlan).toBeDefined();
      expect(proPlan.entitlements['ai.productSearch.monthly']).toBe(45);
    });

    it('defines ai.productSearch.monthly: 60 for client.enterprise', () => {
      const entPlan = CANONICAL_PLANS.find((p) => p.code === 'client.enterprise');
      expect(entPlan).toBeDefined();
      expect(entPlan.entitlements['ai.productSearch.monthly']).toBe(60);
    });

    it('defines fallback free client entitlement as 0', () => {
      expect(FALLBACK_FREE_ENTITLEMENTS.client['ai.productSearch.monthly']).toBe(0);
    });
  });

  describe('checkQuota Helper', () => {
    it('returns allowed: false for free tier without throwing an error', async () => {
      jest.spyOn(subscriptionRepository, 'findActiveByUserId').mockResolvedValue(null);

      const result = await checkQuota('free_user_1', 'ai.productSearch.monthly', 1, 'client');
      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(0);
      expect(result.remaining).toBe(0);
      expect(result.planCode).toBe('client.free');
    });

    it('returns allowed: true for paid tier with unused quota', async () => {
      jest.spyOn(subscriptionRepository, 'findActiveByUserId').mockResolvedValue({
        planCode: 'client.mid',
        currentPeriodEnd: null,
      });
      jest.spyOn(planRepository, 'findByCode').mockResolvedValue({
        code: 'client.mid',
        tier: 'basic',
        entitlements: {
          'ai.productSearch.monthly': 30,
        },
      });
      jest.spyOn(UsageCounter, 'findOne').mockResolvedValue(null);

      const result = await checkQuota('paid_user_1', 'ai.productSearch.monthly', 1, 'client');
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(30);
      expect(result.used).toBe(0);
      expect(result.remaining).toBe(30);
    });

    it('returns allowed: false when paid tier monthly quota is exhausted', async () => {
      jest.spyOn(subscriptionRepository, 'findActiveByUserId').mockResolvedValue({
        planCode: 'client.mid',
        currentPeriodEnd: null,
      });
      jest.spyOn(planRepository, 'findByCode').mockResolvedValue({
        code: 'client.mid',
        tier: 'basic',
        entitlements: {
          'ai.productSearch.monthly': 30,
        },
      });
      jest.spyOn(UsageCounter, 'findOne').mockResolvedValue({
        used: 30,
      });

      const result = await checkQuota('paid_user_1', 'ai.productSearch.monthly', 1, 'client');
      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(30);
      expect(result.used).toBe(30);
      expect(result.remaining).toBe(0);
    });
  });

  describe('consume Enforcement', () => {
    it('throws ApiError 429 when free tier user attempts to consume product search quota', async () => {
      jest.spyOn(subscriptionRepository, 'findActiveByUserId').mockResolvedValue(null);

      await expect(
        consume('free_user_1', 'ai.productSearch.monthly', 1, 'client')
      ).rejects.toThrow(ApiError);
    });

    it('successfully consumes quota when paid user has capacity', async () => {
      jest.spyOn(subscriptionRepository, 'findActiveByUserId').mockResolvedValue({
        planCode: 'client.pro',
        currentPeriodEnd: null,
      });
      jest.spyOn(planRepository, 'findByCode').mockResolvedValue({
        code: 'client.pro',
        tier: 'pro',
        entitlements: {
          'ai.productSearch.monthly': 45,
        },
      });
      jest.spyOn(UsageCounter, 'findOneAndUpdate').mockResolvedValue({
        used: 1,
      });

      const res = await consume('paid_user_pro', 'ai.productSearch.monthly', 1, 'client');
      expect(res.success).toBe(true);
      expect(res.used).toBe(1);
      expect(res.limit).toBe(45);
    });
  });
});
