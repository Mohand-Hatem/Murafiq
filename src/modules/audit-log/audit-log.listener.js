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
};

export default { register };
