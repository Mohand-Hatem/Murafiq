import { jest } from '@jest/globals';
import stylistService from '../../src/modules/stylists/stylist.service.js';
import stylistRepository from '../../src/modules/stylists/stylist.repository.js';
import userRepository from '../../src/modules/users/user.repository.js';

describe('Stylist Service (Unit)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createProfile', () => {
    it('should throw 403 if role is not stylist', async () => {
      await expect(
        stylistService.createProfile('user123', 'client', { specialty: 'stylist', hourlyPrice: 150 })
      ).rejects.toThrow('Only stylists can create a stylist profile');
    });

    it('should throw 409 if profile already exists', async () => {
      jest.spyOn(stylistRepository, 'findByUserId').mockResolvedValue({ _id: 'profile123' });

      await expect(
        stylistService.createProfile('user123', 'stylist', { specialty: 'stylist', hourlyPrice: 150 })
      ).rejects.toThrow('Stylist profile already exists');
    });
  });
});
