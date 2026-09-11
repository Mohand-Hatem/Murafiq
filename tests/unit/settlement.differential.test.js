import { describe, it, expect } from '@jest/globals';
import { calculateCancellationOutcome } from '../../src/modules/bookings/booking.service.js';
import { computeSettlement } from '../../src/common/settlement.js';

const PRICES = [100, 100.01, 250.5, 333.33, 777.77, 1000, 4999.99];
const HOURS = [0, 0.5, 1, 12, 23.99, 24, 24.01, 48, 720];
const ROLES = ['client', 'stylist', 'admin'];

describe('computeSettlement reproduces calculateCancellationOutcome exactly', () => {
  for (const price of PRICES) {
    for (const hours of HOURS) {
      for (const role of ROLES) {
        it(`price=${price} hours=${hours} role=${role}`, () => {
          const scheduled = new Date(Date.now() + hours * 3600 * 1000);
          const booking = { price, scheduledDate: scheduled, scheduledStartMinute: 0 };
          // calculateCancellationOutcome prices 'admin' on the client branch at its call
          // sites, so the differential compares like with like.
          const legacyRole = role === 'admin' ? 'client' : role;
          const legacy = calculateCancellationOutcome(booking, legacyRole, new Date());
          const next = computeSettlement({
            price,
            event: 'CANCELLATION',
            actor: role,
            hoursUntilSession: legacy.hoursUntilSession,
          });

          expect(next.tier).toBe(legacy.tier);
          expect(next.refundPercentage).toBe(legacy.refundPercentage);
          expect(next.refundAmount).toBeCloseTo(legacy.refundAmount, 2);
          expect(next.platformFeeAmount).toBeCloseTo(legacy.platformFeeAmount, 2);
          expect(next.stylistCompensationAmount).toBeCloseTo(legacy.stylistCompensationAmount, 2);
          expect(next.penaltyAmount).toBeCloseTo(legacy.penaltyAmount, 2);
          expect(next.couponEligible).toBe(legacy.couponEligible);
          expect(next.isEarly).toBe(legacy.isEarly);
        });
      }
    }
  }
});
