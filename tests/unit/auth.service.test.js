import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import bcrypt from 'bcrypt';
import authService from '../../src/modules/auth/auth.service.js';
import authRepository from '../../src/modules/auth/auth.repository.js';

describe('Auth Service OTP Lockout', () => {
  it('invalidates OTP after 5 failed attempts', async () => {
    const hashedOtp = await bcrypt.hash('123456', 10);
    const mockUser = {
      email: 'test@example.com',
      otpCode: hashedOtp,
      otpExpiresAt: new Date(Date.now() + 600000),
      otpAttempts: 4,
      save: jest.fn().mockResolvedValue(true),
    };
    jest.spyOn(authRepository, 'findByEmail').mockResolvedValue(mockUser);

    await expect(authService.verifyEmail({ email: 'test@example.com', otp: '000000' })).rejects.toThrow(
      'Invalid or expired OTP'
    );

    expect(mockUser.otpCode).toBeUndefined();
    expect(mockUser.otpExpiresAt).toBeUndefined();
    expect(mockUser.otpAttempts).toBe(0);
    expect(mockUser.save).toHaveBeenCalled();
  });

  it('invalidates reset password OTP after 5 failed attempts', async () => {
    const hashedOtp = await bcrypt.hash('123456', 10);
    const mockUser = {
      email: 'test@example.com',
      otpCode: hashedOtp,
      otpExpiresAt: new Date(Date.now() + 600000),
      otpAttempts: 4,
      save: jest.fn().mockResolvedValue(true),
    };
    jest.spyOn(authRepository, 'findByEmail').mockResolvedValue(mockUser);

    await expect(
      authService.resetPassword({ email: 'test@example.com', otp: '000000', newPassword: 'NewPassword123!' })
    ).rejects.toThrow('Invalid or expired OTP');

    expect(mockUser.otpCode).toBeUndefined();
    expect(mockUser.otpExpiresAt).toBeUndefined();
    expect(mockUser.otpAttempts).toBe(0);
    expect(mockUser.save).toHaveBeenCalled();
  });
});
