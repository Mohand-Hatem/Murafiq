import eventBus from '../../common/events/event-bus.js';
import { EVENTS } from '../../common/constants/events.constant.js';
import stylistRepository from './stylist.repository.js';
import logger from '../../config/logger.config.js';

class StylistListener {
  constructor() {
    this.registered = false;
  }

  register() {
    if (this.registered) return;
    this.registered = true;

    eventBus.on(EVENTS.USER_LOCATION_UPDATED, async (payload) => {
      try {
        const { userId, location, country, governorate, city, area } = payload;
        const profile = await stylistRepository.findByUserId(userId);
        if (profile) {
          const isRealLocation =
            location?.coordinates &&
            Array.isArray(location.coordinates) &&
            (location.coordinates[0] !== 0 || location.coordinates[1] !== 0);

          await stylistRepository.updateByUserId(userId, {
            country: country || null,
            governorate: governorate || null,
            city: city || null,
            area: area || null,
            location: location || { type: 'Point', coordinates: [0, 0] },
            locationSet: isRealLocation,
          });
        }
      } catch (err) {
        logger.error(`Error handling USER_LOCATION_UPDATED event in stylists service: ${err.message}`);
      }
    });

    eventBus.on(EVENTS.BOOKING_CANCELLED, async ({ cancelledBy, stylistId }) => {
      try {
        if (cancelledBy === 'stylist' && stylistId) {
          const updated = await stylistRepository.updateByUserId(stylistId, {
            $inc: { cancelledSessions: 1 },
          });
          if (updated && updated.cancelledSessions >= 3) {
            logger.warn(
              `[ADMIN_ALERT] Stylist ${stylistId} has accumulated ${updated.cancelledSessions} cancellations.`
            );
          }
        }
      } catch (err) {
        logger.error(`Error incrementing stylist cancellation counter: ${err.message}`);
      }
    });

    logger.info('Stylist domain event listeners initialized');
  }
}

export const stylistListener = new StylistListener();
export default stylistListener;
