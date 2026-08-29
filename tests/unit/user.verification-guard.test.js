import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import userService from '../../src/modules/users/user.service.js';
import userRepository from '../../src/modules/users/user.repository.js';

describe('User Verification State Machine Guards', () => {
  it('rejects approval with 409 if user is not in pending status', async () => {
    jest.spyOn(userRepository, 'findById').mockResolvedValue({
      _id: 'u1',
      verification: { status: 'verified' },
    });

    await expect(userService.approveVerification('u1', 'admin1')).rejects.toThrow(
      /Cannot approve verification/i
    );
  });

  it('rejects approval with 400 if user has no submitted documents', async () => {
    jest.spyOn(userRepository, 'findById').mockResolvedValue({
      _id: 'u1',
      verification: { status: 'pending', documents: [] },
    });

    await expect(userService.approveVerification('u1', 'admin1')).rejects.toThrow(
      /no submitted documents/i
    );
  });

  it('rejects rejection with 409 if user is not in pending status', async () => {
    jest.spyOn(userRepository, 'findById').mockResolvedValue({
      _id: 'u1',
      verification: { status: 'unverified' },
    });

    await expect(userService.rejectVerification('u1', 'admin1', 'Bad photos')).rejects.toThrow(
      /Cannot reject verification/i
    );
  });
});
