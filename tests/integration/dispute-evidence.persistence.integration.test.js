import '../../src/common/globals.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import bookingService from '../../src/modules/bookings/booking.service.js';

// Dispute evidence must actually be stored: the admin decides disputes from it. The HTTP test
// (dispute-evidence.test.js) mocks the repository, so it never reached the schema.
describe('Dispute evidence persistence (real DB)', () => {
  let client;
  let stylist;
  let booking;

  beforeAll(async () => {
    await connectTestDB();
  }, 300000);
  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  beforeEach(async () => {
    await clearTestDB();
    const user = (name, role) =>
      User.create({ name, email: `${role}@evidence.test`, passwordHash: 'x'.repeat(20), role, isEmailVerified: true });
    client = await user('Evidence Client', 'client');
    stylist = await user('Evidence Stylist', 'stylist');
    booking = await Booking.create({
      requestId: new mongoose.Types.ObjectId(),
      offerId: new mongoose.Types.ObjectId(),
      clientId: client._id,
      stylistId: stylist._id,
      scheduledDate: new Date(),
      scheduledStartMinute: 600,
      scheduledEndMinute: 660,
      price: 500,
      duration: 60,
      status: 'in-progress',
      bookingMode: 'demo',
      payoutStatus: 'not_owed',
    });
  });

  const asUser = (doc) => ({ _id: doc._id, id: doc._id.toString(), role: doc.role });
  const details = (as) => bookingService.getDisputeDetails(asUser(as), booking._id.toString());

  it('stores the evidence filed with the dispute', async () => {
    await bookingService.fileDispute(asUser(client), booking._id.toString(), {
      reason: 'The stylist left halfway through',
      evidence: [{ text: 'Left at 4:50', images: ['https://example.com/a.jpg'] }],
    });

    const { disputeDetails } = await details(stylist);
    expect(disputeDetails.evidence).toHaveLength(1);
    expect(disputeDetails.evidence[0].text).toBe('Left at 4:50');
    expect(disputeDetails.evidence[0].images).toEqual(['https://example.com/a.jpg']);
    expect(disputeDetails.evidence[0].submittedBy.toString()).toBe(client._id.toString());
    expect(disputeDetails.evidence[0].submittedAt).toBeInstanceOf(Date);
  });

  it('appends evidence added later by the other party', async () => {
    await bookingService.fileDispute(asUser(client), booking._id.toString(), {
      reason: 'The stylist left halfway through',
    });

    await bookingService.addDisputeEvidence(asUser(stylist), booking._id.toString(), {
      text: 'Client asked me to stop early',
      images: ['https://example.com/chat.png'],
    });

    const { disputeDetails } = await details(client);
    expect(disputeDetails.evidence).toHaveLength(1);
    expect(disputeDetails.evidence[0].text).toBe('Client asked me to stop early');
    expect(disputeDetails.evidence[0].submittedBy.toString()).toBe(stylist._id.toString());
    const stored = await Booking.findById(booking._id).lean();
    expect(stored.disputeDetails.evidence[0].images).toEqual(['https://example.com/chat.png']);
  });

  it('stores no evidence when none is filed', async () => {
    await bookingService.fileDispute(asUser(client), booking._id.toString(), { reason: 'Not satisfied at all' });

    expect((await details(client)).disputeDetails.evidence).toEqual([]);
  });
});
