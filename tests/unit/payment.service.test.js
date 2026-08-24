import crypto from 'crypto';
import '../../src/common/globals.js';
import { round2 } from '../../src/modules/payments/payment.service.js';
import PaymobProvider from '../../src/modules/payments/providers/paymob.provider.js';

describe('Payment Financial Arithmetic & Rounding', () => {
  it('guarantees platformFeeAmount + stylistPayoutAmount equals total amount without float drift', () => {
    const testCases = [
      { amount: 1000.0, feePercent: 15, expectedFee: 150.0, expectedPayout: 850.0 },
      { amount: 250.0, feePercent: 15, expectedFee: 37.5, expectedPayout: 212.5 },
      { amount: 99.99, feePercent: 15, expectedFee: 15.0, expectedPayout: 84.99 },
      { amount: 333.33, feePercent: 15, expectedFee: 50.0, expectedPayout: 283.33 },
    ];

    for (const tc of testCases) {
      const platformFee = round2(tc.amount * (tc.feePercent / 100));
      const stylistPayout = round2(tc.amount - platformFee);

      expect(platformFee).toBe(tc.expectedFee);
      expect(stylistPayout).toBe(tc.expectedPayout);
      expect(round2(platformFee + stylistPayout)).toBe(tc.amount);
    }
  });

  it('correctly calculates 75% client cancellation refund (< 24h)', () => {
    const sessionAmount = 1000.0;
    const clientRefund = round2(sessionAmount * 0.75);
    const platformRetained = round2(sessionAmount * 0.25);

    expect(clientRefund).toBe(750.0);
    expect(platformRetained).toBe(250.0);
    expect(clientRefund + platformRetained).toBe(sessionAmount);
  });

  it('guarantees ledger balancing invariant on full (100%) refund', () => {
    const amount = 1000.0;
    const refundPercentage = 100;
    const refundAmount = round2((amount * refundPercentage) / 100);
    const isPartial = refundPercentage < 100;
    const platformFeeAmount = isPartial ? round2(amount - refundAmount) : 0;
    const stylistPayoutAmount = 0;

    expect(refundAmount).toBe(1000.0);
    expect(platformFeeAmount).toBe(0.0);
    expect(stylistPayoutAmount).toBe(0.0);
    expect(round2(platformFeeAmount + stylistPayoutAmount + refundAmount)).toBe(amount);
  });

  it('guarantees ledger balancing invariant on partial (75%) refund', () => {
    const amount = 1000.0;
    const refundPercentage = 75;
    const refundAmount = round2((amount * refundPercentage) / 100);
    const isPartial = refundPercentage < 100;
    const platformFeeAmount = isPartial ? round2(amount - refundAmount) : 0;
    const stylistPayoutAmount = 0;

    expect(refundAmount).toBe(750.0);
    expect(platformFeeAmount).toBe(250.0);
    expect(stylistPayoutAmount).toBe(0.0);
    expect(round2(platformFeeAmount + stylistPayoutAmount + refundAmount)).toBe(amount);
  });
});

describe('Paymob HMAC-SHA512 Verification', () => {
  it('correctly validates a genuine HMAC signature and rejects a tampered one', () => {
    const provider = new PaymobProvider();
    provider.hmacSecret = 'test_secret_key_12345';

    const dataObj = {
      amount_cents: 100000,
      created_at: '2026-08-22T01:00:00.000Z',
      currency: 'EGP',
      error_occured: false,
      has_parent_transaction: false,
      id: 998877,
      integration_id: 123456,
      is_3d_secure: true,
      is_auth: false,
      is_capture: true,
      is_refunded: false,
      is_standalone_payment: true,
      is_voided: false,
      order: { id: 554433 },
      owner: 1122,
      pending: false,
      refunded_amount_cents: 0,
      source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
      success: true,
    };

    // Concatenate fields
    const fields = [
      dataObj.amount_cents,
      dataObj.created_at,
      dataObj.currency,
      dataObj.error_occured,
      dataObj.has_parent_transaction,
      dataObj.id,
      dataObj.integration_id,
      dataObj.is_3d_secure,
      dataObj.is_auth,
      dataObj.is_capture,
      dataObj.is_refunded,
      dataObj.is_standalone_payment,
      dataObj.is_voided,
      dataObj.order.id,
      dataObj.owner,
      dataObj.pending,
      dataObj.refunded_amount_cents,
      dataObj.source_data.pan,
      dataObj.source_data.sub_type,
      dataObj.source_data.type,
      dataObj.success,
    ];
    const concatenated = fields.map((v) => String(v)).join('');
    const validHmac = crypto
      .createHmac('sha512', 'test_secret_key_12345')
      .update(concatenated)
      .digest('hex');

    expect(provider.verifyHmac(dataObj, validHmac)).toBe(true);
    expect(provider.verifyHmac(dataObj, 'tampered_signature')).toBe(false);
  });
});
