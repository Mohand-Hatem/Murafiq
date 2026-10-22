import { describe, it, expect } from '@jest/globals';
import { PLATFORM_FEE_DEFAULT_PERCENTAGE } from '../../src/common/constants/defaults.constant.js';
import { computeSettlement } from '../../src/common/settlement.js';

// Product owner decision 2026-10-22: the platform commission is 20%. One named constant is the
// single source for every fallback (env schema default, booking/payment services, settlement).
describe('platform fee default', () => {
  it('is 20%', () => {
    expect(PLATFORM_FEE_DEFAULT_PERCENTAGE).toBe(20);
  });

  it('is what dispute arbitration splits the retained amount by when no percentage is passed', () => {
    const res = computeSettlement({
      price: 1000,
      event: 'DISPUTE',
      actor: 'admin',
      refundPercentage: 0,
    });

    expect(res.platformFeeAmount).toBe(200);
    expect(res.stylistCompensationAmount).toBe(800);
  });

  it('still honours an explicit percentage (payments keep the fee they were charged)', () => {
    const res = computeSettlement({
      price: 1000,
      event: 'DISPUTE',
      actor: 'admin',
      refundPercentage: 0,
      platformFeePercentage: 15,
    });

    expect(res.platformFeeAmount).toBe(150);
    expect(res.stylistCompensationAmount).toBe(850);
  });
});
