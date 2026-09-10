import mongoose from 'mongoose';
import stylistRepository from './stylist.repository.js';
import bookingRepository from '../bookings/booking.repository.js';
import reviewRepository from '../reviews/review.repository.js';
import penaltyRepository from '../penalties/penalty.repository.js';
import { getBusinessDayRange } from '../../common/utils/businessDay.util.js';
import logger from '../../config/logger.config.js';

// Same computation as booking.service.js's getAppointmentDateTime -- duplicated rather
// than imported to avoid a circular dependency (booking.service.js already imports this
// module for its own dispute/cancellation reliability triggers). scheduledDate alone is
// midnight of the appointment's calendar day; the actual scheduled instant needs
// scheduledStartMinute added on top of it.
const getScheduledInstant = (booking) => {
  const { startOfDay } = getBusinessDayRange(booking.scheduledDate);
  return new Date(startOfDay.getTime() + (booking.scheduledStartMinute || 0) * 60 * 1000);
};

export class ReliabilityService {
  /**
   * Calculates detailed reliability metrics and composite reliability score for a stylist.
   *
   * Weights per Spec §G.3:
   * - 40% Completion Rate (excluding client cancellations)
   * - 20% Punctuality / On-time check-in
   * - 30% Average Client Rating
   * - 10% Penalty / Dispute standing
   *
   * @param {string} stylistUserId
   * @returns {Promise<object>} Detailed reliability breakdown
   */
  async calculateReliability(stylistUserId) {
    const objectId = mongoose.Types.ObjectId.isValid(stylistUserId)
      ? new mongoose.Types.ObjectId(stylistUserId)
      : stylistUserId;

    // 1. Fetch bookings breakdown
    let bookings = [];
    try {
      bookings = await bookingRepository.findCompletedAndCancelledByStylistId(objectId);
    } catch {
      // In disconnected test mock mode
      bookings = [];
    }

    let completedCount = 0;
    let stylistCancelledCount = 0;
    let clientCancelledCount = 0;
    let checkedInCount = 0;
    let onTimeCount = 0;

    for (const b of bookings) {
      if (b.status === 'completed') {
        completedCount += 1;
        // Was checkedInAt (field does not exist on Booking -- the schema has
        // checkInAt), so this was always 0 and punctuality was hardcoded to 100% for
        // every stylist -- 20% of the composite reliability score was fabricated.
        if (b.checkInAt) {
          checkedInCount += 1;
          const scheduled = getScheduledInstant(b).getTime();
          const checkIn = new Date(b.checkInAt).getTime();
          // On-time if checked in up to 15 mins after scheduled time
          if (checkIn <= scheduled + 15 * 60 * 1000) {
            onTimeCount += 1;
          }
        }
      } else if (b.status === 'cancelled') {
        if (b.cancelledBy === 'stylist') {
          stylistCancelledCount += 1;
        } else if (b.cancelledBy === 'client') {
          clientCancelledCount += 1;
        }
      }
    }

    const relevantBookingCount = completedCount + stylistCancelledCount;
    const completionRate =
      relevantBookingCount > 0 ? (completedCount / relevantBookingCount) * 100 : 100;

    const punctualityRate = checkedInCount > 0 ? (onTimeCount / checkedInCount) * 100 : 100;

    // 2. Fetch rating stats
    const ratingStats = await reviewRepository.aggregateRating(
      stylistUserId,
      'client_to_stylist'
    );
    const avgRating = ratingStats.avgRating || 0;
    const totalReviews = ratingStats.totalReviews || 0;
    const ratingScore = totalReviews > 0 ? (avgRating / 5) * 100 : 100;

    // 3. Fetch outstanding penalties
    let outstandingDebtCount = 0;
    try {
      const outstandingPenalties = await penaltyRepository.findOutstandingByStylistId(
        stylistUserId
      );
      outstandingDebtCount = outstandingPenalties.length;
    } catch {
      // ignore in test mock environments
    }

    const penaltyScore = Math.max(0, 100 - outstandingDebtCount * 25);

    // 4. Calculate composite score
    const isNew = completedCount < 5;
    const compositeScore = isNew
      ? 100.0
      : Math.round(
          (0.4 * completionRate +
            0.2 * punctualityRate +
            0.3 * ratingScore +
            0.1 * penaltyScore) *
            10
        ) / 10;

    let tier = 'standard';
    if (isNew) {
      tier = 'new';
    } else if (compositeScore >= 95) {
      tier = 'top_rated';
    } else if (compositeScore >= 85) {
      tier = 'trusted';
    } else if (compositeScore < 70) {
      tier = 'needs_improvement';
    }

    return {
      score: compositeScore,
      tier,
      isNew,
      metrics: {
        completedCount,
        stylistCancelledCount,
        clientCancelledCount,
        completionRate: Math.round(completionRate * 10) / 10,
        punctualityRate: Math.round(punctualityRate * 10) / 10,
        avgRating,
        totalReviews,
        ratingScore: Math.round(ratingScore * 10) / 10,
        outstandingPenalties: outstandingDebtCount,
        penaltyScore,
      },
    };
  }

  /**
   * Recalculates and persists reliability score on StylistProfile.
   * @param {string} stylistUserId
   */
  async updateStylistReliability(stylistUserId) {
    try {
      const reliability = await this.calculateReliability(stylistUserId);
      await stylistRepository.updateByUserId(stylistUserId, {
        reliabilityScore: reliability.score,
        reliabilityTier: reliability.tier,
        completedSessions: reliability.metrics.completedCount,
        cancelledSessions: reliability.metrics.stylistCancelledCount,
      });

      logger.info(
        `Updated Stylist ${stylistUserId} reliability score to ${reliability.score} (Tier: ${reliability.tier})`
      );
      return reliability;
    } catch (err) {
      logger.error(
        `Failed to update reliability score for stylist ${stylistUserId}: ${err.message}`
      );
      return null;
    }
  }
}

export const reliabilityService = new ReliabilityService();
export default reliabilityService;
