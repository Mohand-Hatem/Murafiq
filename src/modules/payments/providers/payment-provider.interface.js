export default class PaymentProviderInterface {
  async initialize({ amount, bookingId, customer, currency }) {
    throw new Error('Method initialize() must be implemented');
  }

  async verify(transactionId) {
    throw new Error('Method verify() must be implemented');
  }

  async refund(transactionId, amount) {
    throw new Error('Method refund() must be implemented');
  }

  async handleCallback(payload, query) {
    throw new Error('Method handleCallback() must be implemented');
  }
}
