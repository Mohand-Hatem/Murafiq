import crypto from 'crypto';
import { Buffer } from 'node:buffer';
import env from '../../../config/env.config.js';
import PaymentProviderInterface from './payment-provider.interface.js';

export default class MockProvider extends PaymentProviderInterface {
  async initialize({ amount: _amount, bookingId, reference }) {
    const ref = (reference || bookingId || 'mock_ref').toString();
    const mockTxId = `mock_tx_${crypto.randomUUID()}`;
    const mockClientSecret = `mock_secret_${crypto.randomUUID()}`;

    return {
      paymentUrl: `https://mock-checkout.local/pay/${ref}?secret=${mockClientSecret}`,
      clientSecret: mockClientSecret,
      providerTransactionId: mockTxId,
      providerIntentionId: `mock_int_${crypto.randomUUID()}`,
    };
  }

  async verify(transactionId) {
    return {
      status: 'paid',
      transactionId,
    };
  }

  async refund(transactionId, amount, { idempotencyKey = null } = {}) {
    return {
      status: 'refunded',
      transactionId,
      amount,
      refundId: `mock_ref_${crypto.randomUUID()}`,
      idempotencyKey,
    };
  }

  async handleCallback(payload = {}, query = {}) {
    if (env.NODE_ENV === 'production') {
      throw new ApiError(403, 'Mock payment provider is forbidden in production');
    }

    const providedSecret = payload.secret || query.secret;
    const expectedSecret = env.MOCK_WEBHOOK_SECRET;

    const isAuthentic =
      typeof providedSecret === 'string' &&
      typeof expectedSecret === 'string' &&
      Buffer.from(providedSecret).length === Buffer.from(expectedSecret).length &&
      crypto.timingSafeEqual(Buffer.from(providedSecret), Buffer.from(expectedSecret));

    if (!isAuthentic) {
      throw new ApiError(400, 'Invalid mock webhook secret');
    }

    return {
      success: true,
      transactionId: payload.transactionId || `mock_tx_${crypto.randomUUID()}`,
      status: payload.status || 'paid',
      bookingId: payload.bookingId || payload.special_reference,
      // Test-controllable amount-mismatch simulation (see docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md
      // finding X19 and HARDEN-006, "mock provider cannot simulate a failed webhook").
      // undefined/omitted means "provider did not report an amount", matching a real
      // Paymob callback that always does — tests exercise the mismatch path by passing
      // amountCents explicitly.
      amountCents:
        payload.amountCents !== undefined && payload.amountCents !== null
          ? Number(payload.amountCents)
          : null,
    };
  }
}
