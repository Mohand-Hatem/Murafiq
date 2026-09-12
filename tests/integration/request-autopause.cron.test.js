import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import Request from '../../src/modules/requests/request.model.js';
import User from '../../src/modules/users/user.model.js';
import requestRepository from '../../src/modules/requests/request.repository.js';
import { sweepAutoPauseRequests } from '../../src/jobs/request-autopause.cron.js';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';

describe('Request auto-pause sweep (Task S6.1)', () => {
  let clientUser;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    jest.restoreAllMocks();

    clientUser = await User.create({
      name: 'AutoPause Client',
      email: `client-${Date.now()}@test.com`,
      passwordHash: '$2b$10$validhashedpasswordforrealintegrationtests',
      role: 'client',
      isEmailVerified: true,
      verification: { status: 'verified' },
    });
  });

  it('does not revive a request cancelled mid-sweep', async () => {
    const past = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const req = await Request.create({
      clientId: clientUser._id,
      title: 'Need a wardrobe styling',
      visibility: 'broadcast',
      status: 'OPEN',
      offerCount: 0,
      pauseCount: 0,
      autoPauseAt: past,
    });

    // Simulate a racer: client cancels the request between the query and the update
    const origFindRepo = requestRepository.findAutoPausableRequests.bind(requestRepository);
    jest.spyOn(requestRepository, 'findAutoPausableRequests').mockImplementation(async (now) => {
      const docs = await origFindRepo(now);
      await Request.updateOne({ _id: req._id }, { $set: { status: 'CANCELLED' } }); // the racer
      return docs;
    });

    await sweepAutoPauseRequests();

    const fresh = await Request.findById(req._id);
    expect(fresh.status).toBe('CANCELLED');
  });

  it('proves concurrent sweeps cannot double-apply or double-increment pauseCount', async () => {
    const past = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const req = await Request.create({
      clientId: clientUser._id,
      title: 'Party outfit consultation',
      visibility: 'broadcast',
      status: 'OPEN',
      offerCount: 0,
      pauseCount: 0,
      autoPauseAt: past,
    });

    // Run two sweeps concurrently on the same pausable request
    const [sweep1, sweep2] = await Promise.all([
      sweepAutoPauseRequests(),
      sweepAutoPauseRequests(),
    ]);

    const fresh = await Request.findById(req._id);
    expect(fresh.status).toBe('PAUSED');
    // Exactly one sweep must have paused it and incremented pauseCount to 1, not 2
    expect(fresh.pauseCount).toBe(1);
    expect(sweep1.pausedCount + sweep2.pausedCount).toBe(1);
  });
});
