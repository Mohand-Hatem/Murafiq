import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import bcrypt from 'bcrypt';
import authService from '../../src/modules/auth/auth.service.js';
import authRepository from '../../src/modules/auth/auth.repository.js';
import logger from '../../src/config/logger.config.js';
import { ACCOUNT_STATUS } from '../../src/common/constants/statuses.constant.js';

describe('Auth Service Login Failure Telemetry (OBS-05)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs user_not_found on non-existent user email', async () => {
    jest.spyOn(authRepository, 'findByEmail').mockResolvedValue(null);

    await expect(authService.login({ email: 'unknown@example.com', password: 'Password123!' }))
      .rejects.toThrow('Invalid credentials');

    expect(logger.warn).toHaveBeenCalledWith('Authentication failure', {
      event: 'AUTH_LOGIN_FAILED',
      reason: 'user_not_found',
      userId: null,
    });
  });

  it('logs account_suspended on suspended user', async () => {
    const mockUser = {
      _id: { toString: () => 'user123' },
      accountStatus: ACCOUNT_STATUS.SUSPENDED,
      isEmailVerified: true,
      passwordHash: 'hash',
    };
    jest.spyOn(authRepository, 'findByEmail').mockResolvedValue(mockUser);

    await expect(authService.login({ email: 'suspended@example.com', password: 'Password123!' }))
      .rejects.toThrow('Account suspended. Contact support.');

    expect(logger.warn).toHaveBeenCalledWith('Authentication failure', {
      event: 'AUTH_LOGIN_FAILED',
      reason: 'account_suspended',
      userId: 'user123',
    });
  });

  it('logs account_blocked on blocked user', async () => {
    const mockUser = {
      _id: { toString: () => 'user456' },
      accountStatus: ACCOUNT_STATUS.BLOCKED,
      isEmailVerified: true,
      passwordHash: 'hash',
    };
    jest.spyOn(authRepository, 'findByEmail').mockResolvedValue(mockUser);

    await expect(authService.login({ email: 'blocked@example.com', password: 'Password123!' }))
      .rejects.toThrow('Account blocked. Contact support.');

    expect(logger.warn).toHaveBeenCalledWith('Authentication failure', {
      event: 'AUTH_LOGIN_FAILED',
      reason: 'account_blocked',
      userId: 'user456',
    });
  });

  it('logs email_unverified on unverified email', async () => {
    const mockUser = {
      _id: { toString: () => 'user789' },
      accountStatus: ACCOUNT_STATUS.ACTIVE,
      isEmailVerified: false,
      passwordHash: 'hash',
    };
    jest.spyOn(authRepository, 'findByEmail').mockResolvedValue(mockUser);

    await expect(authService.login({ email: 'unverified@example.com', password: 'Password123!' }))
      .rejects.toThrow('Account not verified. Please check your email.');

    expect(logger.warn).toHaveBeenCalledWith('Authentication failure', {
      event: 'AUTH_LOGIN_FAILED',
      reason: 'email_unverified',
      userId: 'user789',
    });
  });

  it('logs social_account_password_attempt when passwordHash is missing', async () => {
    const mockUser = {
      _id: { toString: () => 'user_social' },
      accountStatus: ACCOUNT_STATUS.ACTIVE,
      isEmailVerified: true,
      passwordHash: null,
    };
    jest.spyOn(authRepository, 'findByEmail').mockResolvedValue(mockUser);

    await expect(authService.login({ email: 'social@example.com', password: 'Password123!' }))
      .rejects.toThrow('This account uses Google Sign-In');

    expect(logger.warn).toHaveBeenCalledWith('Authentication failure', {
      event: 'AUTH_LOGIN_FAILED',
      reason: 'social_account_password_attempt',
      userId: 'user_social',
    });
  });

  it('logs invalid_password when password does not match hash', async () => {
    const mockUser = {
      _id: { toString: () => 'user_wrong_pw' },
      accountStatus: ACCOUNT_STATUS.ACTIVE,
      isEmailVerified: true,
      passwordHash: 'hashed_pw',
    };
    jest.spyOn(authRepository, 'findByEmail').mockResolvedValue(mockUser);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);

    await expect(authService.login({ email: 'user@example.com', password: 'WrongPassword!' }))
      .rejects.toThrow('Invalid credentials');

    expect(logger.warn).toHaveBeenCalledWith('Authentication failure', {
      event: 'AUTH_LOGIN_FAILED',
      reason: 'invalid_password',
      userId: 'user_wrong_pw',
    });
  });
});
