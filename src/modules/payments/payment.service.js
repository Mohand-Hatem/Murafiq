import paymentRepository from './payment.repository.js';
import bookingRepository from '../bookings/booking.repository.js';
import userRepository from '../users/user.repository.js';
import MockProvider from './providers/mock.provider.js';
import PaymobProvider from './providers/paymob.provider.js';
import env from '../../config/env.config.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import { PAYMENT_STATUS } from '../../common/constants/statuses.constant.js';
import ApiError from '../../common/utils/ApiError.js';
import { ROLES } from '../../common/constants/roles.constant.js';

export const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

// The mock provider exists solely to keep automated tests deterministic and offline — it is
// selected by NODE_ENV, never by PAYMENT_PROVIDER. Every non-test environment (dev, staging,
// production) always hits the real Paymob sandbox/live API, so the integration is actually
// exercised long before go-live rather than being discovered broken in production.
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

export const createPendingPayment = async (
  { bookingId, clientId, amount, currency = 'EGP' },
  session = null
) => {
  const platformFeePercentage = env.PLATFORM_FEE_PERCENTAGE || 15;
  const platformFeeAmount = round2(amount * (platformFeePercentage / 100));
  const stylistPayoutAmount = round2(amount - platformFeeAmount);

  return paymentRepository.create(
    {
      bookingId,
      clientId,
      currency,
      amount,
      platformFeePercentage,
      platformFeeAmount,
      stylistPayoutAmount,
      status: PAYMENT_STATUS.PENDING,
      provider: env.PAYMENT_PROVIDER || 'mock',
    },
    session
  );
};

export const initializePayment = async (user, bookingId) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  const userIdStr = (user._id || user.id).toString();
  const clientIdStr = (booking.clientId._id || booking.clientId).toString();

  if (userIdStr !== clientIdStr && user.role !== ROLES.ADMIN) {
    throw new ApiError(403, 'Forbidden: You do not own this booking');
  }

  const customerUser = await userRepository.findById(clientIdStr);
  if (!customerUser) {
    throw new ApiError(404, 'Customer user record not found');
  }

  if (env.PAYMENT_PROVIDER === 'paymob' && !customerUser.phone) {
    throw new ApiError(
      400,
      'A valid phone number on your profile is required before initiating online payment'
    );
  }

  let payment = await paymentRepository.findByBookingId(bookingId);
  if (!payment) {
    payment = await createPendingPayment({
      bookingId: booking._id,
      clientId: booking.clientId._id || booking.clientId,
      amount: booking.price,
      currency: 'EGP',
    });
  }

  if (payment.status === PAYMENT_STATUS.PAID) {
    throw new ApiError(400, 'This booking has already been paid for');
  }

  const provider = getProvider();
  const initResult = await provider.initialize({
    amount: payment.amount,
    bookingId: booking._id.toString(),
    customer: {
      name: customerUser.name || user.name || 'Valued Customer',
      email: customerUser.email || user.email || 'customer@murafiq.dev',
      phone: customerUser.phone || user.phone || '+201000000000',
    },
    currency: payment.currency,
  });

  const updatedPayment = await paymentRepository.updateById(payment._id, {
    providerIntentionId: initResult.providerIntentionId || undefined,
    providerTransactionId: initResult.providerTransactionId || undefined,
    provider: env.PAYMENT_PROVIDER || 'mock',
  });

  return {
    paymentUrl: initResult.paymentUrl,
    clientSecret: initResult.clientSecret,
    payment: updatedPayment,
  };
};

export const handleWebhook = async (payload, query = {}) => {
  const provider = getProvider();
  const result = await provider.handleCallback(payload, query);

  let payment = null;
  if (result.bookingId) {
    payment = await paymentRepository.findByBookingId(result.bookingId);
  }
  if (!payment && result.transactionId) {
    payment = await paymentRepository.findByTransactionId(result.transactionId);
  }

  if (!payment) {
    throw new ApiError(404, 'Payment record not found for webhook transaction');
  }

  if (payment.status === PAYMENT_STATUS.PAID) {
    return payment; // Idempotent return
  }

  if (result.success || result.status === 'paid') {
    const updated = await paymentRepository.updateById(payment._id, {
      status: PAYMENT_STATUS.PAID,
      paidAt: new Date(),
      providerTransactionId: result.transactionId || payment.providerTransactionId,
    });

    eventBus.emit(EVENTS.PAYMENT_SUCCEEDED, {
      paymentId: updated._id.toString(),
      bookingId: updated.bookingId._id ? updated.bookingId._id.toString() : updated.bookingId.toString(),
      clientId: updated.clientId._id ? updated.clientId._id.toString() : updated.clientId.toString(),
      amount: updated.amount,
    });

    return updated;
  } else {
    const updated = await paymentRepository.updateById(payment._id, {
      status: PAYMENT_STATUS.FAILED,
      providerTransactionId: result.transactionId || payment.providerTransactionId,
    });

    eventBus.emit(EVENTS.PAYMENT_FAILED, {
      paymentId: updated._id.toString(),
      bookingId: updated.bookingId._id ? updated.bookingId._id.toString() : updated.bookingId.toString(),
      clientId: updated.clientId._id ? updated.clientId._id.toString() : updated.clientId.toString(),
      reason: result.raw?.error_occured || 'Transaction declined or failed',
    });

    return updated;
  }
};

export const getPaymentStatus = async (user, bookingId) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  const userIdStr = (user._id || user.id).toString();
  const clientIdStr = (booking.clientId._id || booking.clientId).toString();
  const stylistIdStr = (booking.stylistId._id || booking.stylistId).toString();

  if (userIdStr !== clientIdStr && userIdStr !== stylistIdStr && user.role !== ROLES.ADMIN) {
    throw new ApiError(403, 'Forbidden');
  }

  const payment = await paymentRepository.findByBookingId(bookingId);
  if (!payment) {
    throw new ApiError(404, 'Payment not found for this booking');
  }

  return payment;
};

export const getClientHistory = async (user, queryString = {}) => {
  const userId = user._id || user.id;
  return paymentRepository.findClientHistory(userId, queryString);
};

export const processRefund = async ({ bookingId, refundPercentage = 100, reason = '' }) => {
  const payment = await paymentRepository.findByBookingId(bookingId);
  if (!payment) {
    throw new ApiError(404, 'Payment record not found for this booking');
  }

  if (payment.status !== PAYMENT_STATUS.PAID) {
    throw new ApiError(400, `Cannot refund payment in '${payment.status}' status`);
  }

  // A refund zeroes stylistPayoutAmount on this Payment record, which is correct for any FUTURE
  // payout aggregation. But if this booking was already batched into a Payout ('processing' or
  // 'paid'), the stylist's share has already left the ledger (or is about to) based on the
  // pre-refund amount — a plain status flip here can't claw that back. Block it and force manual
  // reconciliation of the existing payout batch before the refund proceeds.
  const booking = await bookingRepository.findById(bookingId);
  if (booking && booking.payoutStatus && booking.payoutStatus !== 'unpaid') {
    throw new ApiError(
      409,
      `Cannot refund: this booking's payout is already '${booking.payoutStatus}'. ` +
        'Reconcile the associated payout batch manually before issuing a refund.'
    );
  }

  const refundAmount = round2((payment.amount * refundPercentage) / 100);

  const provider = getProvider();
  if (payment.providerTransactionId && provider.refund) {
    await provider.refund(payment.providerTransactionId, refundAmount);
  }

  const isPartial = refundPercentage < 100;
  const retainedFee = isPartial ? round2(payment.amount - refundAmount) : 0;
  const status = isPartial ? PAYMENT_STATUS.PARTIALLY_REFUNDED : PAYMENT_STATUS.REFUNDED;

  const updateFields = {
    status,
    refundAmount,
    refundReason: reason,
    refundedAt: new Date(),
    platformFeeAmount: isPartial ? retainedFee : 0,
    stylistPayoutAmount: 0,
  };

  const updated = await paymentRepository.updateById(payment._id, updateFields);

  const bookingIdStr = (payment.bookingId?._id || payment.bookingId || bookingId).toString();
  const clientIdStr = (payment.clientId?._id || payment.clientId || '').toString();

  eventBus.emit(EVENTS.PAYMENT_REFUNDED, {
    paymentId: (updated._id || updated.id || payment._id).toString(),
    bookingId: bookingIdStr,
    clientId: clientIdStr,
    refundAmount,
    status,
    reason,
  });

  return updated;
};

export default {
  createPendingPayment,
  initializePayment,
  handleWebhook,
  getPaymentStatus,
  getClientHistory,
  processRefund,
  round2,
  getProvider,
};
