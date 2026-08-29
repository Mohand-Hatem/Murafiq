import '../../src/common/globals.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import Request from '../../src/modules/requests/request.model.js';
import Offer from '../../src/modules/offers/offer.model.js';
import { getOffersForRequest } from '../../src/modules/offers/offer.service.js';

/**
 * The endpoint that makes broadcast requests actually usable: the client's own comparison view
 * across all competing offers. Sealed-bid (design doc §2.3) hides prices from other STYLISTS —
 * it never applies to the request's own client, who needs full price/stylist comparison to pick
 * a winner. This test also proves the ownership boundary: nobody but the client who posted the
 * request can see its offers.
 */
describe('Offer Comparison — GET /offers/requests/:id (client-only, ownership-scoped)', () => {
  let ownerClient;
  let otherClient;
  let stylistA;
  let stylistB;
  let requestDoc;

  beforeAll(async () => {
    await connectTestDB();
    await Offer.syncIndexes();
  }, 300000);

  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  beforeEach(async () => {
    await clearTestDB();

    ownerClient = await User.create({
      name: 'Owner Client',
      email: 'owner@test.com',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'client',
      isEmailVerified: true,
      verification: { status: 'verified' },
    });

    otherClient = await User.create({
      name: 'Other Client',
      email: 'other@test.com',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'client',
      isEmailVerified: true,
      verification: { status: 'verified' },
    });

    stylistA = await User.create({
      name: 'Stylist A',
      email: 'stylist_cmp_a@test.com',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'stylist',
      isEmailVerified: true,
      verification: { status: 'verified' },
    });

    stylistB = await User.create({
      name: 'Stylist B',
      email: 'stylist_cmp_b@test.com',
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'stylist',
      isEmailVerified: true,
      verification: { status: 'verified' },
    });

    requestDoc = await Request.create({
      clientId: ownerClient._id,
      visibility: 'broadcast',
      title: 'Competitive Makeup Session',
      status: 'OPEN',
      date: new Date('2026-10-01T12:00:00.000Z'),
      time: '12:00',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });

    await Offer.create({
      requestId: requestDoc._id,
      stylistId: stylistA._id,
      clientId: ownerClient._id,
      requestVisibility: 'broadcast',
      price: 700,
      duration: 60,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await Offer.create({
      requestId: requestDoc._id,
      stylistId: stylistB._id,
      clientId: ownerClient._id,
      requestVisibility: 'broadcast',
      price: 550,
      duration: 45,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  });

  it('returns every competing offer with its real price, sorted cheapest first', async () => {
    const offers = await getOffersForRequest(ownerClient, requestDoc._id.toString());

    expect(offers).toHaveLength(2);
    expect(offers[0].price).toBe(550); // cheapest first
    expect(offers[1].price).toBe(700);
    // Sealed-bid applies to stylists, not the client viewing their own request — real prices,
    // not ranks/ranges, and real stylist identity for both competing offers.
    expect(offers[0].stylist).toBeDefined();
    expect(offers[1].stylist).toBeDefined();
  });

  it('rejects a client who does not own the request', async () => {
    await expect(
      getOffersForRequest(otherClient, requestDoc._id.toString())
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 404 for a nonexistent request', async () => {
    const fakeId = '000000000000000000000000';
    await expect(
      getOffersForRequest(ownerClient, fakeId)
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
