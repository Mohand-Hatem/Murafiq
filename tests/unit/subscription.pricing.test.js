import { jest } from '@jest/globals';

/**
 * Plan pricing resolution (§P0-3).
 *
 * Yearly billing used to be wrong in BOTH directions, because the price and the period were
 * derived independently and by different code:
 *
 *   - `subscribe()` and `checkoutSubscription()` both read `plan.priceYearlyEgp`, a field
 *     that existed nowhere in the codebase. It was always `undefined`, so both silently fell
 *     back to the MONTHLY price — a yearly buyer paid 250 EGP for a 2,900 EGP plan.
 *   - The period, meanwhile, came from the caller-supplied `billingCycle`, which was never
 *     checked against the plan. Buying the (then separate) `client.pro.yearly` code without
 *     naming a cycle charged 2,900 EGP and granted 30 days.
 *
 * resolvePlanPricing is now the single source of both numbers, so they cannot disagree.
 */

const mockPostEntry = jest.fn();
jest.unstable_mockModule('../../src/modules/ledger/ledger.service.js', () => ({
  default: { postEntry: mockPostEntry, egpToPiastres: (n) => Math.round(n * 100) },
  postEntry: mockPostEntry,
  egpToPiastres: (n) => Math.round(n * 100),
}));

const { resolvePlanPricing } = await import(
  '../../src/modules/subscriptions/subscription.service.js'
);
const { CANONICAL_PLANS } = await import('../../src/modules/subscriptions/plan.constants.js');

const planFor = (code) => CANONICAL_PLANS.find((p) => p.code === code);

describe('resolvePlanPricing', () => {
  it('returns the monthly price and a 30-day period for a monthly cycle', () => {
    expect(resolvePlanPricing(planFor('client.pro'), 'monthly')).toEqual({
      priceEgp: 250,
      periodDays: 30,
    });
  });

  it('returns the YEARLY price and a 365-day period for a yearly cycle', () => {
    // The regression that matters: 2900, never 250.
    expect(resolvePlanPricing(planFor('client.pro'), 'yearly')).toEqual({
      priceEgp: 2900,
      periodDays: 365,
    });
  });

  it('defaults to monthly when no cycle is given', () => {
    expect(resolvePlanPricing(planFor('stylist.pro'))).toEqual({ priceEgp: 125, periodDays: 30 });
  });

  it('REFUSES a yearly cycle on a plan with no yearly price, rather than charging monthly', () => {
    // Falling back here is exactly what produced the underpayment bug.
    expect(() => resolvePlanPricing(planFor('client.free'), 'yearly')).toThrow(
      /no yearly billing option/i
    );
  });

  it('never returns a 365-day period at a 30-day price for any plan', () => {
    for (const plan of CANONICAL_PLANS) {
      for (const cycle of ['monthly', 'yearly']) {
        let resolved;
        try {
          resolved = resolvePlanPricing(plan, cycle);
        } catch {
          continue; // plan has no yearly variant — correctly rejected above
        }
        const expectedPrice = cycle === 'yearly' ? plan.priceYearlyEgp : plan.priceEgp;
        const expectedDays = cycle === 'yearly' ? 365 : 30;
        expect(resolved).toEqual({ priceEgp: expectedPrice, periodDays: expectedDays });
      }
    }
  });
});

describe('plan catalogue shape', () => {
  it('carries both prices on one row — no parallel .yearly plan codes', () => {
    // Two plan codes for one product meant the billing cycle lived in two places with
    // nothing keeping them in agreement.
    expect(CANONICAL_PLANS.filter((p) => p.code.endsWith('.yearly'))).toHaveLength(0);
    expect(CANONICAL_PLANS).toHaveLength(9);
  });

  it('gives every paid plan a yearly price and every free plan none', () => {
    for (const plan of CANONICAL_PLANS) {
      if (plan.priceEgp === 0) {
        expect(plan.priceYearlyEgp ?? null).toBeNull();
      } else {
        expect(plan.priceYearlyEgp).toBeGreaterThan(plan.priceEgp);
      }
    }
  });

  it('does not carry a billingCycle of its own', () => {
    // A single cycle on a plan that offers both could only ever disagree with the buyer's.
    for (const plan of CANONICAL_PLANS) {
      expect(plan.billingCycle).toBeUndefined();
    }
  });
});
