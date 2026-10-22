import paymentRepository from './payment.repository.js';
import bookingRepository from '../bookings/booking.repository.js';
import userRepository from '../users/user.repository.js';
import { getProvider } from './providers/provider.factory.js';
import env from '../../config/env.config.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import {
  PAYMENT_STATUS,
  PAYMENT_LINK_POLICY,
  BOOKING_STATUS,
} from '../../common/constants/statuses.constant.js';
import ApiError from '../../common/utils/ApiError.js';
import { PLATFORM_FEE_DEFAULT_PERCENTAGE } from '../../common/constants/defaults.constant.js';

import { ROLES } from '../../common/constants/roles.constant.js';
import couponService from '../coupons/coupon.service.js';
import ledgerService, { egpToPiastres } from '../ledger/ledger.service.js';
import { withTransaction } from '../../common/transaction.util.js';
import logger from '../../config/logger.config.js';

export const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

// Re-exported so existing callers and the module's default export keep working unchanged.
// The rule itself now lives in providers/provider.factory.js -- see the comment there.
export { getProvider };

export const createPendingPayment = async (
  { bookingId, clientId, amount, currency = 'EGP' },
  session = null
) => {
  const platformFeePercentage = env.PLATFORM_FEE_PERCENTAGE || PLATFORM_FEE_DEFAULT_PERCENTAGE;
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

  if (![BOOKING_STATUS.PENDING_PAYMENT, BOOKING_STATUS.CONFIRMED].includes(booking.status)) {
    throw new ApiError(400, `This booking is no longer awaiting payment (status '${booking.status}')`);
  }
  if (
    booking.status === BOOKING_STATUS.PENDING_PAYMENT &&
    booking.paymentExpiresAt &&
    booking.paymentExpiresAt.getTime() < Date.now()
  ) {
    throw new ApiError(400, 'The payment window for this booking has expired');
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
      const platformFeePercentage =
        payment.platformFeePercentage ||
        env.PLATFORM_FEE_PERCENTAGE ||
        PLATFORM_FEE_DEFAULT_PERCENTAGE;

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
    await withTransaction(async (session) => {
      await applyCoupon(session);
    });
  }

  // A client who closed the payment page gets the same live link back. Paymob rejects a second
  // intention that reuses special_reference, so re-calling it here would just fail. A link issued
  // for a different amount (a coupon was applied since) is never reused.
  const linkAgeMs = Date.now() - new Date(payment.paymentUrlCreatedAt || 0).getTime();
  if (
    payment.providerPaymentUrl &&
    payment.paymentUrlAmount === payment.amount &&
    linkAgeMs < PAYMENT_LINK_POLICY.REUSE_MINUTES * 60 * 1000
  ) {
    return {
      paymentUrl: payment.providerPaymentUrl,
      clientSecret: payment.providerClientSecret,
      payment,
    };
  }

  // Every intention after the first needs its own unique reference; the webhook maps
  // "<bookingId>-<attempt>" back to the booking (see PaymobProvider.handleCallback).
  const attempt = payment.providerIntentionId ? (payment.paymentAttempt || 0) + 1 : 0;

  const provider = getProvider();
  const initResult = await provider.initialize({
    amount: payment.amount,
    bookingId: booking._id.toString(),
    reference: attempt ? `${booking._id}-${attempt}` : undefined,
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
    providerPaymentUrl: initResult.paymentUrl,
    providerClientSecret: initResult.clientSecret,
    paymentUrlCreatedAt: new Date(),
    paymentUrlAmount: payment.amount,
    paymentAttempt: attempt,
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

  return settlePayment(payment, result);
};

/**
 * Refunds an extra capture on an already-paid payment. Deliberately NOT processRefund: that
 * flips the real payment to refunded. The record is written only after the provider confirms,
 * so a failed refund is retried on the provider's next delivery.
 * shortcut: two simultaneous deliveries can both call the provider; the second is rejected by
 * Paymob (already refunded) and retried harmlessly - add a claim step if that ever shows up.
 */
const refundDuplicateCapture = async (payment, result) => {
  const transactionId = String(result.transactionId);
  if (payment.duplicateRefunds?.some((d) => d.transactionId === transactionId)) {
    return payment;
  }

  const amount =
    result.amountCents !== undefined && result.amountCents !== null
      ? round2(Number(result.amountCents) / 100)
      : payment.amount;
  logger.error(
    `[Payment Webhook] DUPLICATE CAPTURE on paid payment ${payment._id}: transaction ${transactionId} (paid with ${payment.providerTransactionId}). Refunding ${amount}.`
  );

  let refund;
  try {
    refund = await getProvider().refund(transactionId, amount, {
      idempotencyKey: `duplicate_capture:${transactionId}`,
    });
  } catch (err) {
    logger.error(`[Payment Webhook] Refund of duplicate capture ${transactionId} failed: ${err.message}`);
    throw new ApiError(502, `Could not refund duplicate payment ${transactionId}: ${err.message}`);
  }

  return paymentRepository.recordDuplicateRefund(payment._id, {
    transactionId,
    amount,
    refundId: refund?.refundId,
    refundedAt: new Date(),
  });
};

/**
 * Applies a provider's verdict on a payment. Shared by the webhook and by reconciliation so a
 * recovered payment gets exactly the same transaction, ledger pair and events.
 */
export const settlePayment = async (payment, result) => {
  if (payment.status === PAYMENT_STATUS.PAID) {
    // A second, different successful transaction means the client paid twice (old link plus a
    // newer attempt): give that money back on its own transaction id.
    if (
      result.success &&
      result.transactionId &&
      String(result.transactionId) !== String(payment.providerTransactionId)
    ) {
      return refundDuplicateCapture(payment, result);
    }
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
    // docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X19.
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
    // docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X18.
    let updated;
    let paidAfterRelease = false;
    await withTransaction(async (session) => {
      updated = await paymentRepository.transitionStatus(
        payment._id,
        payment.status,
        {
          status: PAYMENT_STATUS.PAID,
          paidAt: new Date(),
          providerTransactionId: result.transactionId || payment.providerTransactionId,
        },
        session
      );
      if (!updated) {
        return;
      }

      const amountMinor = ledgerService.egpToPiastres(updated.amount);
      const paymentIdStr = updated._id.toString();
      const bookingIdStr = (updated.bookingId?._id || updated.bookingId || '').toString();
      const clientIdStr = (updated.clientId?._id || updated.clientId || '').toString();

      // Dual-write to ledger: Client DEBIT, Escrow CREDIT (Task S4.1, B6)
      await ledgerService.postDoubleEntry(
        {
          idempotencyKey: `payment:paid:client:${paymentIdStr}`,
          entryType: 'PAYMENT',
          accountType: 'CLIENT',
          amountMinor,
          bookingId: bookingIdStr || null,
          paymentId: paymentIdStr,
          accountId: clientIdStr || null,
          correlationId: `payment_${paymentIdStr}`,
          notes: 'Client payment received into escrow hold',
        },
        {
          idempotencyKey: `payment:paid:escrow:${paymentIdStr}`,
          entryType: 'ESCROW_HOLD',
          accountType: 'ESCROW',
          amountMinor,
          bookingId: bookingIdStr || null,
          paymentId: paymentIdStr,
          correlationId: `payment_${paymentIdStr}`,
          notes: 'Escrow hold for booking',
        },
        session
      );

      // Same transaction: the booking leaves pending_payment exactly when the money is held.
      // No match means it was never pending (demo/legacy -> already confirmed) or it was
      // released before this payment landed.
      const confirmed = await bookingRepository.transitionStatus(
        bookingIdStr,
        [BOOKING_STATUS.PENDING_PAYMENT],
        { status: BOOKING_STATUS.CONFIRMED, paymentExpiresAt: null },
        session
      );
      if (!confirmed) {
        const booking = await bookingRepository.findById(bookingIdStr);
        paidAfterRelease = booking?.status === BOOKING_STATUS.CANCELLED;
      }
    });

    if (!updated) {
      return paymentRepository.findById(payment._id);
    }

    // The client paid after the slot was released. Never revive the booking: give the money back.
    if (paidAfterRelease) {
      logger.error(
        `[Payment Webhook] Payment ${payment._id} captured after booking ${payment.bookingId} was released; refunding in full.`
      );
      return processRefund({
        bookingId: (updated.bookingId?._id || updated.bookingId).toString(),
        refundPercentage: 100,
        reason: 'paid_after_booking_released',
        idempotencyKey: `late_payment_refund:${updated._id}`,
      });
    }

    const bookingIdStr = (updated.bookingId?._id || updated.bookingId || '').toString();
    const clientIdStr = (updated.clientId?._id || updated.clientId || '').toString();

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

/**
 * Recovers a lost webhook: asks Paymob about every reference this payment ever used (newest
 * first) and settles it if any was paid. Only a PAID verdict is acted on -- an unpaid attempt
 * proves nothing, since the client may have paid a different one. Callers must throttle
 * (see paymentRepository.claimStalePending).
 */
export const reconcilePayment = async (payment) => {
  const bookingId = (payment.bookingId?._id || payment.bookingId).toString();
  const provider = getProvider();

  for (let attempt = payment.paymentAttempt || 0; attempt >= 0; attempt -= 1) {
    const reference = attempt ? `${bookingId}-${attempt}` : bookingId;
    const found = await provider.inquire(reference);
    if (found?.success && !found.pending) {
      const settled = await settlePayment(payment, { ...found, status: 'paid' });
      return { settled: settled.status === PAYMENT_STATUS.PAID && payment.status !== PAYMENT_STATUS.PAID };
    }
  }
  return { settled: false };
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
  idempotencyKey = null,
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
  // Note (Task S3.3): !== 'unpaid' refuses 'processing', 'paid', and 'not_owed'.
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
  // Two things this closes (docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md findings X17/X18):
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
  try {
    if (payment.providerTransactionId && provider.refund) {
      await provider.refund(payment.providerTransactionId, refundAmount, { idempotencyKey });
    }
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

  let updated;
  await withTransaction(async (session) => {
    updated = await paymentRepository.transitionStatus(
      payment._id,
      PAYMENT_STATUS.REFUNDING,
      {
        status,
        refundedAt: new Date(),
      },
      session
    );

    const bookingIdStr = (payment.bookingId?._id || payment.bookingId || bookingId).toString();
    const clientIdStr = (payment.clientId?._id || payment.clientId || '').toString();
    const paymentIdStr = (updated?._id || updated?.id || payment._id).toString();

    // Dual-write to ledger: Escrow DEBIT (release), Client CREDIT (refund) (Task S4.1, B6)
    const refundMinor = ledgerService.egpToPiastres(refundAmount);
    const sanitizedReason = (reason || 'standard').replace(/\s+/g, '_');

    await ledgerService.postDoubleEntry(
      {
        idempotencyKey: `refund:escrow:${paymentIdStr}:${sanitizedReason}`,
        entryType: 'ESCROW_RELEASE',
        accountType: 'ESCROW',
        amountMinor: refundMinor,
        bookingId: bookingIdStr || null,
        paymentId: paymentIdStr,
        correlationId: `refund_${paymentIdStr}`,
        notes: reason || 'Booking refund release from escrow',
      },
      {
        idempotencyKey: `refund:client:${paymentIdStr}:${sanitizedReason}`,
        entryType: 'REFUND',
        accountType: 'CLIENT',
        amountMinor: refundMinor,
        bookingId: bookingIdStr || null,
        paymentId: paymentIdStr,
        accountId: clientIdStr || null,
        correlationId: `refund_${paymentIdStr}`,
        notes: reason || 'Client refund credit',
      },
      session
    );

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
    // docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X20.
    if (platformFeeAmount > 0) {
      const platformFeeMinor = ledgerService.egpToPiastres(platformFeeAmount);
      await ledgerService.postDoubleEntry(
        {
          idempotencyKey: `refund:platform_fee:${paymentIdStr}:${sanitizedReason}`,
          entryType: 'PLATFORM_FEE',
          accountType: 'ESCROW',
          amountMinor: platformFeeMinor,
          bookingId: bookingIdStr || null,
          paymentId: paymentIdStr,
          correlationId: `refund_${paymentIdStr}`,
          notes: reason || 'Platform fee retained on refund/cancellation',
        },
        {
          idempotencyKey: `refund:platform_fee_credit:${paymentIdStr}:${sanitizedReason}`,
          entryType: 'PLATFORM_FEE',
          accountType: 'PLATFORM',
          amountMinor: platformFeeMinor,
          bookingId: bookingIdStr || null,
          paymentId: paymentIdStr,
          correlationId: `refund_${paymentIdStr}`,
          notes: reason || 'Platform fee revenue recognised on refund/cancellation',
        },
        session
      );
    }
  });

  const bookingIdStr = (payment.bookingId?._id || payment.bookingId || bookingId).toString();
  const clientIdStr = (payment.clientId?._id || payment.clientId || '').toString();
  const paymentIdStr = (updated?._id || updated?.id || payment._id).toString();

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
  settlePayment,
  reconcilePayment,
  getPaymentStatus,
  getClientHistory,
  processRefund,
  round2,
  getProvider,
};
