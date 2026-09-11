import mongoose from 'mongoose';
import '../../src/common/globals.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import bookingRepository from '../../src/modules/bookings/booking.repository.js';

describe('bookingRepository.transitionStatus — CAS Integration & Concurrency', () => {
  let clientUser;
  let stylistUser;

  beforeAll(async () => {
    await connectTestDB();
  }, 300000);

  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  beforeEach(async () => {
    await clearTestDB();

    clientUser = await User.create({
      name: 'Client CAS',
      email: 'client-cas@test.com',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'client',
      isEmailVerified: true,
      verification: { status: 'verified' },
    });

    stylistUser = await User.create({
      name: 'Stylist CAS',
      email: 'stylist-cas@test.com',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'stylist',
      isEmailVerified: true,
      verification: { status: 'verified' },
    });
  });

  const createBooking = (status = 'confirmed') =>
    Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: clientUser._id,
      stylistId: stylistUser._id,
      scheduledDate: new Date(),
      scheduledStartMinute: 600,
      scheduledEndMinute: 660,
      meetingLocation: {
        address: '123 Nile St',
        city: 'Cairo',
        location: { type: 'Point', coordinates: [31.2357, 30.0444] },
      },
      price: 500,
      duration: 60,
      status,
    });

  it('transitionStatus writes only from a legal current status', async () => {
    const booking = await createBooking('confirmed');

    const ok = await bookingRepository.transitionStatus(
      booking._id,
      ['confirmed'],
      { status: 'in-progress', checkInAt: new Date() }
    );
    expect(ok).not.toBeNull();
    expect(ok.status).toBe('in-progress');
    expect(ok.checkInAt).toBeDefined();

    // Verify persisted
    const fresh = await Booking.findById(booking._id);
    expect(fresh.status).toBe('in-progress');
  });

  it('returns null on a lost CAS when the status is no longer in fromStates', async () => {
    const booking = await createBooking('in-progress');

    // Attempting to transition from ['confirmed'] when it is already 'in-progress'
    const lost = await bookingRepository.transitionStatus(
      booking._id,
      ['confirmed'],
      { status: 'cancelled' }
    );
    expect(lost).toBeNull();

    // Document remains untouched
    const fresh = await Booking.findById(booking._id);
    expect(fresh.status).toBe('in-progress');
  });

  it('rejects a fromStates list containing a status that cannot legally reach the target', async () => {
    const booking = await createBooking('in-progress');

    // IN_PROGRESS -> CANCELLED is illegal per BOOKING_TRANSITIONS (audit X10)
    await expect(
      bookingRepository.transitionStatus(
        booking._id,
        ['in-progress'],
        { status: 'cancelled' }
      )
    ).rejects.toThrow(/illegal booking transition/i);
  });

  it('RACE CONDITION: exactly one concurrent caller wins the CAS and the loser returns null', async () => {
    const booking = await createBooking('confirmed');

    // Two concurrent callers race to transition the same booking from 'confirmed':
    // Caller 1 tries to check in: 'confirmed' -> 'in-progress'
    // Caller 2 tries to cancel: 'confirmed' -> 'cancelled'
    const [result1, result2] = await Promise.all([
      bookingRepository.transitionStatus(booking._id, ['confirmed'], { status: 'in-progress' }),
      bookingRepository.transitionStatus(booking._id, ['confirmed'], { status: 'cancelled' }),
    ]);

    // Exactly one winner, exactly one null loser
    const results = [result1, result2];
    const winner = results.find((r) => r !== null);
    const loser = results.find((r) => r === null);

    expect(winner).not.toBeUndefined();
    expect(loser).toBeNull();
    expect(['in-progress', 'cancelled']).toContain(winner.status);

    // Database state strictly reflects the winner
    const fresh = await Booking.findById(booking._id);
    expect(fresh.status).toBe(winner.status);
  });
});
