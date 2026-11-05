import '../../src/common/globals.js';
import { jest, describe, it, expect, afterEach } from '@jest/globals';
import crypto from 'crypto';
import PaymobProvider from '../../src/modules/payments/providers/paymob.provider.js';

const SECRET = 'test_secret_key_12345';
const HMAC_FIELDS = (o) => [
  o.amount_cents, o.created_at, o.currency, o.error_occured, o.has_parent_transaction, o.id,
  o.integration_id, o.is_3d_secure, o.is_auth, o.is_capture, o.is_refunded, o.is_standalone_payment,
  o.is_voided, o.order.id, o.owner, o.pending, o.source_data.pan, o.source_data.sub_type,
  o.source_data.type, o.success,
];
const signed = (overrides = {}) => {
  const obj = {
    amount_cents: 50000,
    created_at: '2026-11-05T01:00:00.000Z',
    currency: 'EGP',
    error_occured: false,
    has_parent_transaction: false,
    id: 998877,
    integration_id: 1,
    is_3d_secure: true,
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_payment: true,
    is_voided: false,
    order: { id: 1, merchant_order_id: '60f719b8f1a2c81234567888' },
    owner: 1,
    pending: false,
    source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
    success: true,
    ...overrides,
  };
  const hmac = crypto.createHmac('sha512', SECRET).update(HMAC_FIELDS(obj).map(String).join('')).digest('hex');
  return { payload: { obj }, query: { hmac } };
};
const provider = () => Object.assign(new PaymobProvider(), { hmacSecret: SECRET, baseUrl: 'https://paymob.test' });
const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});
// First call is the auth-token exchange, second is the request under test.
const fetchSequence = (...responses) => {
  const fn = jest.spyOn(globalThis, 'fetch');
  responses.forEach((r) => (r instanceof Error ? fn.mockRejectedValueOnce(r) : fn.mockResolvedValueOnce(r)));
  return fn;
};

describe('Paymob provider: refunds', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('handleCallback', () => {
    it('marks the callback Paymob sends on the original transaction after a refund as a refund', async () => {
      const { payload, query } = signed({ is_refunded: true });
      expect((await provider().handleCallback(payload, query)).isRefund).toBe(true);
    });

    it('marks a refund child transaction and a void as refunds', async () => {
      const child = signed({ id: 112233, has_parent_transaction: true });
      const voided = signed({ is_voided: true });
      expect((await provider().handleCallback(child.payload, child.query)).isRefund).toBe(true);
      expect((await provider().handleCallback(voided.payload, voided.query)).isRefund).toBe(true);
    });

    it('does not mark an ordinary payment callback as a refund', async () => {
      const { payload, query } = signed();
      expect((await provider().handleCallback(payload, query)).isRefund).toBe(false);
    });
  });

  describe('refund', () => {
    it('flags a 4xx from the refund endpoint as a definite rejection', async () => {
      fetchSequence(response(201, { token: 't' }), response(400, { detail: 'amount exceeds refundable' }));
      await expect(provider().refund('tx1', 500)).rejects.toMatchObject({ definite: true });
    });

    it('leaves a 5xx ambiguous, since Paymob may still have refunded', async () => {
      fetchSequence(response(201, { token: 't' }), response(502, { detail: 'bad gateway' }));
      const err = await provider().refund('tx1', 500).catch((e) => e);
      expect(err.statusCode).toBe(502);
      expect(err.definite).toBeFalsy();
    });

    it('leaves a network error on the refund request ambiguous', async () => {
      fetchSequence(response(201, { token: 't' }), new TypeError('fetch failed'));
      const err = await provider().refund('tx1', 500).catch((e) => e);
      expect(err.definite).toBeFalsy();
    });

    it('flags a failed auth-token exchange as definite: the refund was never sent', async () => {
      fetchSequence(response(401, { detail: 'bad key' }));
      await expect(provider().refund('tx1', 500)).rejects.toMatchObject({ definite: true });
    });

    it('sends the refund with a timeout so a hung request becomes an error', async () => {
      const fn = fetchSequence(response(201, { token: 't' }), response(200, { id: 5 }));
      await provider().refund('tx1', 500);
      expect(fn.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('getRefundedAmount', () => {
    it("returns the transaction's refunded total in piastres", async () => {
      const fn = fetchSequence(response(201, { token: 't' }), response(200, { id: 998877, refunded_amount_cents: 20000 }));
      expect(await provider().getRefundedAmount('998877')).toBe(20000);
      expect(fn.mock.calls[1][0]).toBe('https://paymob.test/api/acceptance/transactions/998877');
      expect(fn.mock.calls[1][1].headers.Authorization).toBe('Bearer t');
    });

    it('throws when Paymob cannot answer, so the caller keeps the refund unresolved', async () => {
      fetchSequence(response(201, { token: 't' }), response(503, {}));
      await expect(provider().getRefundedAmount('998877')).rejects.toThrow(/503/);
    });
  });
});
