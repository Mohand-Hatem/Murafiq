import '../../src/common/globals.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import Request from '../../src/modules/requests/request.model.js';
import Offer from '../../src/modules/offers/offer.model.js';
import { getMyOffers } from '../../src/modules/offers/offer.service.js';

/**
 * A stylist who has bid no longer sees that request in the feed, so they need their own list:
 * each offer with its status, their own price, and a summary of the request (including how
 * many offers it has). Never anyone else's offers.
 */
describe('Stylist offers — GET /offers/mine', () => {
  let client;
  let me;
  let other;

  beforeAll(async () => {
    await connectTestDB();
  }, 300000);
  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  const mkUser = (name, role) =>
    User.create({
      name,
      email: `${name}@test.com`,
      phone: `010${Math.floor(Math.random() * 1e8)}`,
      passwordHash: 'x',
      role,
      isEmailVerified: true,
    });

  const mkOffer = async (stylist, { title, price, status = 'PENDING', offerCount = 1 }) => {
    const request = await Request.create({
      clientId: client._id,
      visibility: 'broadcast',
      title,
      status: 'OPEN',
      date: new Date(Date.now() + 86400000),
      time: '10:00',
      expiresAt: new Date(Date.now() + 48 * 3600000),
      offerCount,
    });
    return Offer.create({
      requestId: request._id,
      stylistId: stylist._id,
      clientId: client._id,
      requestVisibility: 'broadcast',
      price,
      duration: 60,
      message: `offer for ${title}`,
      status,
      expiresAt: new Date(Date.now() + 86400000),
    });
  };

  beforeEach(async () => {
    await clearTestDB();
    client = await mkUser('client', 'client');
    me = await mkUser('me', 'stylist');
    other = await mkUser('other', 'stylist');
  });

  it("returns only the caller's offers, newest first, with their own price and the request summary", async () => {
    await mkOffer(me, { title: 'First', price: 300, offerCount: 2 });
    await mkOffer(me, { title: 'Second', price: 450, offerCount: 4 });
    await mkOffer(other, { title: 'Not mine', price: 999 });

    const { items, meta } = await getMyOffers(me, {});

    expect(items.map((o) => o.request.title)).toEqual(['Second', 'First']);
    expect(items[0]).toMatchObject({ price: 450, duration: 60, status: 'PENDING' });
    expect(items[0].request).toMatchObject({ status: 'OPEN', offerCount: 4 });
    expect(JSON.stringify(items)).not.toContain('999');
    expect(meta).toMatchObject({ total: 2, page: 1 });
  });

  it('filters by status', async () => {
    await mkOffer(me, { title: 'Live', price: 300 });
    await mkOffer(me, { title: 'Gone', price: 300, status: 'WITHDRAWN' });

    const { items } = await getMyOffers(me, { status: 'PENDING' });

    expect(items.map((o) => o.request.title)).toEqual(['Live']);
  });

  it('paginates with a capped limit', async () => {
    for (let i = 0; i < 3; i += 1) await mkOffer(me, { title: `R${i}`, price: 300 });

    const { items, meta } = await getMyOffers(me, { page: 2, limit: 2 });

    expect(items).toHaveLength(1);
    expect(meta).toMatchObject({ total: 3, page: 2, limit: 2, totalPages: 2 });
  });

  it('does not expose client contact details through the request summary', async () => {
    await mkOffer(me, { title: 'X', price: 300 });

    const { items } = await getMyOffers(me, {});
    const text = JSON.stringify(items);

    expect(text).not.toContain('client@test.com');
    expect(text).not.toContain('passwordHash');
  });
});
