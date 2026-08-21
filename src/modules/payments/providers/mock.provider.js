import crypto from 'crypto';
import PaymentProviderInterface from './payment-provider.interface.js';

export default class MockProvider extends PaymentProviderInterface {
  async initialize({ amount, bookingId }) {
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

  async handleCallback(payload = {}) {
    return {
      success: true,
      transactionId: payload.transactionId || `mock_tx_${crypto.randomUUID()}`,
      status: payload.status || 'paid',
      bookingId: payload.bookingId || payload.special_reference,
    };
  }
}
