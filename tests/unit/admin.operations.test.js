import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import userService from '../../src/modules/users/user.service.js';
import userRepository from '../../src/modules/users/user.repository.js';
import moderationService from '../../src/modules/moderation/moderation.service.js';
import moderationEventRepository from '../../src/modules/moderation/moderation-event.repository.js';

describe('Admin & Operations Controls (Unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('User Restrictions & Session Revocation', () => {
    it('restricts user with chat timeout and increments tokenVersion', async () => {
      const mockUser = {
        _id: 'user123',
        name: 'Violating User',
        email: 'violator@example.com',
        role: 'client',
        accountStatus: 'active',
        tokenVersion: 1,
      };

      jest.spyOn(userRepository, 'findById').mockResolvedValue(mockUser);
      jest.spyOn(userRepository, 'updateById').mockResolvedValue({
        ...mockUser,
        accountStatus: 'restricted',
        tokenVersion: 2,
        chatRestrictedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const res = await userService.restrictUser('user123', 'admin456', { durationDays: 7 });

      expect(userRepository.updateById).toHaveBeenCalledWith(
        'user123',
        expect.objectContaining({
          accountStatus: 'restricted',
          $inc: { tokenVersion: 1 },
        })
      );
      expect(res.accountStatus).toBe('restricted');
    });

    it('unrestricts user and clears chat restriction', async () => {
      const mockUser = {
        _id: 'user123',
        accountStatus: 'restricted',
        chatRestrictedUntil: new Date(),
      };

      jest.spyOn(userRepository, 'findById').mockResolvedValue(mockUser);
      jest.spyOn(userRepository, 'updateById').mockResolvedValue({
        ...mockUser,
        accountStatus: 'active',
        chatRestrictedUntil: null,
      });

      const res = await userService.unrestrictUser('user123', 'admin456');

      expect(userRepository.updateById).toHaveBeenCalledWith(
        'user123',
        expect.objectContaining({
          accountStatus: 'active',
          chatRestrictedUntil: null,
          $inc: { tokenVersion: 1 },
        })
      );
      expect(res.accountStatus).toBe('active');
    });

    it('revokes user sessions by bumping tokenVersion and clearing sessions[]', async () => {
      const mockUser = {
        _id: 'user123',
        accountStatus: 'active',
        tokenVersion: 2,
      };

      jest.spyOn(userRepository, 'findById').mockResolvedValue(mockUser);
      jest.spyOn(userRepository, 'updateById').mockResolvedValue({
        ...mockUser,
        tokenVersion: 3,
      });

      await userService.revokeUserSessions('user123', 'admin456');

      expect(userRepository.updateById).toHaveBeenCalledWith(
        'user123',
        expect.objectContaining({
          sessions: [],
          $inc: { tokenVersion: 1 },
        })
      );
    });

    it('blocks user, clears refresh token, increments tokenVersion and sets status to blocked', async () => {
      const mockUser = {
        _id: 'user123',
        accountStatus: 'active',
        tokenVersion: 1,
      };

      jest.spyOn(userRepository, 'findById').mockResolvedValue(mockUser);
      jest.spyOn(userRepository, 'updateById').mockResolvedValue({
        ...mockUser,
        accountStatus: 'blocked',
        tokenVersion: 2,
        sessions: [],
      });

      const res = await userService.blockUser('user123', 'admin456', 'Serious policy violation');

      expect(userRepository.updateById).toHaveBeenCalledWith(
        'user123',
        expect.objectContaining({
          accountStatus: 'blocked',
          sessions: [],
          $inc: { tokenVersion: 1 },
        })
      );
      expect(res.accountStatus).toBe('blocked');
    });

    it('unblocks user and restores active status', async () => {
      const mockUser = {
        _id: 'user123',
        accountStatus: 'blocked',
      };

      jest.spyOn(userRepository, 'findById').mockResolvedValue(mockUser);
      jest.spyOn(userRepository, 'updateById').mockResolvedValue({
        ...mockUser,
        accountStatus: 'active',
      });

      const res = await userService.unblockUser('user123', 'admin456', 'Appeal granted');

      expect(userRepository.updateById).toHaveBeenCalledWith(
        'user123',
        expect.objectContaining({
          accountStatus: 'active',
        })
      );
      expect(res.accountStatus).toBe('active');
    });
  });

  describe('Moderation Event Review Actions', () => {
    it('confirms a moderation event with reviewer notes', async () => {
      const mockEvent = {
        _id: 'event123',
        reviewOutcome: 'PENDING',
      };

      jest.spyOn(moderationEventRepository, 'findById').mockResolvedValue(mockEvent);
      jest.spyOn(moderationEventRepository, 'updateById').mockResolvedValue({
        ...mockEvent,
        reviewOutcome: 'CONFIRMED',
        reviewedBy: 'operator789',
        reviewNotes: 'Phone number confirmed',
      });

      const res = await moderationService.confirmEvent('event123', 'operator789', 'Phone number confirmed');

      expect(moderationEventRepository.updateById).toHaveBeenCalledWith(
        'event123',
        expect.objectContaining({
          reviewOutcome: 'CONFIRMED',
          reviewedBy: 'operator789',
          reviewNotes: 'Phone number confirmed',
        })
      );
      expect(res.reviewOutcome).toBe('CONFIRMED');
    });

    it('overturns a false-positive moderation event', async () => {
      const mockEvent = {
        _id: 'event123',
        reviewOutcome: 'PENDING',
      };

      jest.spyOn(moderationEventRepository, 'findById').mockResolvedValue(mockEvent);
      jest.spyOn(moderationEventRepository, 'updateById').mockResolvedValue({
        ...mockEvent,
        reviewOutcome: 'OVERTURNED',
        reviewedBy: 'operator789',
        reviewNotes: 'False positive',
      });

      const res = await moderationService.overturnEvent('event123', 'operator789', 'False positive');

      expect(moderationEventRepository.updateById).toHaveBeenCalledWith(
        'event123',
        expect.objectContaining({
          reviewOutcome: 'OVERTURNED',
          reviewedBy: 'operator789',
        })
      );
      expect(res.reviewOutcome).toBe('OVERTURNED');
    });
  });
});
