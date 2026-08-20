import { jest } from '@jest/globals';
import bcrypt from 'bcrypt';
import '../../src/common/globals.js';

const mockCreateUser = jest.fn();
const mockFindByEmail = jest.fn();
const mockFindById = jest.fn();
const mockFindByGoogleId = jest.fn();
const mockSendMail = jest.fn();
const mockVerifyIdToken = jest.fn();

jest.unstable_mockModule('../../src/modules/auth/auth.repository.js', () => ({
  default: {
    createUser: mockCreateUser,
    findByEmail: mockFindByEmail,
    findById: mockFindById,
    findByGoogleId: mockFindByGoogleId,
  },
}));

jest.unstable_mockModule('../../src/modules/mail/mail.service.js', () => ({
  default: { sendMail: mockSendMail },
}));

class MockOAuth2Client {
  verifyIdToken(...args) {
    return mockVerifyIdToken(...args);
  }
}
jest.unstable_mockModule('google-auth-library', () => ({ OAuth2Client: MockOAuth2Client }));

const { default: authService } = await import('../../src/modules/auth/auth.service.js');
const { registerSchema } = await import('../../src/modules/auth/auth.validator.js');

const KNOWN_PASSWORD = 'CorrectHorse123';
const KNOWN_OTP = '123456';

const makeMockUser = async (overrides = {}) => {
  const passwordHash = overrides.passwordHash ?? (await bcrypt.hash(KNOWN_PASSWORD, 4));
  const otpCode = overrides.otpCode === null ? undefined : (overrides.otpCode ?? (await bcrypt.hash(KNOWN_OTP, 4)));

  const user = {
    _id: { toString: () => 'user-id-123' },
    name: 'Test User',
    email: 'test@example.com',
    role: 'client',
    isEmailVerified: false,
    accountStatus: 'active',
    otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    refreshTokenHash: undefined,
    ...overrides,
    passwordHash,
    otpCode,
  };
  user.save = jest.fn().mockResolvedValue(user);
  return user;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('authService.register', () => {
  it('creates a user with a hashed password/OTP and sends the verification email (happy path)', async () => {
    const created = await makeMockUser({ isEmailVerified: false });
    mockCreateUser.mockResolvedValue(created);

    const result = await authService.register({
      name: 'Test User',
      email: 'test@example.com',
      password: KNOWN_PASSWORD,
      role: 'client',
    });

    expect(mockCreateUser).toHaveBeenCalledTimes(1);
    const createArgs = mockCreateUser.mock.calls[0][0];
    expect(createArgs.passwordHash).not.toBe(KNOWN_PASSWORD); // never stored in plaintext
    expect(await bcrypt.compare(KNOWN_PASSWORD, createArgs.passwordHash)).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].to).toBe('test@example.com');
    expect(result).toBe(created);
  });
});

describe('authService.verifyEmail', () => {
  it('marks the account verified on a correct, unexpired OTP (happy path)', async () => {
    const user = await makeMockUser();
    mockFindByEmail.mockResolvedValue(user);

    const result = await authService.verifyEmail({ email: 'test@example.com', otp: KNOWN_OTP });

    expect(result.isEmailVerified).toBe(true);
    expect(result.otpCode).toBeUndefined();
    expect(user.save).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired OTP even if the code itself is correct (failure path)', async () => {
    const user = await makeMockUser({ otpExpiresAt: new Date(Date.now() - 1000) });
    mockFindByEmail.mockResolvedValue(user);

    await expect(authService.verifyEmail({ email: 'test@example.com', otp: KNOWN_OTP })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('rejects an incorrect OTP (failure path)', async () => {
    const user = await makeMockUser();
    mockFindByEmail.mockResolvedValue(user);

    await expect(authService.verifyEmail({ email: 'test@example.com', otp: '000000' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('authService.login', () => {
  it('issues access/refresh tokens for correct credentials on a verified account (happy path)', async () => {
    const user = await makeMockUser({ isEmailVerified: true });
    mockFindByEmail.mockResolvedValue(user);

    const result = await authService.login({ email: 'test@example.com', password: KNOWN_PASSWORD });

    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(user.refreshTokenHash).toBeTruthy();
    expect(user.save).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong password with the generic "Invalid credentials" message (failure path, no enumeration)', async () => {
    const user = await makeMockUser({ isEmailVerified: true });
    mockFindByEmail.mockResolvedValue(user);

    await expect(authService.login({ email: 'test@example.com', password: 'wrong-password' })).rejects.toMatchObject(
      { statusCode: 401, message: 'Invalid credentials' }
    );
  });

  it('rejects a non-existent email with the same generic message as a wrong password (failure path, no enumeration)', async () => {
    mockFindByEmail.mockResolvedValue(null);

    await expect(
      authService.login({ email: 'nobody@example.com', password: KNOWN_PASSWORD })
    ).rejects.toMatchObject({ statusCode: 401, message: 'Invalid credentials' });
  });

  it('blocks login on an unverified account with a specific message (failure path)', async () => {
    const user = await makeMockUser({ isEmailVerified: false });
    mockFindByEmail.mockResolvedValue(user);

    await expect(authService.login({ email: 'test@example.com', password: KNOWN_PASSWORD })).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('blocks login on a suspended account with a specific message (failure path)', async () => {
    const user = await makeMockUser({ isEmailVerified: true, accountStatus: 'suspended' });
    mockFindByEmail.mockResolvedValue(user);

    await expect(authService.login({ email: 'test@example.com', password: KNOWN_PASSWORD })).rejects.toMatchObject({
      statusCode: 403,
      message: 'Account suspended. Contact support.',
    });
  });
});

describe('authService.resetPassword', () => {
  it('resets the password and invalidates existing sessions on a correct OTP (happy path)', async () => {
    const user = await makeMockUser({ refreshTokenHash: 'some-old-hash' });
    mockFindByEmail.mockResolvedValue(user);

    await authService.resetPassword({ email: 'test@example.com', otp: KNOWN_OTP, newPassword: 'NewPassword123' });

    expect(await bcrypt.compare('NewPassword123', user.passwordHash)).toBe(true);
    expect(user.refreshTokenHash).toBeUndefined();
    expect(user.otpCode).toBeUndefined();
  });

  it('rejects an incorrect OTP and leaves the password unchanged (failure path)', async () => {
    const user = await makeMockUser();
    const originalHash = user.passwordHash;
    mockFindByEmail.mockResolvedValue(user);

    await expect(
      authService.resetPassword({ email: 'test@example.com', otp: '000000', newPassword: 'NewPassword123' })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(user.passwordHash).toBe(originalHash);
  });
});

describe('authService.googleLogin', () => {
  const validGooglePayload = {
    sub: 'google-user-456',
    email: 'newperson@example.com',
    email_verified: true,
    name: 'New Person',
  };

  it('creates a new verified account on a first-time Google sign-in (happy path)', async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => validGooglePayload });
    mockFindByGoogleId.mockResolvedValue(null);
    mockFindByEmail.mockResolvedValue(null);
    const created = await makeMockUser({
      _id: { toString: () => 'new-user-id' },
      email: validGooglePayload.email,
      googleId: validGooglePayload.sub,
      isEmailVerified: true,
      passwordHash: undefined,
    });
    mockCreateUser.mockResolvedValue(created);

    const result = await authService.googleLogin({ idToken: 'valid-token', role: 'client' });

    expect(mockCreateUser).toHaveBeenCalledTimes(1);
    const createArgs = mockCreateUser.mock.calls[0][0];
    expect(createArgs).toMatchObject({ email: validGooglePayload.email, googleId: validGooglePayload.sub, isEmailVerified: true });
    expect(result.accessToken).toEqual(expect.any(String));
  });

  it('logs an existing Google user straight in on a repeat sign-in (happy path)', async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => validGooglePayload });
    const existing = await makeMockUser({ googleId: validGooglePayload.sub, isEmailVerified: true, passwordHash: undefined });
    mockFindByGoogleId.mockResolvedValue(existing);

    const result = await authService.googleLogin({ idToken: 'valid-token', role: 'client' });

    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(result.accessToken).toEqual(expect.any(String));
  });

  it('auto-links to an existing local-password account sharing the same verified email (happy path)', async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => validGooglePayload });
    mockFindByGoogleId.mockResolvedValue(null);
    const localAccount = await makeMockUser({ email: validGooglePayload.email, isEmailVerified: false, googleId: undefined });
    mockFindByEmail.mockResolvedValue(localAccount);

    await authService.googleLogin({ idToken: 'valid-token', role: 'client' });

    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(localAccount.googleId).toBe(validGooglePayload.sub);
    expect(localAccount.isEmailVerified).toBe(true);
  });

  it('rejects an invalid/unverifiable Google token (failure path)', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'));

    await expect(authService.googleLogin({ idToken: 'garbage', role: 'client' })).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('rejects a token whose email is not marked verified by Google (failure path)', async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => ({ ...validGooglePayload, email_verified: false }) });

    await expect(authService.googleLogin({ idToken: 'valid-token', role: 'client' })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('blocks Google sign-in on a suspended account (failure path)', async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => validGooglePayload });
    const suspended = await makeMockUser({ googleId: validGooglePayload.sub, accountStatus: 'suspended' });
    mockFindByGoogleId.mockResolvedValue(suspended);

    await expect(authService.googleLogin({ idToken: 'valid-token', role: 'client' })).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

describe('registerSchema validation', () => {
  it('validates a valid registration payload with matching password and confirmpassword', () => {
    const validBody = {
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'Password123!',
      confirmpassword: 'Password123!',
      role: 'client',
    };

    const parsed = registerSchema.body.safeParse(validBody);
    expect(parsed.success).toBe(true);
    expect(parsed.data.name).toBe('Jane Doe');
    expect(parsed.data.email).toBe('jane@example.com');
  });

  it('rejects when confirmpassword does not match password', () => {
    const invalidBody = {
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'Password123!',
      confirmpassword: 'DifferentPassword!',
      role: 'client',
    };

    const parsed = registerSchema.body.safeParse(invalidBody);
    expect(parsed.success).toBe(false);
    expect(parsed.error.issues[0].message).toBe('Passwords do not match');
  });

  it('rejects when name is shorter than 2 characters', () => {
    const invalidBody = {
      name: 'J',
      email: 'jane@example.com',
      password: 'Password123!',
      confirmpassword: 'Password123!',
      role: 'client',
    };

    const parsed = registerSchema.body.safeParse(invalidBody);
    expect(parsed.success).toBe(false);
  });
});
