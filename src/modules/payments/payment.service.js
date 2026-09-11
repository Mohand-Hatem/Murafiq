import mongoose from 'mongoose';
import paymentRepository from './payment.repository.js';
import bookingRepository from '../bookings/booking.repository.js';
import userRepository from '../users/user.repository.js';
import { getProvider } from './providers/provider.factory.js';
import env from '../../config/env.config.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import { PAYMENT_STATUS } from '../../common/constants/statuses.constant.js';
import ApiError from '../../common/utils/ApiError.js';
import { ROLES } from '../../common/constants/roles.constant.js';
import couponService from '../coupons/coupon.service.js';
import ledgerService, { egpToPiastres } from '../ledger/ledger.service.js';
import logger from '../../config/logger.config.js';

export const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

// Re-exported so existing callers and the module's default export keep working unchanged.
// The rule itself now lives in providers/provider.factory.js -- see the comment there.
export { getProvider };

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

export const initializePayment = async (user, bookingId, { couponCode = null } = {}) => {
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

  // Apply a coupon, if one was supplied and has not already been applied to this
  // payment. The discount is recomputed here from the stored percentage and the
  // booking's own price — a client-supplied amount is never trusted (§15).
  // Redemption is a CAS inside couponService, so two concurrent checkouts cannot both
  // consume the same coupon.
  if (couponCode && !payment.couponCode) {
    const applyCoupon = async (session) => {
      const { discountAmount } = await couponService.redeemCoupon(
        clientIdStr,
        couponCode,
        booking._id,
        booking.price,
        session
      );

      // Floor at zero: a discount can never make the platform owe the client money here.
      const discountedAmount = round2(Math.max(0, booking.price - discountAmount));
      const platformFeePercentage = payment.platformFeePercentage || env.PLATFORM_FEE_PERCENTAGE || 15;

      // The platform absorbs the discount, not the stylist -- the stylist agreed a price
      // with the client and must be paid against it. Clamped to what was actually
      // collected (discountedAmount): a steep enough coupon can push the platform's normal
      // fee-percentage share to zero, but never negative -- a negative platformFeeAmount
      // previously failed the schema's `min: 0` validator AFTER the coupon had already been
      // atomically consumed above, permanently destroying it with no compensating rollback.
      const uncappedStylistShare = round2(booking.price - booking.price * (platformFeePercentage / 100));
      const stylistPayoutAmount = Math.min(uncappedStylistShare, discountedAmount);
      const platformFeeAmount = round2(Math.max(0, discountedAmount - stylistPayoutAmount));

      payment = await paymentRepository.updateById(
        payment._id,
        {
          couponCode: String(couponCode).toUpperCase(),
          discountAmount,
          grossAmount: booking.price,
          amount: discountedAmount,
          platformFeeAmount,
          stylistPayoutAmount,
        },
        session
      );

      // Paired entry: the discount never enters escrow (the client only pays the already-
      // discounted amount into it), so this records it as a value transfer from the
      // platform to the client -- a merchant-funded discount, not a movement of money the
      // system is already holding. Previously single-sided (DEBIT PLATFORM only), which
      // made every coupon-discounted booking permanently unbalanced in the nightly
      // reconciliation sweep.
      await ledgerService.postDoubleEntry(
        {
          idempotencyKey: `coupon:redeem:platform:${booking._id}:${String(couponCode).toUpperCase()}`,
          entryType: 'COUPON_DISCOUNT',
          accountType: 'PLATFORM',
          amountMinor: egpToPiastres(discountAmount),
          bookingId: booking._id,
          paymentId: payment._id,
          correlationId: `booking_${booking._id}`,
          notes: `Coupon ${String(couponCode).toUpperCase()} applied to booking #${booking._id}`,
        },
        {
          idempotencyKey: `coupon:redeem:client:${booking._id}:${String(couponCode).toUpperCase()}`,
          entryType: 'COUPON_DISCOUNT',
          accountType: 'CLIENT',
          amountMinor: egpToPiastres(discountAmount),
          bookingId: booking._id,
          paymentId: payment._id,
          accountId: clientIdStr,
          correlationId: `booking_${booking._id}`,
          notes: `Coupon ${String(couponCode).toUpperCase()} discount benefit`,
        },
        session
      );
    };

    // Coupon redemption (a CAS write), the Payment update, and the ledger pair must all
    // succeed or all roll back together -- previously three independent, un-sessioned
    // writes, so a failure after redemption (e.g. the fee-validation crash this comment
    // used to sit next to) burned the coupon with no discount ever applied.
    if (mongoose.connection?.readyState === 1) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await applyCoupon(session);
        });
      } finally {
        session.endSession();
      }
    } else {
      await applyCoupon(null);
    }
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

  if (result.bookingId && String(result.bookingId).startsWith('subord_')) {
    const { handleSubscriptionWebhook } = await import('../subscriptions/subscription.service.js');
    const subResult = await handleSubscriptionWebhook(payload, query);
    // Narrowed to an acknowledgement, matching /subscriptions/webhook. Returning the order
    // verbatim would leak rawCallbackData -- the provider payload, masked PAN included --
    // through this delegation path even after the dedicated endpoint was fixed.
    return {
      received: true,
      status: subResult.order?.status ?? 'unknown',
      alreadyProcessed: Boolean(subResult.alreadyProcessed),
    };
  }

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

  // Providers retry failure callbacks too. Without this, every redelivery of the same
  // failure re-emitted PAYMENT_FAILED — which now also writes an audit entry, so a
  // retrying provider would fill the audit log with duplicates of one real event.
  const isFailureCallback = !(result.success || result.status === 'paid');
  const sameTransaction =
    !result.transactionId || String(result.transactionId) === String(payment.providerTransactionId);
  if (payment.status === PAYMENT_STATUS.FAILED && isFailureCallback && sameTransaction) {
    return payment; // Idempotent return for a redelivered failure
  }

  if (result.success || result.status === 'paid') {
    // Verify the amount the provider actually captured against what this Payment
    // record expects, when the provider reports one. The HMAC makes the callback
    // unforgeable but says nothing about whether the CORRECT amount was captured -- a
    // partial capture, or an intention created before a coupon discounted the price,
    // would otherwise mark the booking fully paid for less than it collected. See
    // docs/AUDIT_2026_09_FULL_SYSTEM.md finding X19.
    if (result.amountCents !== undefined && result.amountCents !== null) {
      const expectedMinor = ledgerService.egpToPiastres(payment.amount);
      if (Number(result.amountCents) !== expectedMinor) {
        logger.error(
          `[Payment Webhook] Amount mismatch for payment ${payment._id}: expected ${expectedMinor} piastres, provider reported ${result.amountCents}.`
        );
        throw new ApiError(
          400,
          `Webhook amount mismatch: expected ${expectedMinor} piastres, received ${result.amountCents}.`
        );
      }
    }

    // CAS on the exact status just read, not a bare updateById: two concurrent
    // deliveries of the same success callback could otherwise both pass the PAID/FAILED
    // guards above (both reading e.g. 'pending') and both proceed to write and emit
    // PAYMENT_SUCCEEDED. A lost CAS means someone else already resolved this delivery;
    // re-read and return that result rather than redoing the work. See
    // docs/AUDIT_2026_09_FULL_SYSTEM.md finding X18.
    const updated = await paymentRepository.transitionStatus(payment._id, payment.status, {
      status: PAYMENT_STATUS.PAID,
      paidAt: new Date(),
      providerTransactionId: result.transactionId || payment.providerTransactionId,
    });
    if (!updated) {
      return paymentRepository.findById(payment._id);
    }

    const amountMinor = ledgerService.egpToPiastres(updated.amount);
    const paymentIdStr = updated._id.toString();
    const bookingIdStr = (updated.bookingId?._id || updated.bookingId || '').toString();
    const clientIdStr = (updated.clientId?._id || updated.clientId || '').toString();

    // Dual-write to ledger: Client DEBIT, Escrow CREDIT
    try {
      await ledgerService.postEntry({
        idempotencyKey: `payment:paid:client:${paymentIdStr}`,
        entryType: 'PAYMENT',
        accountType: 'CLIENT',
        direction: 'DEBIT',
        amountMinor,
        bookingId: bookingIdStr || null,
        paymentId: paymentIdStr,
        accountId: clientIdStr || null,
        correlationId: `payment_${paymentIdStr}`,
        notes: 'Client payment received into escrow hold',
      });

      await ledgerService.postEntry({
        idempotencyKey: `payment:paid:escrow:${paymentIdStr}`,
        entryType: 'ESCROW_HOLD',
        accountType: 'ESCROW',
        direction: 'CREDIT',
        amountMinor,
        bookingId: bookingIdStr || null,
        paymentId: paymentIdStr,
        correlationId: `payment_${paymentIdStr}`,
        notes: 'Escrow hold for booking',
      });
    } catch (ledgerErr) {
      // Ledger dual-write logging without failing the webhook response
      console.error(`[Ledger Dual-Write Warning] ${ledgerErr.message}`);
    }

    eventBus.emit(EVENTS.PAYMENT_SUCCEEDED, {
      paymentId: updated._id.toString(),
      bookingId: bookingIdStr,
      clientId: clientIdStr,
      amount: updated.amount,
    });

    return updated;
  } else {
    const updated = await paymentRepository.transitionStatus(payment._id, payment.status, {
      status: PAYMENT_STATUS.FAILED,
      providerTransactionId: result.transactionId || payment.providerTransactionId,
    });
    if (!updated) {
      return paymentRepository.findById(payment._id);
    }

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

export const processRefund = async ({
  bookingId,
  refundPercentage = 100,
  reason = '',
  // Caller-supplied EGP amount the stylist should keep from whatever this refund does
  // NOT return to the client (see NO_SHOW_POLICY.CLIENT.STYLIST_PERCENTAGE and
  // MONEY_AND_LEDGER.md Section 4.2's dispute-split example). Left unspecified (0) for
  // pure pre-session cancellations, where the documented policy awards the stylist
  // nothing since the session never took place.
  stylistPayoutOverrideAmount = 0,
} = {}) => {
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

  const isPartial = refundPercentage < 100;
  const status = isPartial ? PAYMENT_STATUS.PARTIALLY_REFUNDED : PAYMENT_STATUS.REFUNDED;

  // Whatever isn't refunded to the client (`retainedAmount`) splits between the stylist
  // (per the caller's policy override) and the platform (whatever's left). Clamping the
  // override to retainedAmount means a caller bug can never make the platform "owe" more
  // than it actually kept.
  const retainedAmount = round2(Math.max(0, payment.amount - refundAmount));
  const stylistPayoutAmount = Math.min(round2(Math.max(0, stylistPayoutOverrideAmount)), retainedAmount);
  const platformFeeAmount = round2(Math.max(0, retainedAmount - stylistPayoutAmount));

  // CAS-claim the payment into REFUNDING *before* calling the provider, not after.
  // Two things this closes (docs/AUDIT_2026_09_FULL_SYSTEM.md findings X17/X18):
  // (1) durability -- a crash between the provider call succeeding and the terminal
  //     write used to leave NOTHING persisted: the client was refunded by the provider
  //     but our own record still said 'paid', so the booking still looked payout-eligible
  //     and the stylist could be paid for a refunded session. The claim below is written
  //     and committed BEFORE the provider is touched, so that failure mode now leaves a
  //     durable 'refunding' record instead of silence.
  // (2) concurrency -- the CAS is keyed on {_id, status: 'paid'}, so a second concurrent
  //     processRefund() call for the same payment cannot also pass and call the provider
  //     a second time; it gets null and must not proceed.
  const claimed = await paymentRepository.transitionStatus(payment._id, PAYMENT_STATUS.PAID, {
    status: PAYMENT_STATUS.REFUNDING,
    refundAmount,
    refundReason: reason,
    platformFeeAmount,
    stylistPayoutAmount,
  });
  if (!claimed) {
    throw new ApiError(
      409,
      'This payment is already being refunded or is no longer in a refundable state.'
    );
  }

  const provider = getProvider();
  let updated;
  try {
    if (payment.providerTransactionId && provider.refund) {
      await provider.refund(payment.providerTransactionId, refundAmount);
    }

    updated = await paymentRepository.transitionStatus(payment._id, PAYMENT_STATUS.REFUNDING, {
      status,
      refundedAt: new Date(),
    });
  } catch (providerErr) {
    // The provider call itself failed (network error, provider-side rejection, etc.) --
    // revert to 'paid' so a retry (the caller re-invoking processRefund, or an admin
    // retry action) can actually attempt it again, rather than leaving the payment
    // stuck in the transient 'refunding' state forever.
    await paymentRepository.transitionStatus(payment._id, PAYMENT_STATUS.REFUNDING, {
      status: PAYMENT_STATUS.PAID,
      refundError: providerErr.message,
      refundFailedAt: new Date(),
    });
    logger.error(`Refund provider call failed for payment ${payment._id}: ${providerErr.message}`);
    throw providerErr;
  }

  const bookingIdStr = (payment.bookingId?._id || payment.bookingId || bookingId).toString();
  const clientIdStr = (payment.clientId?._id || payment.clientId || '').toString();
  const paymentIdStr = (updated._id || updated.id || payment._id).toString();

  // Dual-write to ledger: Escrow DEBIT (release), Client CREDIT (refund)
  try {
    const refundMinor = ledgerService.egpToPiastres(refundAmount);
    const sanitizedReason = (reason || 'standard').replace(/\s+/g, '_');

    await ledgerService.postEntry({
      idempotencyKey: `refund:escrow:${paymentIdStr}:${sanitizedReason}`,
      entryType: 'ESCROW_RELEASE',
      accountType: 'ESCROW',
      direction: 'DEBIT',
      amountMinor: refundMinor,
      bookingId: bookingIdStr || null,
      paymentId: paymentIdStr,
      correlationId: `refund_${paymentIdStr}`,
      notes: reason || 'Booking refund release from escrow',
    });

    await ledgerService.postEntry({
      idempotencyKey: `refund:client:${paymentIdStr}:${sanitizedReason}`,
      entryType: 'REFUND',
      accountType: 'CLIENT',
      direction: 'CREDIT',
      amountMinor: refundMinor,
      bookingId: bookingIdStr || null,
      paymentId: paymentIdStr,
      accountId: clientIdStr || null,
      correlationId: `refund_${paymentIdStr}`,
      notes: reason || 'Client refund credit',
    });

    // Recognise whatever the platform actually keeps as revenue THE MOMENT it is
    // retained, not only if/when the booking later happens to reach a payout batch.
    // Cancelled bookings never do -- PAYOUT_ELIGIBILITY only matches 'completed' and
    // 'no-show-client' -- so before this, a cancellation's retained 3%/20% platform fee
    // sat in ESCROW forever with no ledger entry ever recognising it as revenue. Debits
    // still equalled credits (the money was never lost), so the nightly reconciliation
    // never alerted, but PLATFORM revenue was permanently understated. This is a general
    // fix for every processRefund() caller (cancellation, dispute, no-show), not only
    // cancellation: `platformFeeAmount` here is by construction the platform's retained
    // share after any stylist override, in every case. See
    // docs/AUDIT_2026_09_FULL_SYSTEM.md finding X20.
    if (platformFeeAmount > 0) {
      const platformFeeMinor = ledgerService.egpToPiastres(platformFeeAmount);
      await ledgerService.postEntry({
        idempotencyKey: `refund:platform_fee:${paymentIdStr}:${sanitizedReason}`,
        entryType: 'PLATFORM_FEE',
        accountType: 'ESCROW',
        direction: 'DEBIT',
        amountMinor: platformFeeMinor,
        bookingId: bookingIdStr || null,
        paymentId: paymentIdStr,
        correlationId: `refund_${paymentIdStr}`,
        notes: reason || 'Platform fee retained on refund/cancellation',
      });

      await ledgerService.postEntry({
        idempotencyKey: `refund:platform_fee_credit:${paymentIdStr}:${sanitizedReason}`,
        entryType: 'PLATFORM_FEE',
        accountType: 'PLATFORM',
        direction: 'CREDIT',
        amountMinor: platformFeeMinor,
        bookingId: bookingIdStr || null,
        paymentId: paymentIdStr,
        correlationId: `refund_${paymentIdStr}`,
        notes: reason || 'Platform fee revenue recognised on refund/cancellation',
      });
    }
  } catch (ledgerErr) {
    console.error(`[Ledger Dual-Write Warning] ${ledgerErr.message}`);
  }

  eventBus.emit(EVENTS.PAYMENT_REFUNDED, {
    paymentId: paymentIdStr,
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
