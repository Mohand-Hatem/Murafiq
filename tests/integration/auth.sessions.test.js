import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../../src/app.js';
import User from '../../src/modules/users/user.model.js';
import sessionRepository from '../../src/modules/auth/session.repository.js';
import { _reset as resetSessionCache } from '../../src/common/utils/tokenVersionCache.js';
import { connectTestDB, closeTestDB, clearTestDB } from '../setup/db-handler.js';

/**
 * Multi-device session tests against a REAL MongoDB replica set and the REAL User schema.
 *
 * Nothing here is mocked. The previous auth suite mocked `authRepository` and supplied a
 * fake user carrying a `refreshTokenHash`, which is exactly why a completely broken
 * refresh flow shipped with a green test run. These tests assert real persistence.
 */

const PASSWORD = 'CorrectHorse1!';
let user;

const makeUser = async (over = {}) =>
  User.create({
    name: 'Session User',
    email: `s${Date.now()}${Math.random().toString(36).slice(2, 7)}@murafiq.test`,
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    role: 'client',
    isEmailVerified: true,
    ...over,
  });

const login = (email, clientType = 'mobile', deviceName) => {
  const req = request(app).post('/api/v1/auth/login').set('x-client-type', clientType);
  if (deviceName) req.set('x-device-name', deviceName);
  return req.send({ email, password: PASSWORD });
};

const refresh = (token) =>
  request(app)
    .post('/api/v1/auth/refresh-token')
    .set('x-client-type', 'mobile')
    .send({ refreshToken: token });

const sessionsOf = async (id) => {
  const doc = await User.findById(id).select('+sessions').lean();
  return doc?.sessions || [];
};

const tokenVersionOf = async (id) => (await User.findById(id).lean()).tokenVersion;

beforeAll(async () => {
  await connectTestDB();
});
afterAll(async () => {
  await closeTestDB();
});
beforeEach(async () => {
  await clearTestDB();
  resetSessionCache();
  user = await makeUser();
});

describe('Login persists a session', () => {
  it('stores exactly one session, hashed, and never returns the hash', async () => {
    const res = await login(user.email);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();

    const sessions = await sessionsOf(user._id);
    expect(sessions).toHaveLength(1);

    // The stored value must be a hash of the token, never the token itself.
    expect(sessions[0].tokenHash).not.toBe(res.body.data.refreshToken);
    expect(sessions[0].tokenHash).toBe(sessionRepository.hashToken(res.body.data.refreshToken));
    expect(JSON.stringify(res.body)).not.toContain(sessions[0].tokenHash);
  });

  it('labels the device', async () => {
    await login(user.email, 'mobile', 'Karim iPhone 15');
    const [s] = await sessionsOf(user._id);
    expect(s.deviceLabel).toContain('Karim iPhone 15');
  });
});

describe('Multi-device', () => {
  it('three logins create three independent sessions', async () => {
    const chrome = await login(user.email, 'web', 'Chrome');
    const iphone = await login(user.email, 'mobile', 'iPhone');
    const android = await login(user.email, 'mobile', 'Android');

    expect(await sessionsOf(user._id)).toHaveLength(3);

    // Every refresh token still works — a new login must not evict the others.
    for (const tok of [iphone.body.data.refreshToken, android.body.data.refreshToken]) {
      const r = await refresh(tok);
      expect(r.status).toBe(200);
    }
    expect(chrome.headers['set-cookie']).toBeDefined();
  });
});

describe('Refresh rotation', () => {
  it('issues a new pair and rejects the old refresh token', async () => {
    const { body } = await login(user.email);
    const oldToken = body.data.refreshToken;

    const first = await refresh(oldToken);
    expect(first.status).toBe(200);
    expect(first.body.data.refreshToken).not.toBe(oldToken);

    // Rotation replaces in place — it must not accumulate sessions.
    expect(await sessionsOf(user._id)).toHaveLength(1);

    const replay = await refresh(oldToken);
    expect(replay.status).toBe(401);
  });

  it('updates lastUsedAt', async () => {
    const { body } = await login(user.email);
    const before = (await sessionsOf(user._id))[0].lastUsedAt;
    await new Promise((r) => setTimeout(r, 20));
    await refresh(body.data.refreshToken);
    const after = (await sessionsOf(user._id))[0].lastUsedAt;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });
});

describe('Refresh-token reuse detection', () => {
  it('revokes ONLY the affected session when a superseded token is replayed', async () => {
    const a = await login(user.email, 'mobile', 'Phone A');
    const b = await login(user.email, 'mobile', 'Phone B');
    expect(await sessionsOf(user._id)).toHaveLength(2);

    const stolen = a.body.data.refreshToken;
    await refresh(stolen); // the legitimate rotation supersedes `stolen`

    const before = await tokenVersionOf(user._id);

    // The attacker replays the token the real user already rotated away.
    const reuse = await refresh(stolen);
    expect(reuse.status).toBe(401);

    // Only the compromised chain dies. Revoking every device would turn a single
    // mis-timed client retry into a sign-out everywhere — a self-inflicted outage on
    // the far more common benign cause.
    expect(await sessionsOf(user._id)).toHaveLength(1);

    // Phone B is untouched and still works.
    expect((await refresh(b.body.data.refreshToken)).status).toBe(200);

    // tokenVersion is reserved for GLOBAL revocation and must not move here.
    expect(await tokenVersionOf(user._id)).toBe(before);
  });

  it('kills the reused session so its later tokens stop working too', async () => {
    const a = await login(user.email, 'mobile', 'Phone A');
    const stolen = a.body.data.refreshToken;

    const rotated = await refresh(stolen);
    const currentToken = rotated.body.data.refreshToken;

    await refresh(stolen); // reuse — revokes the session

    // Even the legitimate holder's current token is now dead: the session is gone.
    expect((await refresh(currentToken)).status).toBe(401);
    expect(await sessionsOf(user._id)).toHaveLength(0);
  });
});

describe('Concurrency', () => {
  it('two simultaneous refreshes with the same token do not both succeed', async () => {
    const { body } = await login(user.email);
    const tok = body.data.refreshToken;

    const [r1, r2] = await Promise.all([refresh(tok), refresh(tok)]);

    // Exactly one wins the atomic swap; the loser is handled as reuse.
    const ok = [r1, r2].filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);

    // The loser's reuse response revokes this session only — it must never escalate to a
    // global tokenVersion bump, or a racing client would sign the user out everywhere.
    expect(await tokenVersionOf(user._id)).toBe(0);
  });
});

describe('Logout', () => {
  it('current-device logout leaves other devices signed in', async () => {
    const iphone = await login(user.email, 'mobile', 'iPhone');
    const android = await login(user.email, 'mobile', 'Android');
    expect(await sessionsOf(user._id)).toHaveLength(2);

    const out = await request(app)
      .post('/api/v1/auth/logout')
      .set('x-client-type', 'mobile')
      .set('Authorization', `Bearer ${iphone.body.data.accessToken}`)
      .send({ refreshToken: iphone.body.data.refreshToken });
    expect(out.status).toBe(200);
    expect(await sessionsOf(user._id)).toHaveLength(1);

    // Android is untouched and can still refresh.
    expect((await refresh(android.body.data.refreshToken)).status).toBe(200);
    // The logged-out device cannot.
    expect((await refresh(iphone.body.data.refreshToken)).status).toBe(401);
  });

  it('current-device logout does NOT bump tokenVersion', async () => {
    const s = await login(user.email);
    const before = await tokenVersionOf(user._id);
    await request(app)
      .post('/api/v1/auth/logout')
      .set('x-client-type', 'mobile')
      .set('Authorization', `Bearer ${s.body.data.accessToken}`)
      .send({ refreshToken: s.body.data.refreshToken });
    // Bumping here would sign the user out of every other device too.
    expect(await tokenVersionOf(user._id)).toBe(before);
  });

  it('logout-all clears every session and invalidates access tokens', async () => {
    const a = await login(user.email, 'mobile', 'A');
    const b = await login(user.email, 'mobile', 'B');

    const res = await request(app)
      .post('/api/v1/auth/logout-all')
      .set('x-client-type', 'mobile')
      .set('Authorization', `Bearer ${a.body.data.accessToken}`);
    expect(res.status).toBe(200);
    expect(await sessionsOf(user._id)).toHaveLength(0);

    resetSessionCache();
    const me = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${b.body.data.accessToken}`);
    expect(me.status).toBe(401);
  });
});

describe('Password events revoke everything', () => {
  it('password change bumps tokenVersion and clears sessions', async () => {
    const s = await login(user.email);
    const before = await tokenVersionOf(user._id);

    const res = await request(app)
      .patch('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${s.body.data.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: 'BrandNewPass9!' });
    expect(res.status).toBe(200);

    expect(await sessionsOf(user._id)).toHaveLength(0);
    expect(await tokenVersionOf(user._id)).toBe(before + 1);

    resetSessionCache();
    const me = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${s.body.data.accessToken}`);
    expect(me.status).toBe(401); // an attacker's live token is now dead
  });

  it('password reset bumps tokenVersion and clears sessions', async () => {
    const otp = '123456';
    await User.updateOne(
      { _id: user._id },
      {
        otpCode: await bcrypt.hash(otp, 4),
        otpExpiresAt: new Date(Date.now() + 600000),
        otpAttempts: 0,
      }
    );
    await login(user.email);
    const before = await tokenVersionOf(user._id);

    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: user.email, otp, newPassword: 'ResetPass9!' });
    expect(res.status).toBe(200);

    expect(await sessionsOf(user._id)).toHaveLength(0);
    expect(await tokenVersionOf(user._id)).toBe(before + 1);
  });
});

describe('Account status cannot be bypassed', () => {
  it('a blocked user cannot refresh into a new session', async () => {
    const s = await login(user.email);
    await User.updateOne({ _id: user._id }, { accountStatus: 'blocked' });
    resetSessionCache();

    // 403, not 401 — the account is the problem, so the client must not just retry auth.
    expect((await refresh(s.body.data.refreshToken)).status).toBe(403);
  });

  it('a blocked user cannot log in', async () => {
    await User.updateOne({ _id: user._id }, { accountStatus: 'blocked' });
    expect((await login(user.email)).status).toBe(403);
  });

  it('admin session revocation kills refresh and access tokens', async () => {
    const s = await login(user.email);
    const userService = (await import('../../src/modules/users/user.service.js')).default;
    await userService.revokeUserSessions(user._id.toString(), null);

    expect(await sessionsOf(user._id)).toHaveLength(0);
    resetSessionCache();

    expect((await refresh(s.body.data.refreshToken)).status).toBe(401);
    const me = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${s.body.data.accessToken}`);
    expect(me.status).toBe(401);
  });
});

describe('Session listing', () => {
  it('lists devices without exposing token hashes', async () => {
    const s = await login(user.email, 'mobile', 'iPhone');
    await login(user.email, 'mobile', 'Android');

    const res = await request(app)
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${s.body.data.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(JSON.stringify(res.body)).not.toContain('tokenHash');
    expect(res.body.data[0]).toHaveProperty('deviceLabel');
  });
});

describe('Session cap', () => {
  it('evicts the oldest session past the configured maximum', async () => {
    const env = (await import('../../src/config/env.config.js')).default;
    const max = env.MAX_SESSIONS_PER_USER;
    for (let i = 0; i < max + 3; i += 1) {
      await login(user.email, 'mobile', `Device ${i}`);
    }
    const sessions = await sessionsOf(user._id);
    expect(sessions).toHaveLength(max);
    expect(sessions[0].deviceLabel).toContain('Device 3'); // 0, 1, 2 evicted
  });
});
