import { jest } from '@jest/globals';
import { safeListener } from '../../../../src/common/events/safeListener.js';
import { logger } from '../../../../src/config/logger.config.js';

describe('safeListener', () => {
  let loggerErrorSpy;

  beforeEach(() => {
    loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  it('should successfully execute the wrapped async handler', async () => {
    const mockHandler = jest.fn().mockResolvedValue('success');
    const wrapped = safeListener('test.action', mockHandler);

    await wrapped({ foo: 'bar' });

    expect(mockHandler).toHaveBeenCalledTimes(1);
    expect(mockHandler).toHaveBeenCalledWith({ foo: 'bar' });
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it('should catch error, log via logger.error, and not throw or reject', async () => {
    const error = new Error('Database connection timed out');
    const mockHandler = jest.fn().mockRejectedValue(error);
    const wrapped = safeListener('test.failing_action', mockHandler);

    await expect(wrapped({ id: '123' })).resolves.toBeUndefined();

    expect(mockHandler).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "[EventBus] Error in listener 'test.failing_action':",
      expect.objectContaining({
        error: 'Database connection timed out',
        args: [{ id: '123' }],
      })
    );
  });
});
