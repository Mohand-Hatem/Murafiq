import mongoose from 'mongoose';
import Offer from '../../src/modules/offers/offer.model.js';
import Request from '../../src/modules/requests/request.model.js';
import { OFFER_STATUS, REQUEST_STATUS } from '../../src/common/constants/statuses.constant.js';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';

/**
 * The confirmed offer rule, asserted against a REAL MongoDB replica set:
 *
 *   active offers per stylist = subscription entitlement (Free = 3)
 *   AND at most 1 active offer per stylist per request
 *
 * "Active" means PENDING or ACCEPTED. An offer that has been REJECTED, CLOSED, WITHDRAWN
 * or EXPIRED must stop counting, so the stylist gets that slot back.
 *
 * The per-request cap is enforced by a partial unique index rather than only by a service
 * check, because a service check has a read-then-write window that two concurrent requests
 * can both pass through. The concurrency test below is what proves the index is doing the
 * work — remove it and that test fails while the single-threaded ones still pass.
 */

const stylistId = new mongoose.Types.ObjectId();
const clientId = new mongoose.Types.ObjectId();

const makeRequest = async () =>
  Request.create({
    clientId,
    visibility: 'broadcast',
    title: 'Offer limit probe',
    status: REQUEST_STATUS.OPEN,
  });

const makeOffer = (requestId, status = OFFER_STATUS.PENDING, overrides = {}) =>
  Offer.create({
    requestId,
    stylistId,
    clientId,
    price: 300,
    duration: 60,
    status,
    ...overrides,
  });

const countActive = () =>
  Offer.countDocuments({
    stylistId,
    status: { $in: [OFFER_STATUS.PENDING, OFFER_STATUS.ACCEPTED] },
  });

beforeAll(async () => {
  await connectTestDB();
  // Indexes are what enforce the per-request cap; without syncing them the DB-level
  // guarantees under test simply do not exist in this database.
  await Offer.syncIndexes();
});
afterAll(async () => {
  await closeTestDB();
});
beforeEach(async () => {
  await clearTestDB();
  await Offer.syncIndexes();
});

describe('At most one ACTIVE offer per stylist per request', () => {
  it('rejects a second PENDING offer on the same request', async () => {
    const req = await makeRequest();
    await makeOffer(req._id);

    await expect(makeOffer(req._id)).rejects.toMatchObject({ code: 11000 });
    expect(await countActive()).toBe(1);
  });

  it('rejects a PENDING offer alongside an ACCEPTED one on the same request', async () => {
    const req = await makeRequest();
    await makeOffer(req._id, OFFER_STATUS.ACCEPTED);

    await expect(makeOffer(req._id)).rejects.toMatchObject({ code: 11000 });
  });

  it('blocks BOTH writers when two offers race on the same request', async () => {
    // The service-level count has a read-then-write window; only the unique index closes
    // it. Exactly one insert must survive.
    const req = await makeRequest();

    const results = await Promise.allSettled([makeOffer(req._id), makeOffer(req._id)]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe(11000);
    expect(await countActive()).toBe(1);
  });
});

describe('Closed offers free the slot', () => {
  it.each([
    OFFER_STATUS.REJECTED,
    OFFER_STATUS.CLOSED,
    OFFER_STATUS.WITHDRAWN,
    OFFER_STATUS.EXPIRED,
  ])('a %s offer no longer blocks a new offer on the same request', async (closedStatus) => {
    const req = await makeRequest();
    const first = await makeOffer(req._id);

    await Offer.updateOne({ _id: first._id }, { $set: { status: closedStatus } });

    // The partial index only covers PENDING/ACCEPTED, so a re-bid is now allowed.
    const second = await makeOffer(req._id);
    expect(second).toBeDefined();
    expect(await countActive()).toBe(1); // the closed one does not count
  });
});

describe('The same client across DIFFERENT requests', () => {
  it('allows one active offer to the same client on each of three requests', async () => {
    // This is the case the rule explicitly permits: repeat bidding to one client is fine,
    // provided each offer belongs to a different request.
    const requests = await Promise.all([makeRequest(), makeRequest(), makeRequest()]);
    for (const r of requests) await makeOffer(r._id);

    expect(await countActive()).toBe(3);
    const distinctClients = await Offer.distinct('clientId', { stylistId });
    expect(distinctClients).toHaveLength(1); // all three to the SAME client
  });
});

describe('Subscription entitlement caps the total', () => {
  let capacity;

  beforeAll(async () => {
    ({ capacity } = await import('../../src/modules/subscriptions/entitlement.service.js'));
  });

  it('counts only PENDING offers toward offers.active', async () => {
    const [r1, r2, r3] = await Promise.all([makeRequest(), makeRequest(), makeRequest()]);
    await makeOffer(r1._id, OFFER_STATUS.PENDING);
    await makeOffer(r2._id, OFFER_STATUS.ACCEPTED); // won — no longer an outstanding offer
    await makeOffer(r3._id, OFFER_STATUS.REJECTED); // closed

    const info = await capacity(stylistId, 'offers.active', 'stylist');
    expect(info.used).toBe(1);
  });

  it('reports the Free tier limit of 3 and blocks at capacity', async () => {
    const requests = await Promise.all([makeRequest(), makeRequest(), makeRequest()]);
    for (const r of requests) await makeOffer(r._id);

    const info = await capacity(stylistId, 'offers.active', 'stylist');
    expect(info.limit).toBe(3); // stylist.free entitlement
    expect(info.used).toBe(3);
    expect(info.hasCapacity).toBe(false);
  });

  it('frees capacity again once an offer closes', async () => {
    const requests = await Promise.all([makeRequest(), makeRequest(), makeRequest()]);
    const created = [];
    for (const r of requests) created.push(await makeOffer(r._id));

    await Offer.updateOne({ _id: created[0]._id }, { $set: { status: OFFER_STATUS.WITHDRAWN } });

    const info = await capacity(stylistId, 'offers.active', 'stylist');
    expect(info.used).toBe(2);
    expect(info.hasCapacity).toBe(true);
  });
});

describe('Index shape matches the rule', () => {
  it('the per-request uniqueness is partial, scoped to active statuses only', () => {
    // A BLANKET unique index would permanently bar a stylist from ever re-bidding on a
    // request, even after their earlier offer was rejected — a different, wrong rule.
    const idx = Offer.schema
      .indexes()
      .find(([fields]) => Object.keys(fields).join(',') === 'requestId,stylistId');

    expect(idx).toBeDefined();
    expect(idx[1].unique).toBe(true);
    expect(idx[1].partialFilterExpression.status.$in.sort()).toEqual(
      [OFFER_STATUS.ACCEPTED, OFFER_STATUS.PENDING].sort()
    );
  });
});
