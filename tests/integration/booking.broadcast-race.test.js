import '../../src/common/globals.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import Request from '../../src/modules/requests/request.model.js';
import Offer from '../../src/modules/offers/offer.model.js';
import Booking from '../../src/modules/bookings/booking.model.js';
import { acceptOffer } from '../../src/modules/offers/offer.service.js';

describe('Broadcast Acceptance Concurrency Race Guard', () => {
  let clientUser;
  let stylistA;
  let stylistB;
  let requestDoc;
  let offerA;
  let offerB;

  beforeAll(async () => {
    await connectTestDB();
    await Request.syncIndexes();
    await Offer.syncIndexes();
    await Booking.syncIndexes();
  }, 300000);

  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  beforeEach(async () => {
    await clearTestDB();

    clientUser = await User.create({
      name: 'Client User',
      email: 'client_race@test.com',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'client',
      isEmailVerified: true,
      verification: { status: 'verified' },
    });

    stylistA = await User.create({
      name: 'Stylist A',
      email: 'stylist_a@test.com',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'stylist',
      isEmailVerified: true,
      verification: { status: 'verified' },
    });

    stylistB = await User.create({
      name: 'Stylist B',
      email: 'stylist_b@test.com',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'stylist',
      isEmailVerified: true,
      verification: { status: 'verified' },
    });

    requestDoc = await Request.create({
      clientId: clientUser._id,
      visibility: 'broadcast',
      title: 'Competitive Bridal Hair Session',
      status: 'OPEN',
      date: new Date('2026-10-01T12:00:00.000Z'),
      time: '12:00',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });

    offerA = await Offer.create({
      requestId: requestDoc._id,
      stylistId: stylistA._id,
      clientId: clientUser._id,
      requestVisibility: 'broadcast',
      price: 600,
      duration: 60,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    offerB = await Offer.create({
      requestId: requestDoc._id,
      stylistId: stylistB._id,
      clientId: clientUser._id,
      requestVisibility: 'broadcast',
      price: 650,
      duration: 60,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  });

  it('should allow only one offer to win under concurrent acceptOffer execution', async () => {
    // Execute concurrent acceptOffer calls on two competing offers for the same broadcast request
    const results = await Promise.allSettled([
      acceptOffer(clientUser, offerA._id.toString()),
      acceptOffer(clientUser, offerB._id.toString()),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one winner, one loser
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // The loser sees 409 if it hits the CAS lock directly, or 400 if MongoDB transience caused a
    // retry and by the time it re-checks, the winner's transaction had already committed and
    // rejected it (offer.status flips to 'rejected' as part of the winning transaction — see
    // offer.service.js's retry envelope and its isTransientMongoError comment). Both are correct,
    // accurate reflections of "this offer lost" observed at different points in the retry timeline
    // — the DB-level invariants below are what actually prove no double-booking happened.
    expect([400, 409]).toContain(rejected[0].reason.statusCode);

    // Exactly one booking in DB
    const totalBookings = await Booking.countDocuments({ requestId: requestDoc._id });
    expect(totalBookings).toBe(1);

    // Request is accepted
    const updatedRequest = await Request.findById(requestDoc._id);
    expect(updatedRequest.status).toBe('FULFILLED');

    // Winning offer is accepted, losing offer is CLOSED
    const updatedOffers = await Offer.find({ requestId: requestDoc._id });
    const acceptedOffers = updatedOffers.filter((o) => o.status === 'accepted' || o.status === 'ACCEPTED');
    const closedOffers = updatedOffers.filter((o) => o.status === 'CLOSED' || o.status === 'rejected');

    expect(acceptedOffers).toHaveLength(1);
    expect(closedOffers).toHaveLength(1);
  });
});
