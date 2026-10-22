import '../../src/common/globals.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import StylistProfile from '../../src/modules/stylists/stylist-profile.model.js';
import Request from '../../src/modules/requests/request.model.js';
import Offer from '../../src/modules/offers/offer.model.js';
import { getCompetingOffers } from '../../src/modules/offers/offer.service.js';
import { toPublicRequestDto } from '../../src/modules/requests/request.dto.js';

/**
 * Stylists may see HOW MANY offers a broadcast request has and WHAT the other stylists wrote
 * (message, name, rating) -- but never the price, duration or contact details. Prices stay
 * sealed from competitors; only the request's own client sees them (offers-comparison.test.js).
 */
describe('Competing offers — GET /offers/requests/:id/competing (stylist-only, no prices)', () => {
  let client;
  let stylistA;
  let stylistB;
  let unverifiedStylist;
  let requestDoc;

  const baseUser = {
    passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
    isEmailVerified: true,
    verification: { status: 'verified' },
  };

  const makeOffer = (stylist, overrides = {}) =>
    Offer.create({
      requestId: requestDoc._id,
      stylistId: stylist._id,
      clientId: client._id,
      requestVisibility: 'broadcast',
      price: 500,
      duration: 60,
      message: 'Happy to help',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      ...overrides,
    });

  beforeAll(async () => {
    await connectTestDB();
    await Offer.syncIndexes();
  }, 300000);

  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  beforeEach(async () => {
    await clearTestDB();

    client = await User.create({ ...baseUser, name: 'Client', email: 'c@test.com', role: 'client' });
    stylistA = await User.create({
      ...baseUser,
      name: 'Stylist A',
      email: 'sa@test.com',
      phone: '01011111111',
      role: 'stylist',
    });
    stylistB = await User.create({
      ...baseUser,
      name: 'Stylist B',
      email: 'sb@test.com',
      phone: '01022222222',
      role: 'stylist',
    });
    unverifiedStylist = await User.create({
      ...baseUser,
      name: 'Unverified',
      email: 'su@test.com',
      role: 'stylist',
      verification: { status: 'unverified' },
    });

    await StylistProfile.create({
      userId: stylistA._id,
      specialty: 'stylist',
      hourlyPrice: 300,
      rating: 4.8,
      totalReviews: 12,
    });
    await StylistProfile.create({
      userId: stylistB._id,
      specialty: 'stylist',
      hourlyPrice: 250,
      rating: 4.2,
      totalReviews: 5,
    });

    requestDoc = await Request.create({
      clientId: client._id,
      visibility: 'broadcast',
      title: 'Wedding outfit',
      status: 'OPEN',
      date: new Date('2026-12-01T12:00:00.000Z'),
      time: '12:00',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });
  });

  it("shows other stylists' message, name and rating — and flags the caller's own offer", async () => {
    await makeOffer(stylistA, { message: 'I specialise in bridal looks' });
    await makeOffer(stylistB, { message: 'Ten years of wedding styling' });

    const result = await getCompetingOffers(stylistA, requestDoc._id.toString());

    expect(result).toHaveLength(2);
    const mine = result.find((o) => o.isMine);
    const theirs = result.find((o) => !o.isMine);
    expect(mine.message).toBe('I specialise in bridal looks');
    expect(theirs.message).toBe('Ten years of wedding styling');
    expect(theirs.stylist).toEqual({
      id: stylistB._id.toString(),
      name: 'Stylist B',
      profileImage: expect.anything(),
      rating: 4.2,
      totalReviews: 5,
    });
  });

  it('never leaks price, duration or contact details', async () => {
    await makeOffer(stylistA, { price: 777, duration: 90 });
    await makeOffer(stylistB, { price: 888, duration: 45 });

    const result = await getCompetingOffers(stylistA, requestDoc._id.toString());
    const serialised = JSON.stringify(result);

    for (const offer of result) {
      expect(offer).not.toHaveProperty('price');
      expect(offer).not.toHaveProperty('duration');
      expect(offer.stylist).not.toHaveProperty('email');
      expect(offer.stylist).not.toHaveProperty('phone');
    }
    for (const secret of ['777', '888', 'sb@test.com', '01022222222']) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('masks digits in messages so a price typed into the text cannot leak', async () => {
    await makeOffer(stylistA);
    await makeOffer(stylistB, { message: 'I can do it for 300 EGP or ٣٠٠ جنيه' });

    const result = await getCompetingOffers(stylistA, requestDoc._id.toString());
    const theirs = result.find((o) => !o.isMine);

    expect(theirs.message).toBe('I can do it for ••• EGP or ••• جنيه');
  });

  it('lists only PENDING offers', async () => {
    await makeOffer(stylistA);
    await makeOffer(stylistB, { status: 'WITHDRAWN' });

    const result = await getCompetingOffers(stylistA, requestDoc._id.toString());

    expect(result).toHaveLength(1);
    expect(result[0].isMine).toBe(true);
  });

  it('lets a stylist who has not bid yet see the competition', async () => {
    await makeOffer(stylistB);

    const result = await getCompetingOffers(stylistA, requestDoc._id.toString());

    expect(result).toHaveLength(1);
    expect(result[0].isMine).toBe(false);
  });

  it('rejects an unverified stylist', async () => {
    await expect(
      getCompetingOffers(unverifiedStylist, requestDoc._id.toString())
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 404 for an unknown request', async () => {
    await expect(
      getCompetingOffers(stylistA, '000000000000000000000000')
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects a direct request (nothing to compare)', async () => {
    const direct = await Request.create({
      clientId: client._id,
      stylistId: stylistA._id,
      visibility: 'direct',
      title: 'Direct',
      status: 'OPEN',
      date: new Date('2026-12-01T12:00:00.000Z'),
      time: '12:00',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });

    await expect(
      getCompetingOffers(stylistA, direct._id.toString())
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a request that is no longer OPEN', async () => {
    await Request.updateOne({ _id: requestDoc._id }, { status: 'FULFILLED' });

    await expect(
      getCompetingOffers(stylistA, requestDoc._id.toString())
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('Request feed DTO — offerCount', () => {
  it('exposes offerCount (a plain number, never the offers themselves)', () => {
    const dto = toPublicRequestDto({
      _id: 'abc',
      title: 'T',
      visibility: 'broadcast',
      status: 'OPEN',
      offerCount: 3,
    });
    expect(dto.offerCount).toBe(3);
  });

  it('defaults offerCount to 0 when the request has no offers yet', () => {
    const dto = toPublicRequestDto({ _id: 'abc', title: 'T', status: 'OPEN' });
    expect(dto.offerCount).toBe(0);
  });
});
