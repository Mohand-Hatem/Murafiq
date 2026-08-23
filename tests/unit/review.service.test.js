import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import reviewService from '../../src/modules/reviews/review.service.js';
import reviewRepository from '../../src/modules/reviews/review.repository.js';
import bookingRepository from '../../src/modules/bookings/booking.repository.js';
import stylistRepository from '../../src/modules/stylists/stylist.repository.js';
import userRepository from '../../src/modules/users/user.repository.js';
import eventBus from '../../src/common/events/event-bus.js';
import { EVENTS } from '../../src/common/constants/events.constant.js';

describe('Review Service Unit Tests', () => {
  const clientId = '60f719b8f1a2c81234567891';
  const stylistId = '60f719b8f1a2c81234567890';
  const outsiderId = '60f719b8f1a2c81234567899';
  const bookingId = '60f719b8f1a2c81234567888';
  const reviewId = '60f719b8f1a2c81234567877';

  const mockCompletedBooking = {
    _id: bookingId,
    clientId: { _id: clientId, toString: () => clientId },
    stylistId: { _id: stylistId, toString: () => stylistId },
    status: 'completed',
  };

  const mockConfirmedBooking = {
    _id: bookingId,
    clientId: { _id: clientId, toString: () => clientId },
    stylistId: { _id: stylistId, toString: () => stylistId },
    status: 'confirmed',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Two-Way Direction Inference & Validation', () => {
    it('infers client_to_stylist when client submits review for completed booking', async () => {
      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(mockCompletedBooking);
      jest.spyOn(reviewRepository, 'findByBookingAndDirection').mockResolvedValue(null);
      jest.spyOn(reviewRepository, 'create').mockResolvedValue({
        _id: reviewId,
        bookingId,
        raterId: clientId,
        revieweeId: stylistId,
        direction: 'client_to_stylist',
        rating: 5,
        comment: 'Great stylist!',
      });
      jest.spyOn(reviewRepository, 'findById').mockResolvedValue({
        _id: reviewId,
        bookingId,
        raterId: { _id: clientId, name: 'Client' },
        revieweeId: { _id: stylistId, name: 'Stylist' },
        direction: 'client_to_stylist',
        rating: 5,
      });

      const result = await reviewService.createReview({ id: clientId }, bookingId, {
        rating: 5,
        comment: 'Great stylist!',
      });

      expect(result).toBeDefined();
      expect(reviewRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId,
          raterId: clientId,
          revieweeId: stylistId,
          direction: 'client_to_stylist',
          rating: 5,
        })
      );
    });

    it('infers stylist_to_client when stylist submits review for completed booking', async () => {
      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(mockCompletedBooking);
      jest.spyOn(reviewRepository, 'findByBookingAndDirection').mockResolvedValue(null);
      jest.spyOn(reviewRepository, 'create').mockResolvedValue({
        _id: reviewId,
        bookingId,
        raterId: stylistId,
        revieweeId: clientId,
        direction: 'stylist_to_client',
        rating: 5,
        comment: 'Polite client!',
      });
      jest.spyOn(reviewRepository, 'findById').mockResolvedValue({
        _id: reviewId,
        bookingId,
        raterId: { _id: stylistId, name: 'Stylist' },
        revieweeId: { _id: clientId, name: 'Client' },
        direction: 'stylist_to_client',
        rating: 5,
      });

      const result = await reviewService.createReview({ id: stylistId }, bookingId, {
        rating: 5,
        comment: 'Polite client!',
      });

      expect(result).toBeDefined();
      expect(reviewRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId,
          raterId: stylistId,
          revieweeId: clientId,
          direction: 'stylist_to_client',
          rating: 5,
        })
      );
    });

    it('rejects review submission if booking is not completed', async () => {
      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(mockConfirmedBooking);

      await expect(
        reviewService.createReview({ id: clientId }, bookingId, { rating: 5 })
      ).rejects.toThrow('Reviews can only be submitted for completed bookings');
    });

    it('rejects review submission if caller is not a booking participant', async () => {
      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(mockCompletedBooking);

      await expect(
        reviewService.createReview({ id: outsiderId }, bookingId, { rating: 5 })
      ).rejects.toThrow('You are not a participant in this booking');
    });

    it('rejects duplicate review in the same direction with 409 Conflict', async () => {
      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(mockCompletedBooking);
      jest.spyOn(reviewRepository, 'findByBookingAndDirection').mockResolvedValue({ _id: reviewId });

      await expect(
        reviewService.createReview({ id: clientId }, bookingId, { rating: 5 })
      ).rejects.toThrow('You have already submitted a review for this booking');
    });
  });

  describe('Rating Aggregation & Event Listeners', () => {
    it('recalculates StylistProfile rating and totalReviews on client_to_stylist review', async () => {
      jest.spyOn(reviewRepository, 'aggregateRating').mockResolvedValue({
        avgRating: 4.75,
        totalReviews: 8,
      });
      jest.spyOn(stylistRepository, 'updateByUserId').mockResolvedValue({});

      await reviewService.recalculateAverages(stylistId, 'client_to_stylist');

      expect(reviewRepository.aggregateRating).toHaveBeenCalledWith(stylistId, 'client_to_stylist');
      expect(stylistRepository.updateByUserId).toHaveBeenCalledWith(stylistId, {
        rating: 4.75,
        totalReviews: 8,
      });
    });

    it('recalculates User clientRating and clientTotalReviews on stylist_to_client review', async () => {
      jest.spyOn(reviewRepository, 'aggregateRating').mockResolvedValue({
        avgRating: 5.0,
        totalReviews: 3,
      });
      jest.spyOn(userRepository, 'updateById').mockResolvedValue({});

      await reviewService.recalculateAverages(clientId, 'stylist_to_client');

      expect(reviewRepository.aggregateRating).toHaveBeenCalledWith(clientId, 'stylist_to_client');
      expect(userRepository.updateById).toHaveBeenCalledWith(clientId, {
        clientRating: 5.0,
        clientTotalReviews: 3,
      });
    });

    it('hiding a review updates visibility and immediately triggers re-aggregation', async () => {
      const mockReview = {
        _id: reviewId,
        revieweeId: { _id: stylistId },
        direction: 'client_to_stylist',
        isHidden: false,
      };

      jest.spyOn(reviewRepository, 'findById').mockResolvedValue(mockReview);
      jest.spyOn(reviewRepository, 'updateById').mockResolvedValue({ ...mockReview, isHidden: true });
      jest.spyOn(reviewRepository, 'aggregateRating').mockResolvedValue({
        avgRating: 4.5,
        totalReviews: 2,
      });
      jest.spyOn(stylistRepository, 'updateByUserId').mockResolvedValue({});

      const updated = await reviewService.hideReview(reviewId, true);

      expect(updated.isHidden).toBe(true);
      expect(reviewRepository.updateById).toHaveBeenCalledWith(reviewId, { isHidden: true });
      expect(reviewRepository.aggregateRating).toHaveBeenCalledWith(stylistId, 'client_to_stylist');
    });

    it('increments completedSessions and completedBookings on SESSION_COMPLETED event', async () => {
      jest.spyOn(bookingRepository, 'findById').mockResolvedValue(mockCompletedBooking);
      jest.spyOn(stylistRepository, 'updateByUserId').mockResolvedValue({});
      jest.spyOn(userRepository, 'updateById').mockResolvedValue({});

      eventBus.emit(EVENTS.SESSION_COMPLETED, { bookingId });

      // Allow microtask queue to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(stylistRepository.updateByUserId).toHaveBeenCalledWith(stylistId, {
        $inc: { completedSessions: 1 },
      });
      expect(userRepository.updateById).toHaveBeenCalledWith(clientId, {
        $inc: { completedBookings: 1 },
      });
    });
  });
});
