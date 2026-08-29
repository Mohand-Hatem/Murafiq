import { describe, it, expect } from '@jest/globals';
import { toPublicClientDto } from '../../src/modules/users/user.dto.js';

describe('toPublicClientDto (Unit)', () => {
  it('correctly maps public client fields and strips sensitive PII', () => {
    const mockClient = {
      _id: '60f719b8f1a2c81234567891',
      name: 'Sarah Connor',
      email: 'sarah@example.com',
      phone: '+201012345678',
      role: 'client',
      profileImage: 'https://cloudinary.com/avatar.jpg',
      passwordHash: 'hashed_secret',
      tokenVersion: 4,
      accountStatus: 'active',
      country: 'Egypt',
      governorate: 'Cairo',
      city: 'New Cairo',
      area: '5th Settlement',
      verification: {
        status: 'verified',
        documents: [{ type: 'national_id_front', url: 'https://secret.com/id.jpg' }],
      },
      completedBookings: 8,
      clientRating: 4.85,
      clientTotalReviews: 7,
      createdAt: new Date('2025-01-15T10:00:00Z'),
    };

    const publicDto = toPublicClientDto(mockClient);

    expect(publicDto).toBeDefined();
    expect(publicDto.id).toBe('60f719b8f1a2c81234567891');
    expect(publicDto.name).toBe('Sarah Connor');
    expect(publicDto.role).toBe('client');
    expect(publicDto.profileImage).toBe('https://cloudinary.com/avatar.jpg');
    expect(publicDto.isIdentityVerified).toBe(true);
    expect(publicDto.completedBookings).toBe(8);
    expect(publicDto.clientRating).toBe(4.85);
    expect(publicDto.clientTotalReviews).toBe(7);
    expect(publicDto.governorate).toBe('Cairo');
    expect(publicDto.city).toBe('New Cairo');
    expect(publicDto.memberSince).toEqual(mockClient.createdAt);

    // CRITICAL: Zero PII Leakage Assertions
    expect(publicDto.email).toBeUndefined();
    expect(publicDto.phone).toBeUndefined();
    expect(publicDto.passwordHash).toBeUndefined();
    expect(publicDto.tokenVersion).toBeUndefined();
    expect(publicDto.accountStatus).toBeUndefined();
    expect(publicDto.verification).toBeUndefined();
  });

  it('returns null for empty input', () => {
    expect(toPublicClientDto(null)).toBeNull();
    expect(toPublicClientDto(undefined)).toBeNull();
  });
});
