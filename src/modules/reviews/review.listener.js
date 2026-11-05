import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import reviewService from './review.service.js';
import bookingRepository from '../bookings/booking.repository.js';
import userRepository from '../users/user.repository.js';
import withTransaction from '../../common/transaction.util.js';
import logger from '../../config/logger.config.js';

// completedBookings is "how many of this client's bookings are completed right now", recounted
// from source rather than incremented, so a repeated or overlapping run cannot inflate it. The
// count and the write share one transaction: two recounts for the same client both write this
// user document, so the later one hits a write conflict and is retried on a fresh snapshot
// instead of writing a stale count.
const recountClientCompletedBookings = (clientId) =>
  withTransaction(async (session) => {
    const completedBookings = await bookingRepository.countCompletedByClientId(clientId, session);
    await userRepository.updateById(clientId, { $set: { completedBookings } }, session);
  });

class ReviewListener {
  constructor() {
    this.registered = false;
  }

  register() {
    if (this.registered) return;
    this.registered = true;

    // 1. Recalculate averages when a new review is submitted
    eventBus.on(EVENTS.REVIEW_SUBMITTED, async ({ revieweeId, direction }) => {
      try {
        if (revieweeId && direction) {
          await reviewService.recalculateAverages(revieweeId, direction);
        }
      } catch (err) {
        logger.error(`Error recalculating averages on REVIEW_SUBMITTED: ${err.message}`);
      }
    });

    // 2. Completion: recount the client's completed bookings. The stylist's completedSessions is
    // recomputed from source by stylist.listener.js. Rethrows so finalizeCompletion retries.
    eventBus.on(EVENTS.SESSION_COMPLETED, async ({ bookingId }) => {
      try {
        if (!bookingId) return;
        const booking = await bookingRepository.findById(bookingId);
        const clientUserId = booking?.clientId?._id || booking?.clientId;
        if (clientUserId) {
          await recountClientCompletedBookings(clientUserId);
        }
      } catch (err) {
        logger.error(`Error recounting completed bookings on SESSION_COMPLETED: ${err.message}`);
        throw err;
      }
    });

    // 3. A dispute can take a completed booking to cancelled; recount so it stops counting.
    eventBus.on(EVENTS.DISPUTE_RESOLVED, async ({ bookingId }) => {
      try {
        if (!bookingId) return;
        const booking = await bookingRepository.findById(bookingId);
        const clientUserId = booking?.clientId?._id || booking?.clientId;
        if (clientUserId) {
          await recountClientCompletedBookings(clientUserId);
        }
      } catch (err) {
        logger.error(`Error recounting completed bookings on DISPUTE_RESOLVED: ${err.message}`);
      }
    });

    logger.info('Review domain event listeners initialized');
  }
}

export const reviewListener = new ReviewListener();
export default reviewListener;
