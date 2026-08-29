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

const identifyParties = (booking, user) => {
  const userId = (user._id || user.id).toString();
  const clientId = (booking.clientId?._id || booking.clientId).toString();
  const stylistId = (booking.stylistId?._id || booking.stylistId).toString();
  return { userId, clientId, stylistId };
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

  const { userId, clientId, stylistId } = identifyParties(booking, user);
  if (userId !== clientId && userId !== stylistId) {
    throw new ApiError(403, 'Forbidden');
  }

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

  const updated = await bookingRepository.updateById(bookingId, {
    noShowDetails: {
      reportedBy: userId,
      reportedAt: new Date(),
      reportedAgainst,
      evidence,
    },
  });

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

  const { userId, clientId, stylistId } = identifyParties(booking, user);
  const accusedId = booking.noShowDetails.reportedAgainst === 'stylist' ? stylistId : clientId;
  if (userId !== accusedId) {
    throw new ApiError(403, 'Only the reported party can respond to this report');
  }

  if (contest) {
    const updated = await bookingRepository.updateById(bookingId, {
      status: BOOKING_STATUS.DISPUTED,
      'noShowDetails.respondedAt': new Date(),
      'noShowDetails.response': message,
      disputeDetails: {
        raisedBy: userId,
        reason: message || 'Contested no-show report',
        type: 'no_show',
        raisedAt: new Date(),
        evidence: [],
      },
    });

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
  await bookingRepository.updateById(bookingId, {
    'noShowDetails.respondedAt': new Date(),
    'noShowDetails.response': message,
  });
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

  const updated = await bookingRepository.updateById(bookingId, {
    status: targetStatus,
    'noShowDetails.confirmedBy': confirmedBy,
    'noShowDetails.confirmedAt': new Date(),
    payoutStatus: policy.STYLIST_PERCENTAGE > 0 ? 'unpaid' : 'paid', // 'paid' == nothing owed
  });

  // 1. Refund the client their share.
  const payment = await paymentRepository.findByBookingId(bookingId);
  if (payment && payment.status === PAYMENT_STATUS.PAID && policy.CLIENT_REFUND_PERCENTAGE > 0) {
    try {
      await paymentService.processRefund({
        bookingId,
        refundPercentage: policy.CLIENT_REFUND_PERCENTAGE,
        reason: reason || `No-show by ${against}`,
      });
    } catch (refundErr) {
      await paymentRepository.updateById(payment._id, {
        refundError: refundErr.message,
        refundFailedAt: new Date(),
      });
      logger.error(`No-show refund failed for booking ${bookingId}: ${refundErr.message}`);
    }
  }

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
      await ledgerService.postEntry({
        idempotencyKey: `penalty:no_show:${bookingId}`,
        entryType: 'PENALTY_ASSESSMENT',
        accountType: 'STYLIST',
        accountId: stylistId,
        direction: 'DEBIT',
        amountMinor: egpToPiastres(penaltyAmount),
        bookingId,
        correlationId: `booking_${bookingId}`,
        notes: `No-show penalty (${policy.STYLIST_PENALTY_PERCENTAGE}%) for booking #${bookingId}`,
      });
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
 * Admin arbitration of a contested report.
 */
export const adminResolveNoShow = async (adminUser, bookingId, { upheld, notes = '' }) => {
  if (adminUser.role !== ROLES.ADMIN) {
    throw new ApiError(403, 'Forbidden');
  }
  const booking = await bookingRepository.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  if (!upheld) {
    // Report dismissed — the booking returns to its normal course.
    const restored = await bookingRepository.updateById(bookingId, {
      status: BOOKING_STATUS.CONFIRMED,
      'noShowDetails.confirmedBy': adminUser._id || adminUser.id,
      'noShowDetails.confirmedAt': new Date(),
      'noShowDetails.response': notes,
    });
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
