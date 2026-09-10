import mongoose from 'mongoose';
import '../../src/common/globals.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import eventBus from '../../src/common/events/event-bus.js';
import { EVENTS } from '../../src/common/constants/events.constant.js';
import { confirmCompletion } from '../../src/modules/bookings/booking.service.js';

// Regression test for the audit's most severe concurrency finding: confirmCompletion
// read the booking once, computed "are both parties done?" from that stale read plus
// its own write, and wrote it back unconditionally. Two concurrent confirmations
// (client + stylist) each observed the OTHER party's field as still null and neither
// promoted the booking to 'completed' -- stranding it in 'in-progress' forever with no
// cron or repair path, and the stylist never paid (payout eligibility requires
// status: 'completed'). This exercises the fix against a REAL MongoDB replica set, not
// mocks, since the fix's correctness depends on genuine single-document write
// serialization.
describe('Booking completion — concurrent confirmation race', () => {
  let clientUser;
  let stylistUser;
  let booking;

  beforeAll(async () => {
    await connectTestDB();
  }, 300000);

  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  beforeEach(async () => {
    await clearTestDB();

    clientUser = await User.create({
      name: 'Race Client',
      email: 'race-client@test.com',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'client',
      isEmailVerified: true,
      verification: { status: 'verified' },
    });

    stylistUser = await User.create({
      name: 'Race Stylist',
      email: 'race-stylist@test.com',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'stylist',
      isEmailVerified: true,
      verification: { status: 'verified' },
    });

    booking = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: clientUser._id,
      stylistId: stylistUser._id,
      scheduledDate: new Date(),
      scheduledStartMinute: 600,
      scheduledEndMinute: 660,
      price: 500,
      duration: 60,
      status: 'in-progress',
    });
  });

  it('promotes to completed exactly once when both parties confirm concurrently', async () => {
    let sessionCompletedCount = 0;
    const handler = () => {
      sessionCompletedCount += 1;
    };
    eventBus.on(EVENTS.SESSION_COMPLETED, handler);

    try {
      const results = await Promise.allSettled([
        confirmCompletion({ _id: clientUser._id, role: 'client' }, booking._id.toString()),
        confirmCompletion({ _id: stylistUser._id, role: 'stylist' }, booking._id.toString()),
      ]);

      // Both calls are legitimate (each party confirming their own side) and must both
      // succeed -- this is not a "one winner, one loser" race like offer acceptance.
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

      const final = await Booking.findById(booking._id);
      expect(final.status).toBe('completed');
      expect(final.clientConfirmedAt).not.toBeNull();
      expect(final.stylistConfirmedAt).not.toBeNull();
      expect(final.completedAt).not.toBeNull();

      // The promotion CAS (status: 'in-progress' in the filter) must fire for exactly
      // one of the two concurrent requests -- never both, never neither.
      expect(sessionCompletedCount).toBe(1);
    } finally {
      eventBus.off(EVENTS.SESSION_COMPLETED, handler);
    }
  });

  it('does not promote to completed when only one party has confirmed', async () => {
    await confirmCompletion({ _id: clientUser._id, role: 'client' }, booking._id.toString());

    const final = await Booking.findById(booking._id);
    expect(final.status).toBe('in-progress');
    expect(final.clientConfirmedAt).not.toBeNull();
    expect(final.stylistConfirmedAt).toBeFalsy();
    expect(final.completedAt).toBeFalsy();
  });
});
