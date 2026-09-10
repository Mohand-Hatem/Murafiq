import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';
import '../../src/modules/users/user.model.js'; // registers 'User' for offerRepository's populate()
import Offer from '../../src/modules/offers/offer.model.js';
import offerRepository from '../../src/modules/offers/offer.repository.js';

// Regression test: longStopExpiresAt was absent from the Offer schema, so Mongoose's
// default strict mode silently stripped it on every create -- expireOldOffers()'s $or
// clause checking it could never match anything, and the documented "30-day long-stop
// expiry, independent of the 24h expiresAt" did not exist in practice.
describe('Offer long-stop expiry', () => {
  beforeAll(async () => {
    await connectTestDB();
  }, 300000);

  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  beforeEach(async () => {
    await clearTestDB();
  });

  const baseOffer = () => ({
    requestId: new mongoose.Types.ObjectId(),
    stylistId: new mongoose.Types.ObjectId(),
    clientId: new mongoose.Types.ObjectId(),
    price: 500,
    duration: 60,
    status: 'PENDING',
  });

  it('persists longStopExpiresAt on create instead of silently stripping it', async () => {
    const longStopExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const offer = await offerRepository.create({
      ...baseOffer(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      longStopExpiresAt,
    });

    const stored = await Offer.findById(offer._id);
    expect(stored.longStopExpiresAt).not.toBeNull();
    expect(stored.longStopExpiresAt.getTime()).toBe(longStopExpiresAt.getTime());
  });

  it('expires an offer whose longStopExpiresAt has passed, even with a future expiresAt', async () => {
    const offer = await offerRepository.create({
      ...baseOffer(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // still 24h away
      longStopExpiresAt: new Date(Date.now() - 60 * 1000), // long-stop already passed
    });

    await offerRepository.expireOldOffers();

    const updated = await Offer.findById(offer._id);
    expect(updated.status).toBe('EXPIRED');
  });

  it('does not expire an offer whose long-stop has not passed and whose normal expiry has not passed', async () => {
    const offer = await offerRepository.create({
      ...baseOffer(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      longStopExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    await offerRepository.expireOldOffers();

    const updated = await Offer.findById(offer._id);
    expect(updated.status).toBe('PENDING');
  });
});
