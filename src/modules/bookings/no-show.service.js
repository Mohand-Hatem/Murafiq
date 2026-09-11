import bookingRepository from './booking.repository.js';
import scheduleRepository from './schedule.repository.js';
import paymentRepository from '../payments/payment.repository.js';
import paymentService, { round2 } from '../payments/payment.service.js';
import penaltyRepository from '../penalties/penalty.repository.js';
import couponService from '../coupons/coupon.service.js';
import ledgerService, { egpToPiastres } from '../ledger/ledger.service.js';
import reliabilityService from '../stylists/reliability.service.js';
import chatService from '../chat/chat.service.js';
import { toPublicBookingDto } from './booking.dto.js';
import { assertBookingParticipant } from '../../common/authz/assertParticipant.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import { ROLES } from '../../common/constants/roles.constant.js';
import {
  BOOKING_STATUS,
  PAYMENT_STATUS,
  NO_SHOW_POLICY,
} from '../../common/constants/statuses.constant.js';
import getBusinessDayRange from '../../common/utils/businessDay.util.js';
import logger from '../../config/logger.config.js';

const REPORTABLE_STATUSES = [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.IN_PROGRESS];

const resolveScheduledStart = (booking) => {
  const { startOfDay } = getBusinessDayRange(booking.scheduledDate, 'Africa/Cairo');
  const startMinute = booking.scheduledStartMinute ?? 0;
  return new Date(startOfDay.getTime() + startMinute * 60 * 1000);
};

/**
 * File a no-show against the counterparty.
 *
 * A one-tap "they didn't show" that moves money and penalises the other party is a
 * fraud primitive, so this is gated three ways: it cannot be filed before the grace
 * window has elapsed, the accused gets a response window before anything settles, and
 * a contested report goes to admin arbitration rather than auto-resolving. Nothing
 * financial happens in this function — see `resolveNoShow`.
 */
export const fileNoShow = async (user, bookingId, { evidence = [] } = {}) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  const { userId, clientId } = assertBookingParticipant(user, booking, { allowAdmin: false });

  if (!REPORTABLE_STATUSES.includes(booking.status)) {
    throw new ApiError(400, `Cannot report a no-show on a booking in '${booking.status}' status`);
  }
  if (booking.noShowDetails?.reportedAt) {
    throw new ApiError(409, 'A no-show has already been reported for this booking');
  }

  const scheduledStart = resolveScheduledStart(booking);
  const graceEndsAt = new Date(
    scheduledStart.getTime() + NO_SHOW_POLICY.REPORT_GRACE_MINUTES * 60 * 1000
  );
  if (Date.now() < graceEndsAt.getTime()) {
    throw new ApiError(
      400,
      `A no-show cannot be reported until ${NO_SHOW_POLICY.REPORT_GRACE_MINUTES} minutes after the scheduled start time.`
    );
  }

  // The reporter must themselves have turned up. checkInAt is the only evidence the
  // platform holds that the accuser was present, so without it there is nothing to
  // distinguish a genuine report from a party who also failed to attend.
  if (!booking.checkInAt) {
    throw new ApiError(
      400,
      'You must check in at the meeting location before reporting the other party as a no-show.'
    );
  }

  const reportedAgainst = userId === clientId ? 'stylist' : 'client';

  const updated = await bookingRepository.transitionStatus(
    bookingId,
    ['confirmed', 'in-progress'],
    {
      noShowDetails: {
        reportedBy: userId,
        reportedAt: new Date(),
        reportedAgainst,
        evidence,
      },
    }
  );

  if (!updated) {
    throw new ApiError(400, 'Cannot file no-show: booking is no longer in a reportable status');
  }

  eventBus.emit(EVENTS.NO_SHOW_REPORTED, {
    bookingId: bookingId.toString(),
    reportedBy: userId,
    reportedAgainst,
  });

  return {
    booking: toPublicBookingDto(updated),
    respondBy: new Date(Date.now() + NO_SHOW_POLICY.RESPONSE_WINDOW_HOURS * 3600 * 1000),
  };
};

/**
 * The accused party's rebuttal. Contesting escalates to admin arbitration through the
 * existing dispute flow rather than resolving automatically — a disputed no-show is
 * exactly the case a human is needed for.
 */
export const respondToNoShow = async (user, bookingId, { contest, message = '' }) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }
  if (!booking.noShowDetails?.reportedAt) {
    throw new ApiError(400, 'No no-show has been reported for this booking');
  }
  if (booking.noShowDetails.respondedAt) {
    throw new ApiError(409, 'You have already responded to this report');
  }

  const { userId, clientId, stylistId } = assertBookingParticipant(user, booking, { allowAdmin: false });
  const accusedId = booking.noShowDetails.reportedAgainst === 'stylist' ? stylistId : clientId;
  if (userId !== accusedId) {
    throw new ApiError(403, 'Only the reported party can respond to this report');
  }

  if (contest) {
    const updated = await bookingRepository.transitionStatus(
      bookingId,
      ['confirmed', 'in-progress'],
      {
        status: BOOKING_STATUS.DISPUTED,
        // Snapshot the pre-dispute status so adminResolveNoShow can restore it exactly on
        // dismissal, instead of assuming every no-show report was filed from 'confirmed'.
        'noShowDetails.contestedFromStatus': booking.status,
        'noShowDetails.respondedAt': new Date(),
        'noShowDetails.response': message,
        disputeDetails: {
          raisedBy: userId,
          reason: message || 'Contested no-show report',
          type: 'no_show',
          raisedAt: new Date(),
          evidence: [],
        },
      }
    );

    if (!updated) {
      throw new ApiError(409, 'Cannot contest: this booking is no longer contestable');
    }

    try {
      await chatService.openConversation(bookingId);
    } catch (_err) {
      /* non-fatal */
    }

    eventBus.emit(EVENTS.DISPUTE_RAISED, {
      bookingId: bookingId.toString(),
      raisedBy: userId,
      reason: 'Contested no-show',
      type: 'no_show',
    });

    return toPublicBookingDto(updated);
  }

  // Not contested — the accused accepts it, so settle immediately.
  const updated = await bookingRepository.transitionStatus(
    bookingId,
    ['confirmed', 'in-progress'],
    {
      'noShowDetails.respondedAt': new Date(),
      'noShowDetails.response': message,
    }
  );

  if (!updated) {
    throw new ApiError(409, 'Cannot accept no-show: booking is no longer in a valid status');
  }

  return resolveNoShow(bookingId, { confirmedBy: userId, reason: 'Accepted by reported party' });
};

/**
 * Settle a confirmed no-show. This is the only function here that moves money.
 *
 * Idempotent by construction: it refuses to run on a booking already in a terminal
 * no-show status, and every financial write below carries a deterministic idempotency
 * key, so a retry after a partial failure cannot double-refund or double-penalise.
 */
export const resolveNoShow = async (bookingId, { confirmedBy = null, reason = '' } = {}) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }
  if (
    booking.status === BOOKING_STATUS.NO_SHOW_STYLIST ||
    booking.status === BOOKING_STATUS.NO_SHOW_CLIENT
  ) {
    return toPublicBookingDto(booking);
  }
  if (!booking.noShowDetails?.reportedAt) {
    throw new ApiError(400, 'No no-show has been reported for this booking');
  }

  const against = booking.noShowDetails.reportedAgainst;
  const policy = against === 'stylist' ? NO_SHOW_POLICY.STYLIST : NO_SHOW_POLICY.CLIENT;
  const targetStatus =
    against === 'stylist' ? BOOKING_STATUS.NO_SHOW_STYLIST : BOOKING_STATUS.NO_SHOW_CLIENT;

  const price = booking.price || 0;
  const clientId = (booking.clientId?._id || booking.clientId).toString();
  const stylistId = (booking.stylistId?._id || booking.stylistId).toString();

  // Free the stylist's calendar slot — the session is not happening.
  await scheduleRepository.deleteByBookingId(bookingId);

  // Claim the booking atomically, guarded on it still being in a REPORTABLE status.
  // Without this CAS, a race between this no-show sweep and a genuine mutual-completion
  // confirmation landing at the same time could overwrite a booking that actually just
  // completed successfully -- money already earned, reliability already recomputed --
  // with a no-show status. Deliberately does NOT set payoutStatus yet: that write comes
  // after the refund below, not before (see the X1 note there). See
  // docs/AUDIT_2026_09_FULL_SYSTEM.md finding X9.
  const claimed = await bookingRepository.settleNoShow(bookingId, {
    status: targetStatus,
    'noShowDetails.confirmedBy': confirmedBy,
    'noShowDetails.confirmedAt': new Date(),
  });
  if (!claimed) {
    // The booking moved on (most likely: both parties confirmed completion) between our
    // initial read and this write. Nothing financial has happened yet, so there is
    // nothing to unwind -- just report the booking's actual current state.
    const current = await bookingRepository.findById(bookingId);
    logger.warn(
      `resolveNoShow: booking ${bookingId} left status '${booking.status}' before it could be settled; no money moved.`
    );
    return toPublicBookingDto(current);
  }

  // Refund BEFORE flipping the booking's own payoutStatus. processRefund() refuses to run
  // once booking.payoutStatus is anything other than 'unpaid' (its guard means "this booking
  // has already been batched into a real Payout, reconcile that first"). At this point in the
  // flow payoutStatus is still whatever it was before this no-show was reported -- 'unpaid',
  // since only a completed/no-show-client booking can ever be batched -- so calling the refund
  // here is always correctly attempted regardless of which side is at fault.
  //
  // This ordering used to be reversed: the booking below was updated to
  // payoutStatus:'paid' FIRST when policy.STYLIST_PERCENTAGE is 0 (meaning "nothing owed to
  // the stylist"), and processRefund's guard then read that same 'paid' value as "already
  // disbursed, refuse" -- so a stylist no-show (STYLIST_PERCENTAGE: 0) permanently and
  // silently failed to refund the client. See docs/AUDIT_2026_09_FULL_SYSTEM.md finding X1.
  const payment = await paymentRepository.findByBookingId(bookingId);
  if (payment && payment.status === PAYMENT_STATUS.PAID && policy.CLIENT_REFUND_PERCENTAGE > 0) {
    try {
      await paymentService.processRefund({
        bookingId,
        refundPercentage: policy.CLIENT_REFUND_PERCENTAGE,
        reason: reason || `No-show by ${against}`,
        stylistPayoutOverrideAmount: round2(payment.amount * (policy.STYLIST_PERCENTAGE / 100)),
      });
    } catch (refundErr) {
      await paymentRepository.updateById(payment._id, {
        refundError: refundErr.message,
        refundFailedAt: new Date(),
      });
      logger.error(`No-show refund failed for booking ${bookingId}: ${refundErr.message}`);
    }
  }

  const updated = await bookingRepository.updateById(bookingId, {
    payoutStatus: policy.STYLIST_PERCENTAGE > 0 ? 'unpaid' : 'paid', // 'paid' == nothing owed
  });

  // 2. Penalise the stylist, if they were the no-show. Recorded as debt against a
  //    future payout — never as a charge, since no stylist payment instrument is held.
  if (policy.STYLIST_PENALTY_PERCENTAGE > 0) {
    const penaltyAmount = round2(price * (policy.STYLIST_PENALTY_PERCENTAGE / 100));
    try {
      await penaltyRepository.create({
        stylistId,
        bookingId,
        reasonType: 'NO_SHOW',
        assessedMinor: egpToPiastres(penaltyAmount),
        status: 'OUTSTANDING',
      });
    } catch (err) {
      // Unique {bookingId, reasonType} — a retry hits this and is already assessed.
      if (err.code !== 11000) throw err;
    }
    try {
      // Paired: the stylist owes the platform this amount from the moment it's assessed
      // (accrual recognition), not only once it happens to be collected via a later payout
      // deduction -- see the identical pairing and rationale in booking.service.js's
      // stylist-cancellation penalty. Previously single-sided (DEBIT STYLIST only), which
      // permanently unbalanced this booking's ledger entries in the nightly reconciliation
      // sweep.
      await ledgerService.postDoubleEntry(
        {
          idempotencyKey: `penalty:no_show:stylist:${bookingId}`,
          entryType: 'PENALTY_ASSESSMENT',
          accountType: 'STYLIST',
          accountId: stylistId,
          amountMinor: egpToPiastres(penaltyAmount),
          bookingId,
          correlationId: `booking_${bookingId}`,
          notes: `No-show penalty (${policy.STYLIST_PENALTY_PERCENTAGE}%) for booking #${bookingId}`,
        },
        {
          idempotencyKey: `penalty:no_show:platform:${bookingId}`,
          entryType: 'PENALTY_ASSESSMENT',
          accountType: 'PLATFORM',
          amountMinor: egpToPiastres(penaltyAmount),
          bookingId,
          correlationId: `booking_${bookingId}`,
          notes: `No-show penalty (${policy.STYLIST_PENALTY_PERCENTAGE}%) recognised against booking #${bookingId}`,
        }
      );
    } catch (ledgerErr) {
      logger.error(`[Ledger] no-show penalty entry failed: ${ledgerErr.message}`);
    }
  }

  // 3. Compensate the client with a coupon where the policy calls for it.
  //    Idempotent on {sourceBookingId, issuedReason}.
  if (policy.ISSUES_COUPON) {
    try {
      await couponService.issueCoupon({
        recipientId: clientId,
        sourceBookingId: bookingId,
        issuedReason: 'NO_SHOW_COMPENSATION',
      });
    } catch (couponErr) {
      logger.error(`No-show coupon issuance failed for booking ${bookingId}: ${couponErr.message}`);
    }
  }

  // 4. Reliability. Only a stylist no-show damages the stylist's score; a client
  //    no-show must never count against the stylist who turned up.
  if (against === 'stylist') {
    try {
      await reliabilityService.updateStylistReliability(stylistId);
    } catch (relErr) {
      logger.error(`Reliability recompute failed for stylist ${stylistId}: ${relErr.message}`);
    }
  }

  try {
    await chatService.lockConversation(bookingId);
  } catch (_err) {
    /* non-fatal */
  }

  eventBus.emit(EVENTS.NO_SHOW_RESOLVED, {
    bookingId: bookingId.toString(),
    against,
    clientRefundPercentage: policy.CLIENT_REFUND_PERCENTAGE,
    stylistPercentage: policy.STYLIST_PERCENTAGE,
    platformPercentage: policy.PLATFORM_PERCENTAGE,
    stylistId,
    clientId,
  });

  return toPublicBookingDto(updated);
};

/**
 * Admin arbitration of a CONTESTED no-show report — reachable only from a booking the
 * `respondToNoShow` contest branch moved to 'disputed'. Guarded on that precondition
 * explicitly (rather than trusting the route comment alone) after an audit found this
 * function would previously reset ANY booking, in ANY status, to 'confirmed' given
 * {upheld:false} and no no-show context at all — see docs/AUDIT_2026_09_FULL_SYSTEM.md
 * finding X4.
 */
export const adminResolveNoShow = async (adminUser, bookingId, { upheld, notes = '' }) => {
  if (adminUser.role !== ROLES.ADMIN) {
    throw new ApiError(403, 'Forbidden');
  }
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  const details = booking.noShowDetails;
  if (!details?.reportedAt) {
    throw new ApiError(400, 'No no-show has been reported for this booking');
  }
  if (details.confirmedAt) {
    throw new ApiError(409, 'This no-show report has already been resolved');
  }
  if (!details.respondedAt || booking.status !== BOOKING_STATUS.DISPUTED) {
    throw new ApiError(
      400,
      'Only a CONTESTED no-show (one the accused party has disputed) can be arbitrated here. ' +
        'An uncontested report settles on its own via the response window.'
    );
  }

  if (!upheld) {
    // Report dismissed — the booking returns to exactly the status it held the instant
    // it was contested, never a hardcoded value, so this can never resurrect a booking
    // from a state the contest itself did not put it in.
    const restored = await bookingRepository.transitionStatus(
      bookingId,
      [BOOKING_STATUS.DISPUTED],
      {
        status: details.contestedFromStatus || BOOKING_STATUS.IN_PROGRESS,
        'noShowDetails.confirmedBy': adminUser._id || adminUser.id,
        'noShowDetails.confirmedAt': new Date(),
        'noShowDetails.response': notes,
      }
    );

    if (!restored) {
      throw new ApiError(409, 'Cannot dismiss no-show: booking was already resolved');
    }

    return toPublicBookingDto(restored);
  }

  return resolveNoShow(bookingId, {
    confirmedBy: adminUser._id || adminUser.id,
    reason: notes || 'Upheld by admin arbitration',
  });
};

/**
 * Sweep for reports whose response window has elapsed with no reply. Silence resolves
 * in the reporter's favour — otherwise ignoring the notification would be a free way
 * to stall settlement indefinitely.
 */
export const autoResolveExpiredNoShows = async (now = new Date()) => {
  const cutoff = new Date(now.getTime() - NO_SHOW_POLICY.RESPONSE_WINDOW_HOURS * 3600 * 1000);
  const pending = await bookingRepository.findPendingNoShowReports(cutoff);

  let resolved = 0;
  for (const booking of pending) {
    try {
      await resolveNoShow(booking._id, { reason: 'Auto-resolved: no response within window' });
      resolved += 1;
    } catch (err) {
      logger.error(`No-show auto-resolution failed for booking ${booking._id}: ${err.message}`);
    }
  }
  return { resolved, scanned: pending.length };
};

export default {
  fileNoShow,
  respondToNoShow,
  resolveNoShow,
  adminResolveNoShow,
  autoResolveExpiredNoShows,
};
