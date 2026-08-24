import '../../src/common/globals.js';
import { jest } from '@jest/globals';
import authService from '../../src/modules/auth/auth.service.js';
import authRepository from '../../src/modules/auth/auth.repository.js';
import mailService from '../../src/modules/mail/mail.service.js';

describe('Auth Register Mail Failure Tolerance', () => {
  it('returns created user even if mail provider throws', async () => {
    const mockUser = {
      _id: { toString: () => 'u123' },
      name: 'Test User',
      email: 'newuser@example.com',
      role: 'client',
    };
    jest.spyOn(authRepository, 'findByEmail').mockResolvedValue(null);
    jest.spyOn(authRepository, 'createUser').mockResolvedValue(mockUser);
    jest.spyOn(mailService, 'sendMail').mockRejectedValue(new Error('Resend network outage'));

    const result = await authService.register({
      name: 'Test User',
      email: 'newuser@example.com',
      password: 'StrongPassword123!',
      role: 'client',
    });

    expect(result).toBeDefined();
    expect(result.email).toBe('newuser@example.com');
  });
});
