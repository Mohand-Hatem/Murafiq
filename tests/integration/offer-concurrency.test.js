import '../../src/common/globals.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import Request from '../../src/modules/requests/request.model.js';
import Offer from '../../src/modules/offers/offer.model.js';
import UsageCounter from '../../src/modules/subscriptions/usage-counter.model.js';
import offerService from '../../src/modules/offers/offer.service.js';

/**
 * One offer per stylist per request, even when two submissions race past the service check.
 * The partial unique index is the backstop; the loser must get a clean 4xx, and must not lose
 * one of the stylist's limited daily offers for an offer that was never created.
 */
describe('Offer creation race — one offer per stylist per request', () => {
  let client;
  let stylist;
  let request;

  beforeAll(async () => {
    await connectTestDB();
    await Offer.syncIndexes();
  }, 300000);
  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  beforeEach(async () => {
    await clearTestDB();
    const mk = (name, role) =>
      User.create({
        name,
        email: `${name}@test.com`,
        phone: `010${Math.floor(Math.random() * 1e8)}`,
        passwordHash: 'x',
        role,
        isEmailVerified: true,
        verification: { status: 'verified' },
      });
    client = await mk('client', 'client');
    stylist = await mk('stylist', 'stylist');
    request = await Request.create({
      clientId: client._id,
      visibility: 'broadcast',
      title: 'Outfit',
      status: 'OPEN',
      date: new Date(Date.now() + 3 * 86400000),
      time: '10:00',
      expiresAt: new Date(Date.now() + 2 * 86400000),
    });
  });

  const send = () =>
    offerService.createOffer(stylist, request._id.toString(), { price: 500, duration: 60 });

  it('lets exactly one of two simultaneous offers through, with a 4xx for the loser', async () => {
    const results = await Promise.allSettled([send(), send()]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason.statusCode).toBeGreaterThanOrEqual(400);
    expect(failed[0].reason.statusCode).toBeLessThan(500);
    expect(await Offer.countDocuments({ requestId: request._id, stylistId: stylist._id })).toBe(1);
  });

  it("does not burn the loser's daily offer quota", async () => {
    await Promise.allSettled([send(), send()]);

    const counter = await UsageCounter.findOne({ subjectId: stylist._id, metric: 'offers.daily' });
    expect(counter.used).toBe(1);
  });

  it('does not double-count the request when the loser fails', async () => {
    await Promise.allSettled([send(), send()]);

    expect((await Request.findById(request._id)).offerCount).toBe(1);
  });
});
