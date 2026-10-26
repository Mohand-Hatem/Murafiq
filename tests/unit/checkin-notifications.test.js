import { describe, it, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import '../../src/common/globals.js';
import eventBus from '../../src/common/events/event-bus.js';
import { EVENTS } from '../../src/common/constants/events.constant.js';
import notificationListener from '../../src/modules/notifications/notification.listener.js';
import notificationService from '../../src/modules/notifications/notification.service.js';

const bookingId = '60f719b8f1a2c81234567893';
const clientId = '60f719b8f1a2c81234567891';
const stylistId = '60f719b8f1a2c81234567892';

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('CHECK_IN_COMPLETED notifications', () => {
  let send;

  beforeAll(() => {
    notificationListener.register();
  });

  beforeEach(() => {
    send = jest.spyOn(notificationService, 'send').mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('tells only the client when the stylist checks in first', async () => {
    eventBus.emit(EVENTS.CHECK_IN_COMPLETED, {
      bookingId,
      clientId,
      stylistId,
      checkedInBy: 'stylist',
      sessionStarted: false,
    });
    await flush();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      clientId,
      expect.objectContaining({ body: expect.stringMatching(/stylist has checked in and is waiting/i) })
    );
  });

  it('tells only the stylist when the client checks in first', async () => {
    eventBus.emit(EVENTS.CHECK_IN_COMPLETED, {
      bookingId,
      clientId,
      stylistId,
      checkedInBy: 'client',
      sessionStarted: false,
    });
    await flush();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      stylistId,
      expect.objectContaining({ body: expect.stringMatching(/client has checked in and is waiting/i) })
    );
  });

  it('tells both parties when the session starts', async () => {
    eventBus.emit(EVENTS.CHECK_IN_COMPLETED, {
      bookingId,
      clientId,
      stylistId,
      checkedInBy: 'client',
      sessionStarted: true,
    });
    await flush();

    expect(send).toHaveBeenCalledTimes(2);
    for (const recipient of [clientId, stylistId]) {
      expect(send).toHaveBeenCalledWith(
        recipient,
        expect.objectContaining({ body: expect.stringMatching(/in progress/i) })
      );
    }
  });
});
