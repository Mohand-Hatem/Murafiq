import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import couponService from '../../src/modules/coupons/coupon.service.js';
import couponRepository from '../../src/modules/coupons/coupon.repository.js';
import { issueCouponSchema } from '../../src/modules/coupons/coupon.validator.js';
import { COUPON_POLICY } from '../../src/common/constants/statuses.constant.js';

describe('Coupon Service & Validator — Admin Cap & Bulk Issuance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('COUPON_POLICY constants', () => {
    it('has MAX_ADMIN_DISCOUNT_EGP set to 1000', () => {
      expect(COUPON_POLICY.MAX_ADMIN_DISCOUNT_EGP).toBe(1000);
      expect(COUPON_POLICY.MAX_DISCOUNT_EGP).toBe(150);
    });
  });

  describe('Validator — issueCouponSchema', () => {
    const validUserId = '60f719b8f1a2c81234567890';
    const validUserId2 = '60f719b8f1a2c81234567891';

    it('allows maxDiscountEgp up to 1000 EGP', () => {
      const parsed = issueCouponSchema.body.safeParse({
        recipientId: validUserId,
        discountPercentage: 20,
        maxDiscountEgp: 1000,
        expiryDays: 30,
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects maxDiscountEgp exceeding 1000 EGP', () => {
      const parsed = issueCouponSchema.body.safeParse({
        recipientId: validUserId,
        discountPercentage: 20,
        maxDiscountEgp: 1500,
        expiryDays: 30,
      });
      expect(parsed.success).toBe(false);
    });

    it('accepts bulk recipientIds array', () => {
      const parsed = issueCouponSchema.body.safeParse({
        recipientIds: [validUserId, validUserId2],
        discountPercentage: 15,
        maxDiscountEgp: 500,
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects if neither recipientId nor recipientIds is provided', () => {
      const parsed = issueCouponSchema.body.safeParse({
        discountPercentage: 15,
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe('calculateDiscount', () => {
    it('caps discount at custom maxDiscountEgp (e.g. 500 EGP)', () => {
      const coupon = {
        discountPercentage: 50,
        maxDiscountEgp: 500,
      };
      // 50% of 2000 is 1000, but capped at 500
      expect(couponService.calculateDiscount(coupon, 2000)).toBe(500);
    });

    it('caps discount at default 150 EGP if maxDiscountEgp is not set on coupon', () => {
      const coupon = {
        discountPercentage: 50,
      };
      expect(couponService.calculateDiscount(coupon, 2000)).toBe(150);
    });
  });

  describe('issueCouponsBulk', () => {
    it('issues individual coupons for each recipientId in the array', async () => {
      const user1 = '60f719b8f1a2c81234567890';
      const user2 = '60f719b8f1a2c81234567891';

      jest.spyOn(couponRepository, 'create').mockImplementation((data) =>
        Promise.resolve({
          _id: 'coupon_id_' + data.recipientId,
          ...data,
        })
      );

      const result = await couponService.issueCouponsBulk({
        recipientIds: [user1, user2],
        discountPercentage: 20,
        maxDiscountEgp: 1000,
        expiryDays: 14,
      });

      expect(result).toHaveLength(2);
      expect(result[0].recipientId).toBe(user1);
      expect(result[1].recipientId).toBe(user2);
      expect(result[0].maxDiscountEgp).toBe(1000);
      expect(result[1].maxDiscountEgp).toBe(1000);
      expect(result[0].code).toMatch(/^MRF/);
      expect(result[1].code).toMatch(/^MRF/);
      expect(result[0].code).not.toBe(result[1].code);
    });

    it('throws 400 if recipientIds is empty', async () => {
      await expect(
        couponService.issueCouponsBulk({
          recipientIds: [],
        })
      ).rejects.toThrow(/recipientIds must be a non-empty array/);
    });
  });
});
