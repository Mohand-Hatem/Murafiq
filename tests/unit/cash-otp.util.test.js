import { describe, it, expect } from '@jest/globals';
import { deriveCashOtp, matchesCashOtp } from '../../src/common/utils/cashOtp.util.js';

// The demo cash OTP is derived (HMAC of the booking id with a server secret), never stored.
describe('deriveCashOtp', () => {
  const id = '6ad9bb4884f35ee7d6b4b3da';

  it('is a 4-digit code', () => {
    expect(deriveCashOtp(id)).toMatch(/^[1-9]\d{3}$/);
  });

  it('is stable for a booking, so the stylist can see it again without it being stored', () => {
    expect(deriveCashOtp(id)).toBe(deriveCashOtp(id));
    expect(deriveCashOtp(id)).toBe(deriveCashOtp({ toString: () => id }));
  });

  it('differs between bookings (not a constant)', () => {
    const codes = new Set(
      Array.from({ length: 40 }, (_, i) => deriveCashOtp(`6ad9bb4884f35ee7d6b4b3${i}`))
    );
    expect(codes.size).toBeGreaterThan(20);
  });

  it('depends on the server secret', () => {
    expect(deriveCashOtp(id, 'secret-one')).not.toBe(deriveCashOtp(id, 'secret-two'));
  });
});

describe('matchesCashOtp', () => {
  const id = '6ad9bb4884f35ee7d6b4b3da';

  it('accepts the right code and rejects a wrong or malformed one', () => {
    const right = deriveCashOtp(id);
    const wrong = right === '1234' ? '4321' : '1234';
    expect(matchesCashOtp(id, right)).toBe(true);
    expect(matchesCashOtp(id, wrong)).toBe(false);
    expect(matchesCashOtp(id, '12')).toBe(false);
  });
});
