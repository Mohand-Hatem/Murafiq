import crypto from 'crypto';
import env from '../../../config/env.config.js';
import { logger } from '../../../config/logger.config.js';
import PaymentProviderInterface from './payment-provider.interface.js';

export default class PaymobProvider extends PaymentProviderInterface {
  constructor() {
    super();
    this.baseUrl = env.PAYMOB_BASE_URL || 'https://accept.paymob.com';
    this.secretKey = env.PAYMOB_SECRET_KEY;
    this.apiKey = env.PAYMOB_API_KEY; // legacy key, only used by refund()'s auth-token exchange
    this.publicKey = env.PAYMOB_PUBLIC_KEY;
    this.hmacSecret = env.PAYMOB_HMAC_SECRET;
    this.cardIntegrationId = parseInt(env.PAYMOB_CARD_INTEGRATION_ID, 10) || 0;
    this.walletIntegrationId = env.PAYMOB_WALLET_INTEGRATION_ID
      ? parseInt(env.PAYMOB_WALLET_INTEGRATION_ID, 10)
      : undefined;
  }

  /**
   * Intention API (v1) - Creates a payment intention and returns client_secret & checkout URL.
   */
  async initialize({ amount, bookingId, customer = {}, currency = 'EGP' }) {
    const paymentMethods = [this.cardIntegrationId];
    if (this.walletIntegrationId) {
      paymentMethods.push(this.walletIntegrationId);
    }

    const amountInCents = Math.round(amount * 100);
    const names = (customer.name || 'Client User').trim().split(' ');
    const firstName = names[0] || 'Client';
    const lastName = names.slice(1).join(' ') || 'User';

    const payload = {
      amount: amountInCents,
      currency,
      payment_methods: paymentMethods,
      items: [
        {
          name: 'Personal Styling Session',
          amount: amountInCents,
          description: `Booking #${bookingId}`,
          quantity: 1,
        },
      ],
      billing_data: {
        first_name: firstName,
        last_name: lastName,
        email: customer.email || 'customer@example.com',
        phone_number: customer.phone || '+201000000000',
        apartment: 'NA',
        floor: 'NA',
        street: 'NA',
        building: 'NA',
        shipping_method: 'PKG',
        postal_code: 'NA',
        city: 'Cairo',
        country: 'EG',
        state: 'Cairo',
      },
      special_reference: bookingId.toString(),
      // Paymob posts the webhook to notification_url — it must be THIS backend's public origin,
      // not the frontend's. redirection_url is where the customer's browser goes after checkout,
      // which correctly IS the frontend.
      notification_url: env.PAYMOB_NOTIFICATION_URL || `${env.API_URL}/api/v1/payments/callback`,
      redirection_url: env.PAYMOB_REDIRECTION_URL || `${env.CLIENT_URL}/payments/status`,
    };

    try {
      const response = await fetch(`${this.baseUrl}/v1/intention/`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        logger.error(`Paymob intention creation failed (${response.status}): ${errText}`);
        throw new ApiError(502, `Payment provider initialization failed: ${errText}`);
      }

      const data = await response.json();
      const clientSecret = data.client_secret;
      const paymentUrl = `https://accept.paymob.com/unifiedcheckout/?publicKey=${this.publicKey}&clientSecret=${clientSecret}`;

      return {
        paymentUrl,
        clientSecret,
        providerIntentionId: data.id?.toString(),
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error(`Paymob initialize exception: ${error.message}`);
      throw new ApiError(502, `Failed to connect to Paymob: ${error.message}`);
    }
  }

  /**
   * HMAC-SHA512 Webhook Signature Verification
   */
  verifyHmac(dataObj, receivedHmac) {
    if (!receivedHmac || !this.hmacSecret) return false;

    // Standard Paymob 21 transaction fields in exact lexicographical order
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
      dataObj.order?.id || dataObj.order,
      dataObj.owner,
      dataObj.pending,
      dataObj.refunded_amount_cents,
      dataObj.source_data?.pan,
      dataObj.source_data?.sub_type,
      dataObj.source_data?.type,
      dataObj.success,
    ];

    const concatenated = fields
      .map((val) => (val === undefined || val === null ? '' : String(val)))
      .join('');

    const calculatedHmac = crypto
      .createHmac('sha512', this.hmacSecret)
      .update(concatenated)
      .digest('hex');

    return calculatedHmac.toLowerCase() === receivedHmac.toLowerCase();
  }

  async handleCallback(payload = {}, query = {}) {
    const dataObj = payload.obj || payload;
    const receivedHmac = query.hmac || payload.hmac;

    const isAuthentic = this.verifyHmac(dataObj, receivedHmac);
    if (!isAuthentic) {
      throw new ApiError(400, 'Invalid webhook HMAC signature');
    }

    const success = dataObj.success === true || dataObj.success === 'true';
    const transactionId = dataObj.id?.toString();
    const bookingId =
      dataObj.order?.merchant_order_id ||
      dataObj.special_reference ||
      dataObj.intention_id;

    return {
      success,
      transactionId,
      status: success ? 'paid' : 'failed',
      bookingId,
      raw: dataObj,
    };
  }

  /**
   * Exchanges the legacy PAYMOB_API_KEY for a short-lived auth_token. The classic
   * void_refund/refund endpoint authenticates via this token in the request body — it does NOT
   * accept the Intention API's secret key, which is what the previous implementation incorrectly
   * passed here.
   */
  async getAuthToken() {
    const response = await fetch(`${this.baseUrl}/api/auth/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: this.apiKey }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error(`Paymob auth-token exchange failed (${response.status}): ${errText}`);
      throw new ApiError(502, `Failed to authenticate with Paymob: ${errText}`);
    }

    const data = await response.json();
    return data.token;
  }

  /**
   * Refund API (classic/legacy endpoint — Paymob has not moved refunds onto the Intention API).
   */
  async refund(transactionId, amount) {
    const amountInCents = Math.round(amount * 100);

    try {
      const authToken = await this.getAuthToken();

      const response = await fetch(`${this.baseUrl}/api/acceptance/void_refund/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          auth_token: authToken,
          transaction_id: transactionId,
          amount_cents: amountInCents,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        logger.error(`Paymob refund failed (${response.status}): ${errText}`);
        throw new ApiError(502, `Paymob refund failed: ${errText}`);
      }

      const data = await response.json();
      return {
        status: 'refunded',
        transactionId,
        amount,
        refundId: data.id?.toString(),
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      logger.error(`Paymob refund exception: ${error.message}`);
      throw new ApiError(502, `Failed to process Paymob refund: ${error.message}`);
    }
  }

  async verify(transactionId) {
    return {
      status: 'paid',
      transactionId,
    };
  }
}
