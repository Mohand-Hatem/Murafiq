import {
  NO_SHOW_POLICY,
  CANCELLATION_POLICY,
  COUPON_POLICY,
} from '../../src/common/constants/statuses.constant.js';

/**
 * These assert the FINAL business policy, not the implementation. They exist because
 * an earlier pass silently invented a 15% stylist compensation on client cancellations
 * and dropped the platform fee from 20% to 5% — a change that altered revenue on every
 * late cancellation and no test caught it.
 */
describe('No-show and cancellation policy constants', () => {
  describe('client cancellation', () => {
    it('retains 3% and refunds 97% when cancelled 24h or more before the start', () => {
      expect(CANCELLATION_POLICY.EARLY_CLIENT_REFUND_PERCENTAGE).toBe(97);
      expect(CANCELLATION_POLICY.EARLY_PLATFORM_FEE_PERCENTAGE).toBe(3);
      expect(
        CANCELLATION_POLICY.EARLY_CLIENT_REFUND_PERCENTAGE +
          CANCELLATION_POLICY.EARLY_PLATFORM_FEE_PERCENTAGE
      ).toBe(100);
    });

    it('retains 20% and refunds 80% inside 24h, giving the stylist nothing', () => {
      expect(CANCELLATION_POLICY.LATE_CLIENT_REFUND_PERCENTAGE).toBe(80);
      expect(CANCELLATION_POLICY.LATE_PLATFORM_FEE_PERCENTAGE).toBe(20);
      expect(
        CANCELLATION_POLICY.LATE_CLIENT_REFUND_PERCENTAGE +
          CANCELLATION_POLICY.LATE_PLATFORM_FEE_PERCENTAGE
      ).toBe(100);
      // A stylist compensation term must NOT exist on a client cancellation.
      expect(CANCELLATION_POLICY.LATE_STYLIST_COMP_PERCENTAGE).toBeUndefined();
    });
  });

  describe('stylist cancellation', () => {
    it('charges 3% with notice and 20% inside 24h', () => {
      expect(CANCELLATION_POLICY.EARLY_STYLIST_PENALTY_PERCENTAGE).toBe(3);
      expect(CANCELLATION_POLICY.LATE_STYLIST_PENALTY_PERCENTAGE).toBe(20);
    });
  });

  describe('no-show splits', () => {
    it('makes the client whole and penalises the stylist 10% for a stylist no-show', () => {
      const p = NO_SHOW_POLICY.STYLIST;
      expect(p.CLIENT_REFUND_PERCENTAGE).toBe(100);
      expect(p.STYLIST_PERCENTAGE).toBe(0);
      expect(p.PLATFORM_PERCENTAGE).toBe(0);
      expect(p.STYLIST_PENALTY_PERCENTAGE).toBe(10);
      expect(p.ISSUES_COUPON).toBe(true);
    });

    it('splits 60/20/20 for a client no-show', () => {
      const p = NO_SHOW_POLICY.CLIENT;
      expect(p.CLIENT_REFUND_PERCENTAGE).toBe(60);
      expect(p.STYLIST_PERCENTAGE).toBe(20);
      expect(p.PLATFORM_PERCENTAGE).toBe(20);
      expect(p.ISSUES_COUPON).toBe(false);
    });

    it('never lets a split exceed or fall short of the booking value', () => {
      for (const key of ['STYLIST', 'CLIENT']) {
        const p = NO_SHOW_POLICY[key];
        expect(
          p.CLIENT_REFUND_PERCENTAGE + p.STYLIST_PERCENTAGE + p.PLATFORM_PERCENTAGE
        ).toBe(100);
      }
    });

    it('never earns the platform more from a no-show than from a late cancellation', () => {
      // Otherwise Murafiq would be financially better off when a booking is ghosted
      // than when it is cancelled properly — a direct incentive against good UX.
      expect(NO_SHOW_POLICY.CLIENT.PLATFORM_PERCENTAGE).toBeLessThanOrEqual(
        CANCELLATION_POLICY.LATE_PLATFORM_FEE_PERCENTAGE
      );
      expect(NO_SHOW_POLICY.STYLIST.PLATFORM_PERCENTAGE).toBeLessThanOrEqual(
        CANCELLATION_POLICY.LATE_PLATFORM_FEE_PERCENTAGE
      );
    });

    it('leaves a ghosting client worse off than one who cancels late', () => {
      // If ghosting refunded as much as cancelling, the rule would deter nothing.
      expect(NO_SHOW_POLICY.CLIENT.CLIENT_REFUND_PERCENTAGE).toBeLessThan(
        CANCELLATION_POLICY.LATE_CLIENT_REFUND_PERCENTAGE
      );
    });
  });

  describe('report gating', () => {
    it('requires a grace period and a response window', () => {
      expect(NO_SHOW_POLICY.REPORT_GRACE_MINUTES).toBeGreaterThan(0);
      expect(NO_SHOW_POLICY.RESPONSE_WINDOW_HOURS).toBeGreaterThan(0);
    });
  });

  describe('coupon defaults', () => {
    it('caps the discount in absolute EGP so exposure cannot scale with booking value', () => {
      expect(COUPON_POLICY.NO_SHOW_DISCOUNT_PERCENTAGE).toBe(10);
      expect(COUPON_POLICY.MAX_DISCOUNT_EGP).toBe(150);
      expect(COUPON_POLICY.EXPIRY_DAYS).toBe(14);
    });
  });
});

describe('Coupon discount calculation', () => {
  let calculateDiscount;

  beforeAll(async () => {
    ({ calculateDiscount } = await import('../../src/modules/coupons/coupon.service.js'));
  });

  const coupon = { discountPercentage: 10, maxDiscountEgp: 150 };

  it('applies the percentage on a normal booking', () => {
    expect(calculateDiscount(coupon, 500)).toBe(50);
  });

  it('applies the cap once the percentage would exceed it', () => {
    // 10% of 5,000 EGP would be 500 — the cap binds at 150.
    expect(calculateDiscount(coupon, 5000)).toBe(150);
  });

  it('binds exactly at the cap boundary', () => {
    expect(calculateDiscount(coupon, 1500)).toBe(150);
    expect(calculateDiscount(coupon, 1499)).toBe(149.9);
  });

  it('never returns a negative discount', () => {
    expect(calculateDiscount(coupon, 0)).toBe(0);
  });

  it('rounds to 2 decimals, matching the EGP money convention', () => {
    expect(calculateDiscount(coupon, 333.33)).toBe(33.33);
  });
});
