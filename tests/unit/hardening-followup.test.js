import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import eventBus from '../../src/common/events/event-bus.js';
import { EVENTS } from '../../src/common/constants/events.constant.js';
import bookingService from '../../src/modules/bookings/booking.service.js';
import bookingRepository from '../../src/modules/bookings/booking.repository.js';
import paymentRepository from '../../src/modules/payments/payment.repository.js';
import paymentService from '../../src/modules/payments/payment.service.js';
import reviewService from '../../src/modules/reviews/review.service.js';
import reviewRepository from '../../src/modules/reviews/review.repository.js';
import userService from '../../src/modules/users/user.service.js';
import userRepository from '../../src/modules/users/user.repository.js';

/**
 * Regression tests for the four cross-module coherence gaps found in the
 * post-hardening review: an emitted-event graph with dangling listeners,
 * a dispute/payout clock anchored on the wrong timestamp, an unreconciled
 * refund-after-payout path, and two admin actions with no route.
 */

const clientId = '60f719b8f1a2c81234567891';
const stylistId = '60f719b8f1a2c81234567892';
const bookingId = '60f719b8f1a2c81234567893';
const adminId = '60f719b8f1a2c81234567890';
const reviewId = '60f719b8f1a2c81234567894';
// Must be a real 24-hex ObjectId: paymentId is an ObjectId ref on LedgerEntry, so a
// placeholder like 'pay1' fails schema casting when the ledger dual-write runs.
const paymentId = '60f719b8f1a2c81234567895';

// jest.spyOn on these singleton repository/service objects leaks across describe
// blocks in this file unless explicitly restored — clearAllMocks() only resets call
// history, not the mocked implementation, so a later block can otherwise observe an
// earlier block's stub (e.g. a spy on paymentService.processRefund returning {}).
afterEach(() => {
  jest.restoreAllMocks();
});

describe('checkIn() emits CHECK_IN_COMPLETED', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fires the event with bookingId and clientId once check-in succeeds', async () => {
    jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
      _id: bookingId,
      clientId: { _id: clientId },
      stylistId: { _id: stylistId },
      status: 'confirmed',
    });
    jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue({ status: 'paid' });
    jest.spyOn(bookingRepository, 'updateById').mockResolvedValue({
      _id: bookingId,
      clientId: { _id: clientId },
      stylistId: { _id: stylistId },
      status: 'in-progress',
    });

    const handler = jest.fn();
    eventBus.once(EVENTS.CHECK_IN_COMPLETED, handler);

    await bookingService.checkIn({ _id: stylistId, role: 'stylist' }, bookingId, {});

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ bookingId, clientId }));
  });
});

describe('confirmCompletion() / resolveDispute() set completedAt', () => {
  beforeEach(() => jest.clearAllMocks());

  it('confirmCompletion writes completedAt in the same update as status: completed', async () => {
    jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
      _id: bookingId,
      clientId: { _id: clientId },
      stylistId: { _id: stylistId },
      status: 'in-progress',
      clientConfirmedAt: new Date(),
    });
    const updateSpy = jest.spyOn(bookingRepository, 'updateById').mockResolvedValue({
      _id: bookingId,
      clientId: { _id: clientId },
      stylistId: { _id: stylistId },
      status: 'completed',
    });

    await bookingService.confirmCompletion({ _id: stylistId, role: 'stylist' }, bookingId);

    expect(updateSpy).toHaveBeenCalledWith(
      bookingId,
      expect.objectContaining({ status: 'completed', completedAt: expect.any(Date) })
    );
  });

  it('resolveDispute writes completedAt only when the outcome is completed, not cancelled', async () => {
    jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
      _id: bookingId,
      status: 'disputed',
      clientId: { _id: clientId },
      stylistId: { _id: stylistId },
    });
    jest.spyOn(paymentService, 'processRefund').mockResolvedValue({});
    const updateSpy = jest.spyOn(bookingRepository, 'updateById').mockResolvedValue({
      _id: bookingId,
      status: 'cancelled',
      clientId: { _id: clientId },
      stylistId: { _id: stylistId },
    });

    await bookingService.resolveDispute(adminId, bookingId, {
      outcome: 'cancelled',
      refundPercentage: 100,
      resolutionNotes: 'No-show confirmed',
    });

    const [, updatePayload] = updateSpy.mock.calls[0];
    expect(updatePayload.completedAt).toBeUndefined();
  });
});

describe('fileDispute() anchors the 48h window on completedAt, not updatedAt', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects a stale dispute even when updatedAt was recently touched (e.g. by a payout batch)', async () => {
    const oldCompletion = new Date(Date.now() - 50 * 3600 * 1000); // 50h ago
    const recentTouch = new Date(); // updated moments ago by an unrelated write

    jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
      _id: bookingId,
      clientId: { _id: clientId },
      stylistId: { _id: stylistId },
      status: 'completed',
      completedAt: oldCompletion,
      updatedAt: recentTouch,
      createdAt: oldCompletion,
    });

    await expect(
      bookingService.fileDispute({ _id: clientId, role: 'client' }, bookingId, {
        reason: 'Too late, but updatedAt drifted',
      })
    ).rejects.toThrow(/Dispute filing window expired/i);
  });

  it('allows a timely dispute when completedAt is recent even if updatedAt is stale', async () => {
    const recentCompletion = new Date(Date.now() - 5 * 3600 * 1000); // 5h ago

    jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
      _id: bookingId,
      clientId: { _id: clientId },
      stylistId: { _id: stylistId },
      status: 'completed',
      completedAt: recentCompletion,
      updatedAt: recentCompletion,
      createdAt: recentCompletion,
    });
    jest.spyOn(bookingRepository, 'updateById').mockResolvedValue({
      _id: bookingId,
      status: 'disputed',
      clientId: { _id: clientId },
      stylistId: { _id: stylistId },
    });

    const result = await bookingService.fileDispute({ _id: clientId, role: 'client' }, bookingId, {
      reason: 'Within window',
    });

    expect(result.status).toBe('disputed');
  });
});

describe('processRefund() blocks refunds against an already-batched payout', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects with 409 when the booking payoutStatus is processing', async () => {
    jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue({
      _id: paymentId,
      status: 'paid',
      amount: 1000,
      bookingId,
      clientId,
    });
    jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
      _id: bookingId,
      payoutStatus: 'processing',
    });

    await expect(paymentService.processRefund({ bookingId, refundPercentage: 100 })).rejects.toThrow(
      /payout is already 'processing'/i
    );
  });

  it('allows the refund when the booking payoutStatus is unpaid', async () => {
    jest.spyOn(paymentRepository, 'findByBookingId').mockResolvedValue({
      _id: paymentId,
      status: 'paid',
      amount: 1000,
      bookingId,
      clientId,
    });
    jest.spyOn(bookingRepository, 'findById').mockResolvedValue({
      _id: bookingId,
      payoutStatus: 'unpaid',
    });
    jest.spyOn(paymentRepository, 'updateById').mockResolvedValue({
      _id: paymentId,
      status: 'refunded',
      bookingId,
      clientId,
    });

    const result = await paymentService.processRefund({ bookingId, refundPercentage: 100 });
    expect(result.status).toBe('refunded');
  });
});

describe('hideReview() emits REVIEW_HIDDEN / REVIEW_UNHIDDEN', () => {
  beforeEach(() => jest.clearAllMocks());

  it('emits REVIEW_HIDDEN with the acting adminId when hiding', async () => {
    jest.spyOn(reviewRepository, 'findById').mockResolvedValue({
      _id: reviewId,
      revieweeId: { _id: stylistId },
      direction: 'client_to_stylist',
    });
    jest.spyOn(reviewRepository, 'updateById').mockResolvedValue({ _id: reviewId, isHidden: true });
    jest.spyOn(reviewService, 'recalculateAverages').mockResolvedValue();

    const handler = jest.fn();
    eventBus.once(EVENTS.REVIEW_HIDDEN, handler);

    await reviewService.hideReview(reviewId, true, adminId, 'Abusive content');

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId, adminId, reason: 'Abusive content' })
    );
  });

  it('emits REVIEW_UNHIDDEN, not REVIEW_HIDDEN, when reversing a hide', async () => {
    jest.spyOn(reviewRepository, 'findById').mockResolvedValue({
      _id: reviewId,
      revieweeId: { _id: stylistId },
      direction: 'client_to_stylist',
    });
    jest.spyOn(reviewRepository, 'updateById').mockResolvedValue({ _id: reviewId, isHidden: false });
    jest.spyOn(reviewService, 'recalculateAverages').mockResolvedValue();

    const hiddenHandler = jest.fn();
    const unhiddenHandler = jest.fn();
    eventBus.once(EVENTS.REVIEW_HIDDEN, hiddenHandler);
    eventBus.once(EVENTS.REVIEW_UNHIDDEN, unhiddenHandler);

    await reviewService.hideReview(reviewId, false, adminId);

    expect(unhiddenHandler).toHaveBeenCalled();
    expect(hiddenHandler).not.toHaveBeenCalled();
  });
});

describe('suspendUser() / reactivateUser()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('suspends an active user and emits USER_SUSPENDED', async () => {
    jest.spyOn(userRepository, 'findById').mockResolvedValue({
      _id: clientId,
      accountStatus: 'active',
    });
    jest.spyOn(userRepository, 'updateById').mockResolvedValue({
      _id: clientId,
      accountStatus: 'suspended',
    });

    const handler = jest.fn();
    eventBus.once(EVENTS.USER_SUSPENDED, handler);

    await userService.suspendUser(clientId, adminId, 'Fraudulent activity');

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ userId: clientId, adminId, reason: 'Fraudulent activity' })
    );
  });

  it('refuses to suspend an already-suspended user', async () => {
    jest.spyOn(userRepository, 'findById').mockResolvedValue({
      _id: clientId,
      accountStatus: 'suspended',
    });

    await expect(userService.suspendUser(clientId, adminId, 'again')).rejects.toThrow(
      /already suspended/i
    );
  });

  it('reactivates a suspended user and emits USER_REACTIVATED', async () => {
    jest.spyOn(userRepository, 'findById').mockResolvedValue({
      _id: clientId,
      accountStatus: 'suspended',
    });
    jest.spyOn(userRepository, 'updateById').mockResolvedValue({
      _id: clientId,
      accountStatus: 'active',
    });

    const handler = jest.fn();
    eventBus.once(EVENTS.USER_REACTIVATED, handler);

    await userService.reactivateUser(clientId, adminId);

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ userId: clientId, adminId }));
  });

  it('refuses to reactivate a user who is not currently suspended', async () => {
    jest.spyOn(userRepository, 'findById').mockResolvedValue({
      _id: clientId,
      accountStatus: 'active',
    });

    await expect(userService.reactivateUser(clientId, adminId)).rejects.toThrow(
      /only 'suspended' can be reactivated/i
    );
  });
});
