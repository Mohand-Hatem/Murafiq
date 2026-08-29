import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import reviewService from './review.service.js';
import bookingRepository from '../bookings/booking.repository.js';
import stylistRepository from '../stylists/stylist.repository.js';
import userRepository from '../users/user.repository.js';
import logger from '../../config/logger.config.js';

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

    // 2. Increment completed sessions counter on mutual completion
    eventBus.on(EVENTS.SESSION_COMPLETED, async ({ bookingId }) => {
      try {
        if (!bookingId) return;
        const booking = await bookingRepository.findById(bookingId);
        if (booking) {
          const stylistUserId = booking.stylistId?._id || booking.stylistId;
          const clientUserId = booking.clientId?._id || booking.clientId;

          if (stylistUserId) {
            await stylistRepository.updateByUserId(stylistUserId, {
              $inc: { completedSessions: 1 },
            });
          }

          if (clientUserId) {
            await userRepository.updateById(clientUserId, {
              $inc: { completedBookings: 1 },
            });
          }
          logger.info(`Incremented completed session counters for booking ${bookingId}`);
        }
      } catch (err) {
        logger.error(`Error incrementing session completed counters: ${err.message}`);
      }
    });

    logger.info('Review domain event listeners initialized');
  }
}

export const reviewListener = new ReviewListener();
export default reviewListener;
