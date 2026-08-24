import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import chatService from './chat.service.js';
import logger from '../../config/logger.config.js';

class ChatListener {
  constructor() {
    this.registered = false;
  }

  register() {
    if (this.registered) return;
    this.registered = true;

    eventBus.on(EVENTS.PAYMENT_SUCCEEDED, async (payload) => {
      try {
        if (payload?.bookingId) {
          await chatService.openConversation(payload.bookingId);
        }
      } catch (err) {
        logger.error(`Error opening conversation on PAYMENT_SUCCEEDED: ${err.message}`);
      }
    });

    eventBus.on(EVENTS.SESSION_COMPLETED, async (payload) => {
      try {
        if (payload?.bookingId) {
          await chatService.lockConversation(payload.bookingId);
        }
      } catch (err) {
        logger.error(`Error locking conversation on SESSION_COMPLETED: ${err.message}`);
      }
    });

    eventBus.on(EVENTS.BOOKING_CANCELLED, async (payload) => {
      try {
        if (payload?.bookingId) {
          await chatService.lockConversation(payload.bookingId);
        }
      } catch (err) {
        logger.error(`Error locking conversation on BOOKING_CANCELLED: ${err.message}`);
      }
    });

    logger.info('Chat domain event listeners initialized');
  }
}

export const chatListener = new ChatListener();
export default chatListener;
