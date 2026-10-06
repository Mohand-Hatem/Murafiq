import { jest } from '@jest/globals';
import eventBus from '../../../../src/common/events/event-bus.js';
import { EVENTS } from '../../../../src/common/constants/events.constant.js';
import auditLogService from '../../../../src/modules/audit-log/audit-log.service.js';
import auditLogListener from '../../../../src/modules/audit-log/audit-log.listener.js';
import { logger } from '../../../../src/config/logger.config.js';

describe('audit-log.listener with safeListener', () => {
  let recordActionSpy;
  let loggerErrorSpy;

  beforeAll(() => {
    auditLogListener.register();
  });

  beforeEach(() => {
    loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (recordActionSpy) recordActionSpy.mockRestore();
    loggerErrorSpy.mockRestore();
  });

  it('should safely catch audit logging rejection and log error without throwing', async () => {
    recordActionSpy = jest.spyOn(auditLogService, 'recordAction').mockRejectedValue(
      new Error('Mongo connection error during audit write')
    );

    // Emitting the event should not cause an unhandled rejection
    expect(() => {
      eventBus.emit(EVENTS.USER_VERIFIED, {
        reviewedBy: 'admin-1',
        userId: 'user-1',
      });
    }).not.toThrow();

    // Allow promise tick in event loop
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(recordActionSpy).toHaveBeenCalled();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "[EventBus] Error in listener 'audit.user_verified':",
      expect.objectContaining({
        error: 'Mongo connection error during audit write',
      })
    );
  });
});
