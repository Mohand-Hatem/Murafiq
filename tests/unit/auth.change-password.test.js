import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import authService from '../../src/modules/auth/auth.service.js';
import authRepository from '../../src/modules/auth/auth.repository.js';
import bcrypt from 'bcrypt';

describe('Auth Change Password Hardening', () => {
  it('returns 400 for Google-only account without passwordHash', async () => {
    const mockUser = {
      _id: 'u1',
      email: 'google@example.com',
      passwordHash: null,
    };
    jest.spyOn(authRepository, 'findById').mockResolvedValue(mockUser);

    await expect(
      authService.changePassword('u1', { currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' })
    ).rejects.toThrow(/uses Google Sign-In/i);
  });

  it('invalidates active refresh token upon successful password change', async () => {
    const currentHash = await bcrypt.hash('OldPassword123!', 10);
    const mockUser = {
      _id: 'u1',
      email: 'user@example.com',
      passwordHash: currentHash,
      refreshTokenHash: 'active_session_hash',
      save: jest.fn().mockResolvedValue(true),
    };
    jest.spyOn(authRepository, 'findById').mockResolvedValue(mockUser);

    await authService.changePassword('u1', {
      currentPassword: 'OldPassword123!',
      newPassword: 'NewPassword123!',
    });

    expect(mockUser.refreshTokenHash).toBeUndefined();
    expect(mockUser.save).toHaveBeenCalled();
  });
});
