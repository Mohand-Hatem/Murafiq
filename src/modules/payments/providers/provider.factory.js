import env from '../../../config/env.config.js';
import MockProvider from './mock.provider.js';
import PaymobProvider from './paymob.provider.js';
import ApiError from '../../../common/utils/ApiError.js';

/**
 * Resolves the active payment provider.
 *
 * Lives here rather than inside payment.service.js because it is infrastructure, not booking
 * logic: the subscription flow needs exactly the same rule, and importing it from a sibling
 * SERVICE both created a service-to-service dependency for no reason and broke any test that
 * mocks payment.service wholesale.
 *
 * The mock exists solely to keep automated tests deterministic and offline -- it is selected by
 * NODE_ENV, never by PAYMENT_PROVIDER. Every non-test environment (dev, staging, production)
 * always hits the real Paymob sandbox/live API, so the integration is exercised long before
 * go-live rather than being discovered broken in production. PAYMENT_PROVIDER defaults to
 * 'mock', so without the throw a deploy that simply forgot to set it would issue fake checkout
 * URLs and silently collect nothing.
 *
 * @returns {MockProvider|PaymobProvider}
 */
export const getProvider = () => {
  if (env.NODE_ENV === 'test') {
    return new MockProvider();
  }
  if (env.PAYMENT_PROVIDER === 'mock') {
    throw new ApiError(
      500,
      'PAYMENT_PROVIDER=mock is only permitted when NODE_ENV=test. Set PAYMENT_PROVIDER=paymob for local/dev/staging/production.'
    );
  }
  return new PaymobProvider();
};

export default { getProvider };
