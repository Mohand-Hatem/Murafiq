import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import auditLogService from './audit-log.service.js';

export const register = () => {
  eventBus.on(EVENTS.USER_VERIFIED, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.reviewedBy,
      actorRole: 'admin',
      action: 'verification.approved',
      targetType: 'User',
      targetId: payload.userId,
    });
  });

  eventBus.on(EVENTS.USER_VERIFICATION_REJECTED, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.reviewedBy,
      actorRole: 'admin',
      action: 'verification.rejected',
      targetType: 'User',
      targetId: payload.userId,
      metadata: { reason: payload.reason },
    });
  });

  eventBus.on(EVENTS.PAYMENT_REFUNDED, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.refundedBy || null,
      actorRole: payload.refundedBy ? 'admin' : 'system',
      action: 'payment.refunded',
      targetType: 'Payment',
      targetId: payload.paymentId || payload.bookingId,
      metadata: { refundAmount: payload.refundAmount, reason: payload.reason },
    });
  });

  eventBus.on(EVENTS.ADMIN_CHAT_ACCESSED, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.adminId,
      actorRole: 'admin',
      action: 'admin.chat_accessed',
      targetType: 'Conversation',
      targetId: payload.conversationId,
      metadata: { bookingId: payload.bookingId },
    });
  });

  eventBus.on(EVENTS.USER_SUSPENDED, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.adminId,
      actorRole: 'admin',
      action: 'user.suspended',
      targetType: 'User',
      targetId: payload.userId,
      metadata: { reason: payload.reason },
    });
  });

  eventBus.on(EVENTS.USER_REACTIVATED, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.adminId,
      actorRole: 'admin',
      action: 'user.reactivated',
      targetType: 'User',
      targetId: payload.userId,
    });
  });

  eventBus.on(EVENTS.REVIEW_HIDDEN, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.adminId,
      actorRole: 'admin',
      action: 'review.hidden',
      targetType: 'Review',
      targetId: payload.reviewId,
      metadata: { reason: payload.reason },
    });
  });

  eventBus.on(EVENTS.REVIEW_UNHIDDEN, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.adminId,
      actorRole: 'admin',
      action: 'review.unhidden',
      targetType: 'Review',
      targetId: payload.reviewId,
      metadata: { reason: payload.reason },
    });
  });

  eventBus.on(EVENTS.PAYOUT_CREATED, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.processedBy || null,
      actorRole: 'admin',
      action: 'payout.created',
      targetType: 'Payout',
      targetId: payload.payoutId,
      metadata: { amount: payload.amount, stylistId: payload.stylistId },
    });
  });

  eventBus.on(EVENTS.PAYOUT_PROCESSING, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.processedBy || null,
      actorRole: 'admin',
      action: 'payout.processing',
      targetType: 'Payout',
      targetId: payload.payoutId,
      metadata: { stylistId: payload.stylistId },
    });
  });

  eventBus.on(EVENTS.PAYOUT_PAID, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.processedBy || null,
      actorRole: 'admin',
      action: 'payout.paid',
      targetType: 'Payout',
      targetId: payload.payoutId,
      metadata: { amount: payload.amount, stylistId: payload.stylistId, reference: payload.reference },
    });
  });

  eventBus.on(EVENTS.PAYOUT_FAILED, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.processedBy || null,
      actorRole: 'admin',
      action: 'payout.failed',
      targetType: 'Payout',
      targetId: payload.payoutId,
      metadata: { stylistId: payload.stylistId, failureReason: payload.failureReason },
    });
  });

  eventBus.on(EVENTS.DISPUTE_RAISED, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.raisedBy,
      actorRole: 'client',
      action: 'dispute.raised',
      targetType: 'Booking',
      targetId: payload.bookingId,
      metadata: { reason: payload.reason, type: payload.type },
    });
  });

  eventBus.on(EVENTS.DISPUTE_RESOLVED, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.resolvedBy,
      actorRole: 'admin',
      action: 'dispute.resolved',
      targetType: 'Booking',
      targetId: payload.bookingId,
      metadata: {
        outcome: payload.outcome,
        refundPercentage: payload.refundPercentage,
        resolutionNotes: payload.resolutionNotes,
      },
    });
  });

  // AGENTS.md: "if a new money/admin-affecting event is added, add it to AUDIT_EVENT_MAP."
  // The five below all move money or terminate a booking and were previously unaudited —
  // a cancellation could issue a refund and assess a penalty with no audit trail at all.

  eventBus.on(EVENTS.BOOKING_CANCELLED, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.cancelledByUserId || null,
      actorRole: payload.cancelledBy || 'system',
      action: 'booking.cancelled',
      targetType: 'Booking',
      targetId: payload.bookingId,
      metadata: {
        cancelledBy: payload.cancelledBy,
        stylistId: payload.stylistId,
        refundPercentage: payload.refundPercentage,
        penaltyAmount: payload.penaltyAmount,
        tier: payload.tier,
      },
    });
  });

  eventBus.on(EVENTS.NO_SHOW_REPORTED, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.reportedBy,
      actorRole: payload.reportedAgainst === 'stylist' ? 'client' : 'stylist',
      action: 'booking.no_show_reported',
      targetType: 'Booking',
      targetId: payload.bookingId,
      metadata: { reportedAgainst: payload.reportedAgainst },
    });
  });

  eventBus.on(EVENTS.NO_SHOW_RESOLVED, async (payload) => {
    await auditLogService.recordAction({
      actorId: null,
      actorRole: 'system',
      action: 'booking.no_show_resolved',
      targetType: 'Booking',
      targetId: payload.bookingId,
      metadata: {
        against: payload.against,
        clientRefundPercentage: payload.clientRefundPercentage,
        stylistPercentage: payload.stylistPercentage,
        platformPercentage: payload.platformPercentage,
      },
    });
  });

  eventBus.on(EVENTS.PAYMENT_SUCCEEDED, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.clientId,
      actorRole: 'client',
      action: 'payment.succeeded',
      targetType: 'Payment',
      targetId: payload.paymentId,
      metadata: { bookingId: payload.bookingId, amount: payload.amount },
    });
  });

  eventBus.on(EVENTS.PAYMENT_FAILED, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.clientId,
      actorRole: 'client',
      action: 'payment.failed',
      targetType: 'Payment',
      targetId: payload.paymentId,
      metadata: { bookingId: payload.bookingId, reason: payload.reason },
    });
  });

  eventBus.on(EVENTS.SUBSCRIPTION_ACTIVATED, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.userId,
      actorRole: 'system',
      action: 'subscription.activated',
      targetType: 'Subscription',
      targetId: payload.userId,
      metadata: { planCode: payload.planCode, billingCycle: payload.billingCycle },
    });
  });

  eventBus.on(EVENTS.SUBSCRIPTION_CANCELLED, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.userId,
      actorRole: 'system',
      action: 'subscription.cancelled',
      targetType: 'Subscription',
      targetId: payload.userId,
      metadata: { planCode: payload.planCode, currentPeriodEnd: payload.currentPeriodEnd },
    });
  });

  eventBus.on(EVENTS.SUBSCRIPTION_EXPIRED, async (payload) => {
    await auditLogService.recordAction({
      actorId: payload.userId,
      actorRole: 'system',
      action: 'subscription.expired',
      targetType: 'Subscription',
      targetId: payload.userId,
      metadata: { previousPlanCode: payload.previousPlanCode, downgradedTo: payload.downgradedTo },
    });
  });
};

export default { register };
