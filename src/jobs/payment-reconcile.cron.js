import cron from 'node-cron';
import paymentRepository from '../modules/payments/payment.repository.js';
import paymentService from '../modules/payments/payment.service.js';
import { BUSINESS_TIMEZONE } from '../common/constants/defaults.constant.js';
import { PAYMENT_RECONCILE_POLICY } from '../common/constants/statuses.constant.js';
import env from '../config/env.config.js';
import { logger } from '../config/logger.config.js';

let registered = false;

/**
 * Recovers payments whose Paymob webhook never arrived. Paymob documents transaction inquiry as
 * "for manual checks", so this is deliberately small: a payment is only asked about 2-60 minutes
 * after its link was issued, at most once per 5 minutes, and at most BATCH_SIZE per sweep.
 * @returns {Promise<{ checked: number, recovered: number }>}
 */
export const sweepStalePayments = async () => {
  const { MIN_AGE_MINUTES, MAX_AGE_MINUTES, RETRY_MINUTES, BATCH_SIZE } = PAYMENT_RECONCILE_POLICY;
  let checked = 0;
  let recovered = 0;

  for (let i = 0; i < BATCH_SIZE; i += 1) {
    const payment = await paymentRepository.claimStalePending({
      now: Date.now(),
      minAgeMs: MIN_AGE_MINUTES * 60 * 1000,
      maxAgeMs: MAX_AGE_MINUTES * 60 * 1000,
      retryMs: RETRY_MINUTES * 60 * 1000,
    });
    if (!payment) break;

    checked += 1;
    try {
      const { settled } = await paymentService.reconcilePayment(payment);
      if (settled) {
        recovered += 1;
        logger.warn(`Payment ${payment._id} was paid but its webhook never arrived; recovered by reconciliation.`);
      }
    } catch (err) {
      logger.error(`Payment reconciliation failed for ${payment._id}: ${err.message}`);
    }
  }

  return { checked, recovered };
};

export const startPaymentReconcileCron = () => {
  if (registered) return;
  if (env.NODE_ENV === 'test') return;
  registered = true;

  cron.schedule(
    PAYMENT_RECONCILE_POLICY.SCHEDULE,
    async () => {
      try {
        await sweepStalePayments();
      } catch (err) {
        logger.error(`Payment reconciliation sweep failed: ${err.message}`);
      }
    },
    { timezone: BUSINESS_TIMEZONE }
  );

  logger.info(`Payment reconciliation cron scheduled (${PAYMENT_RECONCILE_POLICY.SCHEDULE}).`);
};

export default { sweepStalePayments, startPaymentReconcileCron };
