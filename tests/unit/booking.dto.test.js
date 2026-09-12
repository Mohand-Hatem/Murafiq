import { describe, it, expect } from '@jest/globals';
import { toPublicBookingDto } from '../../src/modules/bookings/booking.dto.js';

/**
 * Regression test for docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X26.
 *
 * booking.repository.js used to populate clientId/stylistId with
 * `select: 'nameEn nameAr profileImage'` -- fields that do not exist on User (only
 * `name` does; `nameEn`/`nameAr` exist solely on the Egyptian-governorate location
 * constants, copy-pasted from the wrong shape) -- so every booking response returned a
 * counterparty with `name: undefined`.
 *
 * The two fixes must land together: widening the select to include `name` while the DTO
 * still mapped the stylist through `toPublicUser` would have exposed the stylist's email
 * and phone to every client on every booking read.
 */
describe('toPublicBookingDto — counterparty projection (X26)', () => {
  const populatedBooking = {
    _id: 'booking-1',
    requestId: 'req-1',
    offerId: 'offer-1',
    clientId: {
      _id: 'client-1',
      name: 'Amina Client',
      profileImage: 'https://res.cloudinary.com/x/client.jpg',
      email: 'amina@example.com',
      phone: '+201000000000',
      role: 'client',
      accountStatus: 'active',
    },
    stylistId: {
      _id: 'stylist-1',
      name: 'Sara Stylist',
      profileImage: 'https://res.cloudinary.com/x/stylist.jpg',
      email: 'sara@example.com',
      phone: '+201000000001',
      role: 'stylist',
      accountStatus: 'active',
    },
    scheduledDate: new Date(),
    scheduledStartMinute: 600,
    scheduledEndMinute: 660,
    price: 500,
    duration: 60,
    status: 'confirmed',
  };

  it('returns the real name for both parties (the actual bug)', () => {
    const dto = toPublicBookingDto(populatedBooking);
    expect(dto.client.name).toBe('Amina Client');
    expect(dto.stylist.name).toBe('Sara Stylist');
  });

  it('never exposes the stylist email, phone, role, or accountStatus to the client', () => {
    const dto = toPublicBookingDto(populatedBooking);
    expect(dto.stylist.email).toBeUndefined();
    expect(dto.stylist.phone).toBeUndefined();
    expect(dto.stylist.role).toBeUndefined();
    expect(dto.stylist.accountStatus).toBeUndefined();
  });

  it('never exposes the client email, phone, role, or accountStatus to the stylist', () => {
    const dto = toPublicBookingDto(populatedBooking);
    expect(dto.client.email).toBeUndefined();
    expect(dto.client.phone).toBeUndefined();
    expect(dto.client.role).toBeUndefined();
    expect(dto.client.accountStatus).toBeUndefined();
  });

  it('still returns profileImage for both parties', () => {
    const dto = toPublicBookingDto(populatedBooking);
    expect(dto.client.profileImage).toBe('https://res.cloudinary.com/x/client.jpg');
    expect(dto.stylist.profileImage).toBe('https://res.cloudinary.com/x/stylist.jpg');
  });
});
