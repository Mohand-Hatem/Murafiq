import paymentRepository from './payment.repository.js';
import bookingRepository from '../bookings/booking.repository.js';
import MockProvider from './providers/mock.provider.js';
import PaymobProvider from './providers/paymob.provider.js';
import env from '../../config/env.config.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import { PAYMENT_STATUS, CANCELLATION_POLICY } from '../../common/constants/statuses.constant.js';
import ApiError from '../../common/utils/ApiError.js';
import { ROLES } from '../../common/constants/roles.constant.js';

export const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

export const getProvider = () => {
  return env.PAYMENT_PROVIDER === 'paymob' ? new PaymobProvider() : new MockProvider();
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
      name: user.name,
      email: user.email,
      phone: user.phone,
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
    throw new ApiError(404, 'Payment not found for this booking');
  }

  if (payment.status !== PAYMENT_STATUS.PAID) {
    throw new ApiError(400, `Cannot refund a payment with status '${payment.status}'`);
  }

  const refundAmount = round2(payment.amount * (refundPercentage / 100));

  if (payment.providerTransactionId) {
    const provider = getProvider();
    await provider.refund(payment.providerTransactionId, refundAmount);
  }

  const updated = await paymentRepository.updateById(payment._id, {
    status: PAYMENT_STATUS.REFUNDED,
    refundAmount,
    refundReason: reason,
  });

  const bookingIdStr = updated.bookingId
    ? (updated.bookingId._id || updated.bookingId).toString()
    : (payment.bookingId?._id || payment.bookingId || bookingId).toString();

  const clientIdStr = updated.clientId
    ? (updated.clientId._id || updated.clientId).toString()
    : (payment.clientId?._id || payment.clientId || '').toString();

  eventBus.emit(EVENTS.PAYMENT_REFUNDED, {
    paymentId: (updated._id || updated.id || payment._id).toString(),
    bookingId: bookingIdStr,
    clientId: clientIdStr,
    refundAmount,
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
