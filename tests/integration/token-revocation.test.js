import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../src/app.js';
import User from '../../src/modules/users/user.model.js';
import { generateAccessToken } from '../../src/common/utils/generateTokens.js';
import { _reset as resetTokenVersionCache } from '../../src/common/utils/tokenVersionCache.js';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';

/**
 * Access-token revocation, end to end against a real database.
 *
 * This exists because the first implementation incremented `User.tokenVersion` in three
 * places but never put the claim into the JWT and never checked it — so suspending or
 * banning a user did nothing to their live session, and nothing failed to reveal it.
 * These tests assert the observable behaviour (an old token stops working), not the
 * mechanism, so they would have caught that.
 */
describe('Access-token revocation via tokenVersion', () => {
  let user;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    resetTokenVersionCache();
    user = await User.create({
      name: 'Revocation Probe',
      email: 'revoke@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'client',
      isEmailVerified: true,
      tokenVersion: 0,
    });
  });

  const tokenFor = (u, tv) =>
    generateAccessToken({ sub: u._id.toString(), role: u.role, tv });

  it('accepts a token whose tv matches the stored tokenVersion', async () => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokenFor(user, 0)}`);

    expect(res.status).toBe(200);
  });

  it('rejects a token minted before tokenVersion was bumped', async () => {
    const staleToken = tokenFor(user, 0);

    // Simulates what suspendUser / restrictUser / revokeUserSessions each do.
    await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
    resetTokenVersionCache(); // stand in for the invalidate() call those services make

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${staleToken}`);

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/revoked/i);
  });

  it('accepts a freshly minted token after a bump', async () => {
    await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
    resetTokenVersionCache();

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokenFor(user, 1)}`);

    expect(res.status).toBe(200);
  });

  it('treats a legacy token with no tv claim as version 0', async () => {
    // Sessions live at deploy time carry no `tv`; they must keep working until something
    // actually revokes them, rather than all being invalidated at once on release.
    const legacyToken = generateAccessToken({ sub: user._id.toString(), role: user.role });

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${legacyToken}`);

    expect(res.status).toBe(200);
  });

  it('rejects a legacy token once the user has been revoked', async () => {
    const legacyToken = generateAccessToken({ sub: user._id.toString(), role: user.role });
    await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
    resetTokenVersionCache();

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${legacyToken}`);

    expect(res.status).toBe(401);
  });

  it('rejects a token belonging to a user that no longer exists', async () => {
    const token = tokenFor(user, 0);
    await User.deleteOne({ _id: user._id });
    resetTokenVersionCache();

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('still rejects a token with a bad signature', async () => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer not.a.real.token');

    expect(res.status).toBe(401);
  });
});

describe('Suspension terminates live sessions', () => {
  beforeAll(async () => {
    await connectTestDB();
  });
  afterAll(async () => {
    await closeTestDB();
  });
  beforeEach(async () => {
    await clearTestDB();
    resetTokenVersionCache();
  });

  it('invalidates an outstanding access token when a user is suspended', async () => {
    const userService = (await import('../../src/modules/users/user.service.js')).default;
    const target = await User.create({
      name: 'Suspend Probe',
      email: 'suspend@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'client',
      isEmailVerified: true,
      tokenVersion: 0,
    });
    const liveToken = generateAccessToken({
      sub: target._id.toString(),
      role: 'client',
      tv: 0,
    });

    const before = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${liveToken}`);
    expect(before.status).toBe(200);

    await userService.suspendUser(target._id.toString(), new mongoose.Types.ObjectId(), 'abuse');

    const after = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${liveToken}`);

    // Suspension must not merely block future logins — the live session dies too.
    expect(after.status).toBe(401);
  });

  it('rejects an authenticated request with 403 when user is blocked', async () => {
    const target = await User.create({
      name: 'Blocked User',
      email: 'blocked@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'client',
      isEmailVerified: true,
      accountStatus: 'blocked',
      tokenVersion: 1,
    });
    const token = generateAccessToken({
      sub: target._id.toString(),
      role: 'client',
      tv: 1,
    });

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Account blocked/i);
  });

  it('rejects an authenticated request with 403 when user is suspended with current tokenVersion', async () => {
    const target = await User.create({
      name: 'Suspended User',
      email: 'suspended-tv@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'client',
      isEmailVerified: true,
      accountStatus: 'suspended',
      tokenVersion: 1,
    });
    const token = generateAccessToken({
      sub: target._id.toString(),
      role: 'client',
      tv: 1,
    });

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Account suspended/i);
  });
});
