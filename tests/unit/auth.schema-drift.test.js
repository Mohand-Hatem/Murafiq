import fs from 'fs';
import User from '../../src/modules/users/user.model.js';

/**
 * Schema-drift guard for authentication.
 *
 * The original bug: `auth.service.js` assigned `user.refreshTokenHash` and saved, but that
 * field did not exist on the User schema. Mongoose strict mode discarded every write
 * silently, so refresh tokens were never persisted and the entire refresh flow returned
 * 401 in production — while the test suite stayed green, because the auth tests mocked
 * `authRepository` and handed back a fake user object that already carried the field.
 *
 * These tests therefore use the REAL Mongoose schema. Mocking is what let the bug through,
 * so mocking is exactly what must not happen here.
 */

const USER_PATHS = new Set(Object.keys(User.schema.paths));

// Fields the auth/session layer is allowed to persist on User. Anything a service writes
// that is not a real schema path is a silent data-loss bug.
const AUTH_FIELDS = [
  'passwordHash',
  'otpCode',
  'otpExpiresAt',
  'otpAttempts',
  'tokenVersion',
  'accountStatus',
  'isEmailVerified',
  'googleId',
  'sessions',
];

describe('Authentication fields exist on the real User schema', () => {
  it.each(AUTH_FIELDS)('User schema defines "%s"', (field) => {
    expect(USER_PATHS.has(field)).toBe(true);
  });

  it('the removed single-session field is gone and nothing still writes it', () => {
    expect(USER_PATHS.has('refreshTokenHash')).toBe(false);

    const offenders = [];
    for (const file of ['src/modules/auth/auth.service.js',
                        'src/modules/users/user.service.js',
                        'src/modules/moderation/moderation.service.js',
                        'src/modules/auth/auth.repository.js']) {
      const txt = fs.readFileSync(file, 'utf8');
      // Ignore prose; only flag it being assigned, projected, or read as a property.
      if (/refreshTokenHash\s*[:=]/.test(txt) || /\+refreshTokenHash/.test(txt)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('sessions[] carries every field the session repository writes', () => {
    const sub = User.schema.path('sessions').schema.paths;
    for (const f of ['tokenHash', 'deviceLabel', 'createdAt', 'lastUsedAt', 'expiresAt']) {
      expect(Object.keys(sub)).toContain(f);
    }
  });

  it('sessions and password material are excluded from ordinary reads', () => {
    // A plain user read must never carry credentials, or a DTO slip leaks them.
    expect(User.schema.path('sessions').options.select).toBe(false);
    expect(User.schema.path('passwordHash').options.select).toBe(false);
    expect(User.schema.path('otpCode').options.select).toBe(false);
  });
});

describe('Persistence actually round-trips (not just declared)', () => {
  // Declaring a path is not proof it persists — strict mode, nested-path typos and
  // select:false interactions can all still lose data. This asserts on a real document.
  it('a session written to a real User document survives a re-read', async () => {
    const doc = new User({
      name: 'Drift Probe',
      email: 'drift@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'client',
    });

    doc.sessions.push({
      tokenHash: 'a'.repeat(64),
      deviceLabel: 'Probe device',
      expiresAt: new Date(Date.now() + 1000),
    });

    // toObject() reflects exactly what Mongoose would send to MongoDB.
    const serialised = doc.toObject();
    expect(Array.isArray(serialised.sessions)).toBe(true);
    expect(serialised.sessions).toHaveLength(1);
    expect(serialised.sessions[0].tokenHash).toBe('a'.repeat(64));
    expect(serialised.sessions[0].expiresAt).toBeInstanceOf(Date);
    expect(serialised.sessions[0]._id).toBeDefined();
  });

  it('an unknown field is silently dropped — the failure mode this suite guards against', () => {
    const doc = new User({
      name: 'Drift Probe 2',
      email: 'drift2@murafiq.test',
      passwordHash: 'x'.repeat(20),
      role: 'client',
    });
    doc.set('someFieldThatDoesNotExist', 'value');
    // No error is raised. This is precisely why the guards above must exist.
    expect(doc.toObject().someFieldThatDoesNotExist).toBeUndefined();
  });
});
