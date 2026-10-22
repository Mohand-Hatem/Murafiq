import '../../src/common/globals.js';
import { connectTestDB, clearTestDB, closeTestDB } from '../setup/db-handler.js';
import User from '../../src/modules/users/user.model.js';
import Request from '../../src/modules/requests/request.model.js';
import Offer from '../../src/modules/offers/offer.model.js';
import offerService from '../../src/modules/offers/offer.service.js';
import requestService from '../../src/modules/requests/request.service.js';
import { sweepExpiredOffers } from '../../src/jobs/offer-expiry.cron.js';

/**
 * Product owner decision 2026-10-22: there is no 24-hour offer expiry. An offer stays live until
 * it is accepted, rejected or withdrawn, a sibling is accepted, its request ends, the session
 * start passes, or the 30-day long stop is reached.
 */
const DAY = 24 * 60 * 60 * 1000;

describe('Offer lifetime', () => {
  let client;
  let stylist;

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
      verification: { status: 'verified' },
    });

  const mkRequest = (daysAhead) =>
    Request.create({
      clientId: client._id,
      visibility: 'broadcast',
      title: 'Wedding outfit',
      status: 'OPEN',
      date: new Date(Date.now() + daysAhead * DAY),
      time: '10:00',
      expiresAt: new Date(Date.now() + 2 * DAY),
    });

  const send = (request) =>
    offerService.createOffer(stylist, request._id.toString(), { price: 500, duration: 60 });

  beforeEach(async () => {
    await clearTestDB();
    client = await mkUser('client', 'client');
    stylist = await mkUser('stylist', 'stylist');
  });

  describe('when an offer expires', () => {
    it('lasts until the session start, not 24 hours', async () => {
      const request = await mkRequest(5);
      const { id } = await send(request);

      const offer = await Offer.findById(id);
      const ms = offer.expiresAt.getTime() - Date.now();
      expect(ms).toBeGreaterThan(3 * DAY); // far beyond the old 24h
      expect(ms).toBeLessThan(5 * DAY + DAY); // roughly the session start
    });

    it('is capped by the 30-day long stop when the session is further away', async () => {
      const request = await mkRequest(90);
      const { id } = await send(request);

      const offer = await Offer.findById(id);
      const days = (offer.expiresAt.getTime() - Date.now()) / DAY;
      expect(days).toBeGreaterThan(29);
      expect(days).toBeLessThanOrEqual(30.01);
      expect(offer.longStopExpiresAt.getTime()).toBe(offer.expiresAt.getTime());
    });

    it('is not swept just because it is older than a day', async () => {
      const request = await mkRequest(5);
      const { id } = await send(request);
      await Offer.collection.updateOne(
        { _id: (await Offer.findById(id))._id },
        { $set: { createdAt: new Date(Date.now() - 2 * DAY) } }
      );

      await sweepExpiredOffers();

      expect((await Offer.findById(id)).status).toBe('PENDING');
    });

    it('is swept once the session start has passed', async () => {
      const request = await mkRequest(5);
      const { id } = await send(request);
      await Offer.updateOne({ _id: id }, { expiresAt: new Date(Date.now() - 1000) });

      await sweepExpiredOffers();

      expect((await Offer.findById(id)).status).toBe('EXPIRED');
    });
  });

  describe('when its request ends', () => {
    const mkOffer = (request, status) =>
      Offer.create({
        requestId: request._id,
        stylistId: stylist._id,
        clientId: client._id,
        requestVisibility: 'broadcast',
        price: 500,
        duration: 60,
        status,
        expiresAt: new Date(Date.now() + 5 * DAY),
      });

    it('closing the request closes its pending offers and leaves finished ones alone', async () => {
      const request = await mkRequest(5);
      const pending = await mkOffer(request, 'PENDING');
      const withdrawn = await mkOffer(request, 'WITHDRAWN');

      await requestService.closeRequest(client._id.toString(), request._id.toString());

      expect((await Offer.findById(pending._id)).status).toBe('CLOSED');
      expect((await Offer.findById(withdrawn._id)).status).toBe('WITHDRAWN');
    });

    it('cancelling the request closes its pending offers', async () => {
      const request = await mkRequest(5);
      const pending = await mkOffer(request, 'PENDING');

      await requestService.cancelRequest(client._id.toString(), request._id.toString());

      expect((await Offer.findById(pending._id)).status).toBe('CLOSED');
    });

    it("does not touch another request's offers", async () => {
      const request = await mkRequest(5);
      const other = await mkRequest(6);
      const otherOffer = await mkOffer(other, 'PENDING');

      await requestService.closeRequest(client._id.toString(), request._id.toString());

      expect((await Offer.findById(otherOffer._id)).status).toBe('PENDING');
    });
  });
});
