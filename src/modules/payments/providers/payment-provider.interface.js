export default class PaymentProviderInterface {
  async initializePayment(_amount, _bookingId, _customer, _currency) {
    throw new Error('Method initializePayment() must be implemented');
  }

  async verifyPayment(_transactionId) {
    throw new Error('Method verifyPayment() must be implemented');
  }

  async refundPayment(_transactionId, _amount) {
    throw new Error('Method refundPayment() must be implemented');
  }

  handleWebhook(_payload, _query) {
    throw new Error('Method handleWebhook() must be implemented');
  }
}
