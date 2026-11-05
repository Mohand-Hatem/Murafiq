import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import '../../src/common/globals.js';

const sendEachForMulticast = jest.fn(async ({ tokens }) => ({
  successCount: tokens.length,
  failureCount: 0,
  responses: tokens.map(() => ({ success: true })),
}));
jest.unstable_mockModule('../../src/config/firebase.config.js', () => ({
  isFirebaseConnected: false,
  firestore: null,
  auth: null,
  messaging: { sendEachForMulticast },
  default: {},
}));

const { connectTestDB, closeTestDB, clearTestDB } = await import('../setup/db-handler.js');
const { default: User } = await import('../../src/modules/users/user.model.js');
const { default: Notification } = await import('../../src/modules/notifications/notification.model.js');
const { default: notificationService } = await import('../../src/modules/notifications/notification.service.js');

// An in-app notification with a dedupeKey exists at most once; its push goes out only from
// the call that created it. Real MongoDB; FCM is mocked so pushes can be counted.
describe('Notification dedupe (real DB)', () => {
  let user;
  const payload = { type: 'review', title: 'Session Completed', body: 'Done.' };

  beforeAll(async () => {
    await connectTestDB();
    await Notification.init();
  }, 300000);

  afterAll(async () => {
    await closeTestDB();
  }, 30000);

  beforeEach(async () => {
    await clearTestDB();
    sendEachForMulticast.mockClear();
    user = await User.create({
      name: 'Push User',
      email: 'push@dedupe.test',
      passwordHash: 'x'.repeat(20),
      role: 'client',
      isEmailVerified: true,
      fcmTokens: ['token-1'],
    });
  });

  it('creates one record and sends one push for ten concurrent sends with the same key', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => notificationService.send(user._id, payload, { dedupeKey: 'k:1' }))
    );

    expect(await Notification.countDocuments({ userId: user._id })).toBe(1);
    expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
    const ids = new Set(results.map((n) => n._id.toString()));
    expect(ids.size).toBe(1);
  });

  it('keeps sends without a key independent, as before', async () => {
    await notificationService.send(user._id, payload);
    await notificationService.send(user._id, payload);

    expect(await Notification.countDocuments({ userId: user._id })).toBe(2);
    expect(sendEachForMulticast).toHaveBeenCalledTimes(2);
  });

  it('lets an older keyless record and a keyed one coexist', async () => {
    await Notification.create({ userId: user._id, ...payload });
    await notificationService.send(user._id, payload, { dedupeKey: 'k:2' });
    await notificationService.send(user._id, payload, { dedupeKey: 'k:2' });

    expect(await Notification.countDocuments({ userId: user._id })).toBe(2);
  });

  it('enforces the key with a unique index that ignores records without one', async () => {
    const indexes = await Notification.collection.indexes();
    const dedupe = indexes.find((i) => i.key?.dedupeKey === 1);

    expect(dedupe).toBeDefined();
    expect(dedupe.unique).toBe(true);
    expect(dedupe.partialFilterExpression).toEqual({ dedupeKey: { $type: 'string' } });
  });
});
