import bookingRepository from './booking.repository.js';
import scheduleRepository from './schedule.repository.js';
import paymentRepository from '../payments/payment.repository.js';
import paymentService from '../payments/payment.service.js';
import penaltyRepository from '../penalties/penalty.repository.js';
import couponService from '../coupons/coupon.service.js';
import ledgerService, { egpToPiastres } from '../ledger/ledger.service.js';
import reliabilityService from '../stylists/reliability.service.js';
import chatService from '../chat/chat.service.js';
import { toPublicBookingDto } from './booking.dto.js';
import { assertBookingParticipant } from '../../common/authz/assertParticipant.js';
import { computeSettlement } from '../../common/settlement.js';
import { withTransaction } from '../../common/transaction.util.js';
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
 * no-show status with settlementCompletedAt stamped, and every financial write below
 * carries a deterministic idempotency key, so a retry after a partial failure cannot
 * double-refund or double-penalise.
 */
export const resolveNoShow = async (bookingId, { confirmedBy = null, reason = '' } = {}) => {
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  const isTerminalNoShow =
    booking.status === BOOKING_STATUS.NO_SHOW_STYLIST ||
    booking.status === BOOKING_STATUS.NO_SHOW_CLIENT;

  // Terminal status with completion marker means settlement is genuinely done.
  // A terminal status with NO completion marker means RESUME — do not early return!
  if (isTerminalNoShow && booking.noShowDetails?.settlementCompletedAt) {
    return toPublicBookingDto(booking);
  }

  if (!isTerminalNoShow) {
    if (!REPORTABLE_STATUSES.includes(booking.status)) {
      logger.warn(
        `resolveNoShow: booking ${bookingId} is in '${booking.status}' status, not reportable; no money moved.`
      );
      return toPublicBookingDto(booking);
    }
    if (!booking.noShowDetails?.reportedAt) {
      throw new ApiError(400, 'No no-show has been reported for this booking');
    }
  }

  const against = booking.noShowDetails?.reportedAgainst;
  const policy = against === 'stylist' ? NO_SHOW_POLICY.STYLIST : NO_SHOW_POLICY.CLIENT;
  const targetStatus =
    against === 'stylist' ? BOOKING_STATUS.NO_SHOW_STYLIST : BOOKING_STATUS.NO_SHOW_CLIENT;

  const payment = await paymentRepository.findByBookingId(bookingId);
  const effectivePrice = payment?.amount ?? booking.price ?? 0;
  const clientId = (booking.clientId?._id || booking.clientId).toString();
  const stylistId = (booking.stylistId?._id || booking.stylistId).toString();
  const settlement = computeSettlement({ price: effectivePrice, event: 'NO_SHOW', actor: against });

  try {
    // Step A (OUTSIDE txn): Claim the booking atomically, guarded on it still being in a REPORTABLE status.
    // (If resuming, booking is already in targetStatus, so Step A is already committed).
    if (!isTerminalNoShow) {
      const claimed = await bookingRepository.settleNoShow(bookingId, {
        status: targetStatus,
        'noShowDetails.confirmedBy': confirmedBy || booking.noShowDetails?.confirmedBy,
        'noShowDetails.confirmedAt': booking.noShowDetails?.confirmedAt || new Date(),
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
    }

    // Step B (OUTSIDE txn): processRefund with idempotency guard
    if (payment?.status === PAYMENT_STATUS.REFUNDING) {
      // AMBIGUOUS: the provider may or may not have refunded. Auto-retrying could double-refund.
      // Stop, record, and escalate to a human. This is the one branch that must never guess.
      await bookingRepository.recordPostSettlementError(
        bookingId,
        'refund',
        'Payment stuck in REFUNDING - manual reconciliation required'
      );
      logger.error(`[No-show] Payment ${payment._id} stuck in REFUNDING; settlement halted for booking ${bookingId}`);
      throw new ApiError(409, 'Refund state is ambiguous; this settlement requires manual reconciliation.');
    }

    const alreadyRefunded =
      payment?.status === PAYMENT_STATUS.REFUNDED || payment?.status === PAYMENT_STATUS.PARTIALLY_REFUNDED;

    if (payment && payment.status === PAYMENT_STATUS.PAID && policy.CLIENT_REFUND_PERCENTAGE > 0) {
      // Idempotency guard: pass deterministic key to provider to prevent duplicate external refunds on retry.
      // If processRefund throws, do NOT swallow. Rethrow to abort the settlement!
      await paymentService.processRefund({
        bookingId,
        refundPercentage: policy.CLIENT_REFUND_PERCENTAGE,
        reason: reason || `No-show by ${against}`,
        stylistPayoutOverrideAmount: settlement.stylistCompensationAmount,
        idempotencyKey: `refund-noshow-${bookingId}`,
      });
    } else if (alreadyRefunded) {
      logger.info(`[No-show] Payment ${payment._id} already refunded; skipping provider call on resume.`);
    }

    // Step C (INSIDE txn): payoutStatus write + Penalty create + ledger postDoubleEntry(session)
    await withTransaction(async (session) => {
      await bookingRepository.updateById(
        bookingId,
        {
          payoutStatus: policy.STYLIST_PERCENTAGE > 0 ? 'unpaid' : 'paid',
        },
        session
      );

      if (policy.STYLIST_PENALTY_PERCENTAGE > 0) {
        const penaltyAmount = settlement.penaltyAmount;
        try {
          await penaltyRepository.create(
            {
              stylistId,
              bookingId,
              reasonType: 'NO_SHOW',
              assessedMinor: egpToPiastres(penaltyAmount),
              status: 'OUTSTANDING',
            },
            session
          );
        } catch (err) {
          // Unique {bookingId, reasonType} — a retry hits this and is already assessed.
          if (err.code !== 11000) throw err;
        }

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
          },
          session
        );
      }
    });

    // Step D (AFTER txn): schedule delete, coupon, reliability, chat lock (idempotent)
    let hasPostSettlementError = false;

    // 1. Free the stylist's calendar slot — moved AFTER CAS claim and transaction (NS1)
    try {
      await scheduleRepository.deleteByBookingId(bookingId);
    } catch (schedErr) {
      hasPostSettlementError = true;
      await bookingRepository.recordPostSettlementError(bookingId, 'schedule', schedErr.message);
      logger.error(`[No-show] Schedule delete failed for booking ${bookingId}: ${schedErr.message}`);
    }

    // 2. Compensate client with coupon where policy calls for it
    if (policy.ISSUES_COUPON) {
      try {
        await couponService.issueCoupon({
          recipientId: clientId,
          sourceBookingId: bookingId,
          issuedReason: 'NO_SHOW_COMPENSATION',
        });
      } catch (couponErr) {
        hasPostSettlementError = true;
        await bookingRepository.recordPostSettlementError(bookingId, 'coupon', couponErr.message);
        logger.error(`[No-show] Coupon issuance failed for booking ${bookingId}: ${couponErr.message}`);
      }
    }

    // 3. Reliability recompute (only stylist no-show hurts stylist reliability)
    if (against === 'stylist') {
      try {
        await reliabilityService.updateStylistReliability(stylistId);
      } catch (relErr) {
        hasPostSettlementError = true;
        await bookingRepository.recordPostSettlementError(bookingId, 'reliability', relErr.message);
        logger.error(`[No-show] Reliability recompute failed for stylist ${stylistId}: ${relErr.message}`);
      }
    }

    // 4. Lock chat conversation
    try {
      await chatService.lockConversation(bookingId);
    } catch (chatErr) {
      hasPostSettlementError = true;
      await bookingRepository.recordPostSettlementError(bookingId, 'chat', chatErr.message);
      logger.error(`[No-show] Chat lock failed for booking ${bookingId}: ${chatErr.message}`);
    }

    // 5. Emit domain event
    try {
      eventBus.emit(EVENTS.NO_SHOW_RESOLVED, {
        bookingId: bookingId.toString(),
        against,
        clientRefundPercentage: policy.CLIENT_REFUND_PERCENTAGE,
        stylistPercentage: policy.STYLIST_PERCENTAGE,
        platformPercentage: policy.PLATFORM_PERCENTAGE,
        stylistId,
        clientId,
      });
    } catch (evErr) {
      logger.error(`[No-show] Event emission failed for booking ${bookingId}: ${evErr.message}`);
    }

    // Step E: Stamp completion marker if all Step D actions succeeded, or release lock
    if (!hasPostSettlementError) {
      await bookingRepository.stampSettlementCompleted(bookingId);
    } else {
      await bookingRepository.releaseSettlementResumeClaim(bookingId);
    }

    const updated = await bookingRepository.findById(bookingId);
    return toPublicBookingDto(updated);
  } catch (err) {
    await bookingRepository.releaseSettlementResumeClaim(bookingId);
    throw err;
  }
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

/**
 * Second-pass sweep: resumes unfinished settlements that crashed or failed after status claim.
 * Cluster-safe via atomic claimSettlementResume. Bounded retry up to maxAttempts.
 */
export const resumeUnfinishedNoShowSettlements = async (maxAttempts = 5, batchSize = 50) => {
  const unfinished = await bookingRepository.findUnfinishedNoShowSettlements(maxAttempts, batchSize);
  let resolved = 0;
  for (const booking of unfinished) {
    const claimed = await bookingRepository.claimSettlementResume(booking._id);
    if (!claimed) {
      continue;
    }
    try {
      await resolveNoShow(booking._id, {
        confirmedBy: booking.noShowDetails?.confirmedBy,
        reason: 'Resumed unfinished no-show settlement',
      });
      resolved += 1;
    } catch (err) {
      await bookingRepository.releaseSettlementResumeClaim(booking._id);
      if ((booking.noShowDetails?.settlementAttempts || 0) + 1 >= maxAttempts) {
        await bookingRepository.markSettlementExhausted(booking._id, err.message);
        logger.error(
          `[CRITICAL ALERT] No-show settlement permanently exhausted for booking ${booking._id}: ${err.message}`
        );
      } else {
        logger.warn(
          `[No-show] Failed resuming settlement for booking ${booking._id} (attempt ${(booking.noShowDetails?.settlementAttempts || 0) + 1}/${maxAttempts}): ${err.message}`
        );
      }
    }
  }
  return { resolved, scanned: unfinished.length };
};

/**
 * Manual admin retry action for a permanently exhausted no-show settlement.
 */
export const retryExhaustedNoShowSettlement = async (adminUser, bookingId) => {
  if (adminUser.role !== ROLES.ADMIN) {
    throw new ApiError(403, 'Only admins can retry exhausted no-show settlements');
  }
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }
  if (!booking.noShowDetails?.settlementExhausted) {
    throw new ApiError(400, 'This booking settlement is not in an exhausted state');
  }
  await bookingRepository.resetSettlementExhaustion(bookingId);
  return resolveNoShow(bookingId, {
    confirmedBy: adminUser._id || adminUser.id,
    reason: 'Manual retry of exhausted settlement by admin',
  });
};

export default {
  fileNoShow,
  respondToNoShow,
  resolveNoShow,
  adminResolveNoShow,
  autoResolveExpiredNoShows,
  resumeUnfinishedNoShowSettlements,
  retryExhaustedNoShowSettlement,
};
