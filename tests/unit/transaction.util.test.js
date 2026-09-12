import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { withTransaction } from '../../src/common/transaction.util.js';

describe('withTransaction', () => {
  it('passes the session to the callback and returns its value', async () => {
    const fakeSession = {
      withTransaction: jest.fn(async (fn) => fn()),
      endSession: jest.fn(async () => {}),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(fakeSession);

    const result = await withTransaction(async (session) => {
      expect(session).toBe(fakeSession);
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(fakeSession.endSession).toHaveBeenCalledTimes(1);
    mongoose.startSession.mockRestore();
  });

  it('ends the session even when the callback throws', async () => {
    const fakeSession = {
      withTransaction: jest.fn(async (fn) => fn()),
      endSession: jest.fn(async () => {}),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(fakeSession);

    await expect(withTransaction(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(fakeSession.endSession).toHaveBeenCalledTimes(1);
    mongoose.startSession.mockRestore();
  });

  it('runs callback with null session when disconnected and not mocked', async () => {
    const result = await withTransaction(async (session) => {
      expect(session).toBeNull();
      return 'fallback';
    });
    expect(result).toBe('fallback');
  });
});
