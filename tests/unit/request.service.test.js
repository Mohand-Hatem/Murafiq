import { jest } from '@jest/globals';
import requestService from '../../src/modules/requests/request.service.js';
import userRepository from '../../src/modules/users/user.repository.js';

describe('Request Service (Unit)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createRequest', () => {
    it('should throw 403 if client is unverified', async () => {
      const clientUser = {
        _id: '60f719b8f1a2c81234567891',
        verification: { status: 'unverified' },
      };

      jest.spyOn(userRepository, 'findById').mockResolvedValue(clientUser);

      await expect(
        requestService.createRequest({ id: '60f719b8f1a2c81234567891' }, { stylistId: '60f719b8f1a2c81234567890', title: 'Test Request' })
      ).rejects.toThrow('Your identity must be verified before creating requests');
    });
  });
});
