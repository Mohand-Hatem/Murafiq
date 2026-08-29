import crypto from 'crypto';
import { Buffer } from 'node:buffer';
import env from '../../../config/env.config.js';
import PaymentProviderInterface from './payment-provider.interface.js';

export default class MockProvider extends PaymentProviderInterface {
  async initialize({ amount: _amount, bookingId }) {
    const mockTxId = `mock_tx_${crypto.randomUUID()}`;
    const mockClientSecret = `mock_secret_${crypto.randomUUID()}`;

    return {
      paymentUrl: `https://mock-checkout.local/pay/${bookingId}?secret=${mockClientSecret}`,
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

  async refund(transactionId, amount) {
    return {
      status: 'refunded',
      transactionId,
      amount,
      refundId: `mock_ref_${crypto.randomUUID()}`,
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
    };
  }
}
