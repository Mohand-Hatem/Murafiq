import '../../src/common/globals.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import noShowService from '../../src/modules/bookings/no-show.service.js';
import { ROLES } from '../../src/common/constants/roles.constant.js';

/**
 * Regression tests for docs/AUDIT_2026_09_FULL_SYSTEM.md finding X4:
 * `adminResolveNoShow` used to reset ANY booking, in ANY status, to a hardcoded
 * 'confirmed' given only {upheld: false} — with no check that a no-show had ever been
 * reported, that it was ever contested, or what the booking's actual prior status was.
 */
describe('adminResolveNoShow — arbitration guard (X4 regression)', () => {
  let admin;
  let client;
  let stylist;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    admin = await User.create({
      name: 'Admin',
      email: 'admin@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: ROLES.ADMIN,
      isEmailVerified: true,
    });
    client = await User.create({
      name: 'Client',
      email: 'client@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: ROLES.CLIENT,
      isEmailVerified: true,
    });
    stylist = await User.create({
      name: 'Stylist',
      email: 'stylist@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: ROLES.STYLIST,
      isEmailVerified: true,
    });
  });

  const baseBooking = (overrides = {}) =>
    Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: stylist._id,
      scheduledDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
      scheduledStartMinute: 600,
      scheduledEndMinute: 660,
      price: 500,
      duration: 60,
      ...overrides,
    });

  it('refuses to arbitrate a booking with no no-show ever reported', async () => {
    const booking = await baseBooking({ status: 'completed' });

    await expect(
      noShowService.adminResolveNoShow(admin, booking._id.toString(), {
        upheld: false,
        notes: 'mistaken click',
      })
    ).rejects.toThrow(/No no-show has been reported/);

    const unchanged = await Booking.findById(booking._id);
    expect(unchanged.status).toBe('completed');
  });

  it('refuses to arbitrate an UNCONTESTED report (status never left in-progress)', async () => {
    const booking = await baseBooking({
      status: 'in-progress',
      checkInAt: new Date(),
      noShowDetails: {
        reportedBy: client._id,
        reportedAt: new Date(),
        reportedAgainst: 'stylist',
      },
    });

    await expect(
      noShowService.adminResolveNoShow(admin, booking._id.toString(), { upheld: false })
    ).rejects.toThrow(/CONTESTED/);

    const unchanged = await Booking.findById(booking._id);
    expect(unchanged.status).toBe('in-progress');
  });

  it('restores a dismissed CONTESTED report to its exact pre-dispute status, not a hardcoded one', async () => {
    const booking = await baseBooking({
      status: 'disputed',
      checkInAt: new Date(),
      noShowDetails: {
        reportedBy: client._id,
        reportedAt: new Date(),
        reportedAgainst: 'stylist',
        respondedAt: new Date(),
        response: 'I was there the whole time',
        contestedFromStatus: 'in-progress',
      },
      disputeDetails: {
        raisedBy: stylist._id,
        reason: 'Contested no-show report',
        type: 'no_show',
        raisedAt: new Date(),
      },
    });

    const result = await noShowService.adminResolveNoShow(admin, booking._id.toString(), {
      upheld: false,
      notes: 'Evidence supports the stylist',
    });

    expect(result.status).toBe('in-progress');

    const restored = await Booking.findById(booking._id);
    expect(restored.status).toBe('in-progress');
    expect(restored.noShowDetails.confirmedAt).toBeTruthy();
  });

  it('refuses to arbitrate a report that has already been resolved once', async () => {
    const booking = await baseBooking({
      status: 'disputed',
      checkInAt: new Date(),
      noShowDetails: {
        reportedBy: client._id,
        reportedAt: new Date(),
        reportedAgainst: 'stylist',
        respondedAt: new Date(),
        confirmedAt: new Date(),
        contestedFromStatus: 'in-progress',
      },
    });

    await expect(
      noShowService.adminResolveNoShow(admin, booking._id.toString(), { upheld: false })
    ).rejects.toThrow(/already been resolved/);
  });

  it('rejects a non-admin caller', async () => {
    const booking = await baseBooking({
      status: 'disputed',
      noShowDetails: {
        reportedBy: client._id,
        reportedAt: new Date(),
        reportedAgainst: 'stylist',
        respondedAt: new Date(),
        contestedFromStatus: 'in-progress',
      },
    });

    await expect(
      noShowService.adminResolveNoShow(stylist, booking._id.toString(), { upheld: false })
    ).rejects.toThrow(/Forbidden/);
  });
});
