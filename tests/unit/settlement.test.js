import { describe, it, expect } from '@jest/globals';
import { computeSettlement, round2 } from '../../src/common/settlement.js';

// Revision §H, transcribed. price 1000 EGP keeps every expected value exact.
const P = 1000;

describe('computeSettlement — CANCELLATION', () => {
  it('client, >= 24h: 97/3, no penalty, no coupon', () => {
    expect(
      computeSettlement({ price: P, event: 'CANCELLATION', actor: 'client', hoursUntilSession: 24 })
    ).toMatchObject({
      tier: 'EARLY_CLIENT_CANCEL',
      refundPercentage: 97,
      refundAmount: 970,
      platformFeeAmount: 30,
      stylistCompensationAmount: 0,
      penaltyAmount: 0,
      couponEligible: false,
      isEarly: true,
    });
  });

  it('client, < 24h: 80/20', () => {
    expect(
      computeSettlement({ price: P, event: 'CANCELLATION', actor: 'client', hoursUntilSession: 23.9 })
    ).toMatchObject({
      tier: 'LATE_CLIENT_CANCEL',
      refundPercentage: 80,
      refundAmount: 800,
      platformFeeAmount: 200,
      stylistCompensationAmount: 0,
      penaltyAmount: 0,
      couponEligible: false,
      isEarly: false,
    });
  });

  it('stylist, >= 24h: client 100%, stylist penalty 3%, no coupon', () => {
    expect(
      computeSettlement({ price: P, event: 'CANCELLATION', actor: 'stylist', hoursUntilSession: 48 })
    ).toMatchObject({
      tier: 'EARLY_STYLIST_CANCEL',
      refundPercentage: 100,
      refundAmount: 1000,
      platformFeeAmount: 0,
      penaltyAmount: 30,
      couponEligible: false,
    });
  });

  it('stylist, < 24h: client 100%, stylist penalty 20%, coupon eligible', () => {
    expect(
      computeSettlement({ price: P, event: 'CANCELLATION', actor: 'stylist', hoursUntilSession: 2 })
    ).toMatchObject({
      tier: 'LATE_STYLIST_CANCEL',
      refundPercentage: 100,
      refundAmount: 1000,
      platformFeeAmount: 0,
      penaltyAmount: 200,
      couponEligible: true,
    });
  });

  it('admin is priced on the client branch — never assesses a stylist penalty', () => {
    const admin = computeSettlement({ price: P, event: 'CANCELLATION', actor: 'admin', hoursUntilSession: 2 });
    const client = computeSettlement({ price: P, event: 'CANCELLATION', actor: 'client', hoursUntilSession: 2 });
    expect(admin).toEqual(client);
  });

  it('the 24h boundary is client-favourable at exactly 24.0', () => {
    expect(
      computeSettlement({ price: P, event: 'CANCELLATION', actor: 'client', hoursUntilSession: 24 }).isEarly
    ).toBe(true);
  });
});

describe('computeSettlement — NO_SHOW', () => {
  it('stylist no-show: 100/0/0, penalty 10%, coupon', () => {
    expect(computeSettlement({ price: P, event: 'NO_SHOW', actor: 'stylist' })).toMatchObject({
      tier: 'NO_SHOW_STYLIST',
      refundPercentage: 100,
      refundAmount: 1000,
      platformFeeAmount: 0,
      stylistCompensationAmount: 0,
      penaltyAmount: 100,
      couponEligible: true,
    });
  });

  it('client no-show: 60/20/20, no penalty, no coupon', () => {
    expect(computeSettlement({ price: P, event: 'NO_SHOW', actor: 'client' })).toMatchObject({
      tier: 'NO_SHOW_CLIENT',
      refundPercentage: 60,
      refundAmount: 600,
      platformFeeAmount: 200,
      stylistCompensationAmount: 200,
      penaltyAmount: 0,
      couponEligible: false,
    });
  });

  it('client no-show: residual technique guarantees exact conservation on fractional 333.33', () => {
    const s = computeSettlement({ price: 333.33, event: 'NO_SHOW', actor: 'client' });
    expect(s).toMatchObject({
      refundAmount: 200,
      stylistCompensationAmount: 66.67,
      platformFeeAmount: 66.66,
    });
    expect(round2(s.refundAmount + s.stylistCompensationAmount + s.platformFeeAmount)).toBe(333.33);
  });

  it('client no-show: residual technique guarantees exact conservation on fractional 777.77', () => {
    const s = computeSettlement({ price: 777.77, event: 'NO_SHOW', actor: 'client' });
    expect(s).toMatchObject({
      refundAmount: 466.66,
      stylistCompensationAmount: 155.55,
      platformFeeAmount: 155.56,
    });
    expect(round2(s.refundAmount + s.stylistCompensationAmount + s.platformFeeAmount)).toBe(777.77);
  });
});

describe('computeSettlement — DISPUTE', () => {
  it('splits the retained amount by the platform fee percentage', () => {
    expect(
      computeSettlement({
        price: P,
        event: 'DISPUTE',
        actor: 'admin',
        refundPercentage: 25,
        platformFeePercentage: 15,
      })
    ).toMatchObject({
      tier: 'DISPUTE_ARBITRATION',
      refundPercentage: 25,
      refundAmount: 250,
      stylistCompensationAmount: 637.5,
      platformFeeAmount: 112.5,
      penaltyAmount: 0,
      couponEligible: false,
    });
  });

  it('a 100% arbitration refund leaves the stylist nothing', () => {
    expect(
      computeSettlement({
        price: P,
        event: 'DISPUTE',
        actor: 'admin',
        refundPercentage: 100,
        platformFeePercentage: 15,
      })
    ).toMatchObject({ refundAmount: 1000, stylistCompensationAmount: 0, platformFeeAmount: 0 });
  });
});

describe('the settlement identity holds for every branch', () => {
  const cases = [
    { price: 333.33, event: 'CANCELLATION', actor: 'client', hoursUntilSession: 30 },
    { price: 333.33, event: 'CANCELLATION', actor: 'client', hoursUntilSession: 1 },
    { price: 777.77, event: 'CANCELLATION', actor: 'stylist', hoursUntilSession: 1 },
    { price: 100.01, event: 'NO_SHOW', actor: 'client' },
    { price: 100.01, event: 'NO_SHOW', actor: 'stylist' },
    { price: 333.33, event: 'NO_SHOW', actor: 'client' },
    { price: 333.33, event: 'NO_SHOW', actor: 'stylist' },
    { price: 777.77, event: 'NO_SHOW', actor: 'client' },
    { price: 777.77, event: 'NO_SHOW', actor: 'stylist' },
    { price: 999.99, event: 'DISPUTE', actor: 'admin', refundPercentage: 37, platformFeePercentage: 15 },
  ];

  it.each(cases)('refund + stylist + platform === price exactly for %o', (input) => {
    const s = computeSettlement(input);
    const total = round2(s.refundAmount + s.stylistCompensationAmount + s.platformFeeAmount);
    expect(total).toBe(input.price);
  });

  it.each(cases)('never returns a negative component for %o', (input) => {
    const s = computeSettlement(input);
    expect(s.refundAmount).toBeGreaterThanOrEqual(0);
    expect(s.stylistCompensationAmount).toBeGreaterThanOrEqual(0);
    expect(s.platformFeeAmount).toBeGreaterThanOrEqual(0);
    expect(s.penaltyAmount).toBeGreaterThanOrEqual(0);
  });
});

