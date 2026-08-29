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

  it('revokes every session and bumps tokenVersion on a successful password change', async () => {
    const currentHash = await bcrypt.hash('OldPassword123!', 10);
    const mockUser = {
      _id: 'u1',
      email: 'user@example.com',
      passwordHash: currentHash,
      save: jest.fn().mockResolvedValue(true),
    };
    jest.spyOn(authRepository, 'findById').mockResolvedValue(mockUser);

    const User = (await import('../../src/modules/users/user.model.js')).default;
    const updateSpy = jest.spyOn(User, 'updateOne').mockResolvedValue({ modifiedCount: 1 });

    await authService.changePassword('u1', {
      currentPassword: 'OldPassword123!',
      newPassword: 'NewPassword123!',
    });

    expect(mockUser.save).toHaveBeenCalled();
    // Clearing sessions alone is not enough — the attacker's outstanding ACCESS token
    // would survive its remaining window. tokenVersion is what kills it now.
    expect(updateSpy).toHaveBeenCalledWith(
      { _id: 'u1' },
      expect.objectContaining({
        $set: { sessions: [] },
        $inc: { tokenVersion: 1 },
      })
    );
    updateSpy.mockRestore();
  });
});
