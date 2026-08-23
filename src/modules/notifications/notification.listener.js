import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import notificationService from './notification.service.js';
import requestRepository from '../requests/request.repository.js';
import offerRepository from '../offers/offer.repository.js';
import bookingRepository from '../bookings/booking.repository.js';
import logger from '../../config/logger.config.js';

class NotificationListener {
  constructor() {
    this.registered = false;
  }

  register() {
    if (this.registered) return;
    this.registered = true;

    // 1. Request Created -> Notify Stylist
    eventBus.on(EVENTS.REQUEST_CREATED, async ({ requestId }) => {
      try {
        if (!requestId) return;
        const request = await requestRepository.findById(requestId);
        if (request?.stylistId) {
          const stylistUserId = request.stylistId._id || request.stylistId;
          await notificationService.send(stylistUserId, {
            type: 'request',
            title: 'New Styling Request',
            body: 'You have received a new styling request from a client.',
            relatedEntityId: request._id,
          });
        }
      } catch (err) {
        logger.error(`Notification error on REQUEST_CREATED: ${err.message}`);
      }
    });

    // 2. Offer Created -> Notify Client
    eventBus.on(EVENTS.OFFER_CREATED, async ({ offerId }) => {
      try {
        if (!offerId) return;
        const offer = await offerRepository.findById(offerId);
        if (offer?.clientId) {
          const clientUserId = offer.clientId._id || offer.clientId;
          await notificationService.send(clientUserId, {
            type: 'offer',
            title: 'New Offer Received',
            body: `A stylist has submitted an offer of ${offer.price} EGP for your request.`,
            relatedEntityId: offer._id,
          });
        }
      } catch (err) {
        logger.error(`Notification error on OFFER_CREATED: ${err.message}`);
      }
    });

    // 3. Offer Accepted / Booking Created -> Notify Stylist
    eventBus.on(EVENTS.OFFER_ACCEPTED, async ({ offerId }) => {
      try {
        if (!offerId) return;
        const offer = await offerRepository.findById(offerId);
        if (offer?.stylistId) {
          const stylistUserId = offer.stylistId._id || offer.stylistId;
          await notificationService.send(stylistUserId, {
            type: 'booking',
            title: 'Offer Accepted! Booking Confirmed',
            body: 'Your styling offer was accepted by the client. The session is now scheduled.',
            relatedEntityId: offer.requestId,
          });
        }
      } catch (err) {
        logger.error(`Notification error on OFFER_ACCEPTED: ${err.message}`);
      }
    });

    // 4. Payment Succeeded -> Notify Stylist & Client
    eventBus.on(EVENTS.PAYMENT_SUCCEEDED, async ({ bookingId }) => {
      try {
        if (!bookingId) return;
        const booking = await bookingRepository.findById(bookingId);
        if (booking) {
          const stylistUserId = booking.stylistId?._id || booking.stylistId;
          const clientUserId = booking.clientId?._id || booking.clientId;

          if (stylistUserId) {
            await notificationService.send(stylistUserId, {
              type: 'payment',
              title: 'Payment Secured in Escrow',
              body: 'The client has completed payment. Chat is now open and your session is confirmed.',
              relatedEntityId: booking._id,
            });
          }

          if (clientUserId) {
            await notificationService.send(clientUserId, {
              type: 'payment',
              title: 'Payment Succeeded',
              body: 'Your payment has been secured in escrow. You can now message your stylist.',
              relatedEntityId: booking._id,
            });
          }
        }
      } catch (err) {
        logger.error(`Notification error on PAYMENT_SUCCEEDED: ${err.message}`);
      }
    });

    // 5. Payment Failed -> Notify Client
    eventBus.on(EVENTS.PAYMENT_FAILED, async ({ bookingId }) => {
      try {
        if (!bookingId) return;
        const booking = await bookingRepository.findById(bookingId);
        if (booking?.clientId) {
          const clientUserId = booking.clientId._id || booking.clientId;
          await notificationService.send(clientUserId, {
            type: 'payment',
            title: 'Payment Failed',
            body: 'Your payment attempt was unsuccessful. Please check your payment method and retry.',
            relatedEntityId: booking._id,
          });
        }
      } catch (err) {
        logger.error(`Notification error on PAYMENT_FAILED: ${err.message}`);
      }
    });

    // 6. Payment Refunded -> Notify Client
    eventBus.on(EVENTS.PAYMENT_REFUNDED, async ({ bookingId }) => {
      try {
        if (!bookingId) return;
        const booking = await bookingRepository.findById(bookingId);
        if (booking?.clientId) {
          const clientUserId = booking.clientId._id || booking.clientId;
          await notificationService.send(clientUserId, {
            type: 'payment',
            title: 'Refund Processed',
            body: 'A refund has been processed for your booking in accordance with the cancellation policy.',
            relatedEntityId: booking._id,
          });
        }
      } catch (err) {
        logger.error(`Notification error on PAYMENT_REFUNDED: ${err.message}`);
      }
    });

    // 7. Session Completed -> Prompt Review & Notify Payout
    eventBus.on(EVENTS.SESSION_COMPLETED, async ({ bookingId }) => {
      try {
        if (!bookingId) return;
        const booking = await bookingRepository.findById(bookingId);
        if (booking) {
          const clientUserId = booking.clientId?._id || booking.clientId;
          const stylistUserId = booking.stylistId?._id || booking.stylistId;

          if (clientUserId) {
            await notificationService.send(clientUserId, {
              type: 'review',
              title: 'Styling Session Completed',
              body: 'Your styling session is finished! Please rate your experience and leave a review.',
              relatedEntityId: booking._id,
            });
          }

          if (stylistUserId) {
            await notificationService.send(stylistUserId, {
              type: 'payout',
              title: 'Session Completed',
              body: 'Session completed successfully. Your earnings are now eligible for payout.',
              relatedEntityId: booking._id,
            });
          }
        }
      } catch (err) {
        logger.error(`Notification error on SESSION_COMPLETED: ${err.message}`);
      }
    });

    // 8. Booking Cancelled -> Notify Participants
    eventBus.on(EVENTS.BOOKING_CANCELLED, async ({ bookingId }) => {
      try {
        if (!bookingId) return;
        const booking = await bookingRepository.findById(bookingId);
        if (booking) {
          const clientUserId = booking.clientId?._id || booking.clientId;
          const stylistUserId = booking.stylistId?._id || booking.stylistId;

          if (clientUserId) {
            await notificationService.send(clientUserId, {
              type: 'booking',
              title: 'Booking Cancelled',
              body: 'Your scheduled booking has been cancelled.',
              relatedEntityId: booking._id,
            });
          }

          if (stylistUserId) {
            await notificationService.send(stylistUserId, {
              type: 'booking',
              title: 'Booking Cancelled',
              body: 'A scheduled booking has been cancelled.',
              relatedEntityId: booking._id,
            });
          }
        }
      } catch (err) {
        logger.error(`Notification error on BOOKING_CANCELLED: ${err.message}`);
      }
    });

    // 9. Chat Message Sent -> Notify Offline Participants
    eventBus.on(EVENTS.CHAT_MESSAGE_SENT, async ({ bookingId, senderId, participants, message }) => {
      try {
        if (!participants || !Array.isArray(participants)) return;
        const recipients = participants.filter((p) => String(p) !== String(senderId));

        for (const recipientId of recipients) {
          await notificationService.send(recipientId, {
            type: 'message',
            title: 'New Message',
            body: message.type === 'image' ? 'Sent an image' : message.content,
            relatedEntityId: bookingId || null,
          });
        }
      } catch (err) {
        logger.error(`Notification error on CHAT_MESSAGE_SENT: ${err.message}`);
      }
    });

    // 10. User Verified -> Notify User
    eventBus.on(EVENTS.USER_VERIFIED, async ({ userId }) => {
      try {
        if (!userId) return;
        await notificationService.send(userId, {
          type: 'verification',
          title: 'Identity Verification Approved',
          body: 'Your identity documents have been verified! You now have full access to all features.',
          relatedEntityId: userId,
        });
      } catch (err) {
        logger.error(`Notification error on USER_VERIFIED: ${err.message}`);
      }
    });

    // 11. User Verification Rejected -> Notify User
    eventBus.on(EVENTS.USER_VERIFICATION_REJECTED, async ({ userId, rejectionReason }) => {
      try {
        if (!userId) return;
        await notificationService.send(userId, {
          type: 'verification',
          title: 'Verification Action Required',
          body: rejectionReason
            ? `Your verification could not be approved: ${rejectionReason}. Please update your documents.`
            : 'Your verification could not be approved. Please review requirements and re-upload.',
          relatedEntityId: userId,
        });
      } catch (err) {
        logger.error(`Notification error on USER_VERIFICATION_REJECTED: ${err.message}`);
      }
    });

    logger.info('Notification domain event listeners initialized');
  }
}

export const notificationListener = new NotificationListener();
export default notificationListener;
