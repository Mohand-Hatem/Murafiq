import reviewRepository from './review.repository.js';
import bookingRepository from '../bookings/booking.repository.js';
import stylistRepository from '../stylists/stylist.repository.js';
import userRepository from '../users/user.repository.js';
import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import logger from '../../config/logger.config.js';

class ReviewService {
  constructor() {
    this._registerEventListeners();
  }

  /**
   * Submit a two-way review for a completed booking
   */
  async createReview(callerUser, bookingId, { rating, comment }) {
    const booking = await bookingRepository.findById(bookingId);
    if (!booking) {
      throw new ApiError(404, 'Booking not found');
    }

    if (booking.status !== 'completed') {
      throw new ApiError(400, 'Reviews can only be submitted for completed bookings');
    }

    const callerId = String(callerUser._id || callerUser.id);
    const bookingClientId = String(booking.clientId._id || booking.clientId);
    const bookingStylistId = String(booking.stylistId._id || booking.stylistId);

    let direction;
    let revieweeId;

    if (callerId === bookingClientId) {
      direction = 'client_to_stylist';
      revieweeId = bookingStylistId;
    } else if (callerId === bookingStylistId) {
      direction = 'stylist_to_client';
      revieweeId = bookingClientId;
    } else {
      throw new ApiError(403, 'You are not a participant in this booking');
    }

    // Check for duplicate review in this direction
    const existing = await reviewRepository.findByBookingAndDirection(bookingId, direction);
    if (existing) {
      throw new ApiError(409, 'You have already submitted a review for this booking');
    }

    const numRating = Number(rating);
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
      throw new ApiError(400, 'Rating must be an integer between 1 and 5');
    }

    const review = await reviewRepository.create({
      bookingId: booking._id,
      raterId: callerId,
      revieweeId,
      direction,
      rating: numRating,
      comment: comment ? comment.trim() : undefined,
    });

    eventBus.emit(EVENTS.REVIEW_SUBMITTED, {
      reviewId: review._id,
      raterId: callerId,
      revieweeId,
      direction,
      rating: review.rating,
      bookingId: booking._id,
    });

    return reviewRepository.findById(review._id);
  }

  /**
   * Get public reviews for a stylist
   */
  async getStylistReviews(stylistProfileIdOrUserId, queryString = {}) {
    let stylistUserId = stylistProfileIdOrUserId;

    // Check if passed string is a StylistProfile ID
    const profile = await stylistRepository.findById(stylistProfileIdOrUserId);
    if (profile && profile.userId) {
      stylistUserId = profile.userId._id || profile.userId;
    }

    return reviewRepository.findStylistReviews(stylistUserId, queryString);
  }

  /**
   * Get reviews submitted by the authenticated user
   */
  async getMyReviews(userId, queryString = {}) {
    return reviewRepository.findUserReviews(userId, queryString);
  }

  /**
   * Admin moderation: hide or unhide a review and recalculate rating averages
   */
  async hideReview(reviewId, isHidden = true) {
    const review = await reviewRepository.findById(reviewId);
    if (!review) {
      throw new ApiError(404, 'Review not found');
    }

    const updated = await reviewRepository.updateById(reviewId, { isHidden });
    const targetUserId = review.revieweeId._id || review.revieweeId;

    await this.recalculateAverages(targetUserId, review.direction);

    return updated;
  }

  /**
   * Recalculate rolling rating averages from source aggregation
   */
  async recalculateAverages(revieweeId, direction) {
    try {
      const { avgRating, totalReviews } = await reviewRepository.aggregateRating(
        revieweeId,
        direction
      );

      if (direction === 'client_to_stylist') {
        await stylistRepository.updateByUserId(revieweeId, {
          rating: avgRating,
          totalReviews,
        });
        logger.info(`Updated Stylist ${revieweeId} rating to ${avgRating} (${totalReviews} reviews)`);
      } else if (direction === 'stylist_to_client') {
        await userRepository.updateById(revieweeId, {
          clientRating: avgRating,
          clientTotalReviews: totalReviews,
        });
        logger.info(`Updated Client ${revieweeId} rating to ${avgRating} (${totalReviews} reviews)`);
      }
    } catch (err) {
      logger.error(`Failed to recalculate rating averages for ${revieweeId}: ${err.message}`);
    }
  }

  /**
   * Register domain event listeners
   */
  _registerEventListeners() {
    // 1. Recalculate averages when a new review is submitted
    eventBus.on(EVENTS.REVIEW_SUBMITTED, async ({ revieweeId, direction }) => {
      if (revieweeId && direction) {
        await this.recalculateAverages(revieweeId, direction);
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
  }
}

export const reviewService = new ReviewService();
export default reviewService;
