import '../../src/common/globals.js';
import env from '../../src/config/env.config.js';
import { initializePayment } from '../../src/modules/payments/payment.service.js';
import { checkoutSubscription } from '../../src/modules/subscriptions/subscription.service.js';

// DEMO-first launch: V1 stays mounted for the admin panel, but must not open any Paymob checkout.
describe('V1_PAYMENTS_ENABLED lock', () => {
  const original = env.V1_PAYMENTS_ENABLED;
  afterEach(() => {
    env.V1_PAYMENTS_ENABLED = original;
  });

  it('is on by default so existing environments keep working', () => {
    expect(original).toBe(true);
  });

  it('refuses booking payment initialization with 503 before touching any data', async () => {
    env.V1_PAYMENTS_ENABLED = false;
    await expect(
      initializePayment({ _id: '64b000000000000000000001' }, '64b000000000000000000002')
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it('refuses subscription checkout with 503 before touching any data', async () => {
    env.V1_PAYMENTS_ENABLED = false;
    await expect(
      checkoutSubscription('64b000000000000000000001', 'client', { planCode: 'client_pro' })
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});
