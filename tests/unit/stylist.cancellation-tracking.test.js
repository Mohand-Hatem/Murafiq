import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import eventBus from '../../src/common/events/event-bus.js';
import { EVENTS } from '../../src/common/constants/events.constant.js';
import stylistListener from '../../src/modules/stylists/stylist.listener.js';
import stylistRepository from '../../src/modules/stylists/stylist.repository.js';

describe('Stylist Cancellation Tracking Listener', () => {
  const stylistId = '60f719b8f1a2c81234567890';

  beforeAll(() => {
    stylistListener.register();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('increments cancelledSessions when booking is cancelled by stylist', async () => {
    jest.spyOn(stylistRepository, 'updateByUserId').mockResolvedValue({
      _id: 'p1',
      cancelledSessions: 1,
    });

    eventBus.emit(EVENTS.BOOKING_CANCELLED, {
      bookingId: 'b1',
      cancelledBy: 'stylist',
      stylistId,
    });

    // Wait for microtask processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(stylistRepository.updateByUserId).toHaveBeenCalledWith(stylistId, {
      $inc: { cancelledSessions: 1 },
    });
  });

  it('does not increment cancelledSessions when booking is cancelled by client', async () => {
    jest.spyOn(stylistRepository, 'updateByUserId').mockResolvedValue({});

    eventBus.emit(EVENTS.BOOKING_CANCELLED, {
      bookingId: 'b1',
      cancelledBy: 'client',
      stylistId,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(stylistRepository.updateByUserId).not.toHaveBeenCalled();
  });
});
