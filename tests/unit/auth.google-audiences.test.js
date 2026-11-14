import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import { OAuth2Client } from 'google-auth-library';
import env from '../../src/config/env.config.js';
import authService from '../../src/modules/auth/auth.service.js';

// The mobile app's browser sign-in returns ID tokens issued for the Android/iOS client IDs,
// so the server must accept those audiences alongside the Web client ID.
describe('googleLogin token audiences', () => {
  const original = { android: env.GOOGLE_ANDROID_CLIENT_ID, ios: env.GOOGLE_IOS_CLIENT_ID };
  let verifySpy;

  beforeEach(() => {
    verifySpy = jest.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockRejectedValue(new Error('stop'));
  });
  afterEach(() => {
    verifySpy.mockRestore();
    env.GOOGLE_ANDROID_CLIENT_ID = original.android;
    env.GOOGLE_IOS_CLIENT_ID = original.ios;
  });

  it('accepts the Web, Android and iOS client IDs when all are configured', async () => {
    env.GOOGLE_ANDROID_CLIENT_ID = 'android-id.apps.googleusercontent.com';
    env.GOOGLE_IOS_CLIENT_ID = 'ios-id.apps.googleusercontent.com';

    await expect(authService.googleLogin({ idToken: 'x', role: 'client' })).rejects.toMatchObject({ statusCode: 401 });
    expect(verifySpy.mock.calls[0][0].audience).toEqual([
      env.GOOGLE_CLIENT_ID,
      'android-id.apps.googleusercontent.com',
      'ios-id.apps.googleusercontent.com',
    ]);
  });

  it('falls back to the Web client ID alone when the mobile IDs are unset', async () => {
    env.GOOGLE_ANDROID_CLIENT_ID = undefined;
    env.GOOGLE_IOS_CLIENT_ID = undefined;

    await expect(authService.googleLogin({ idToken: 'x', role: 'client' })).rejects.toMatchObject({ statusCode: 401 });
    expect(verifySpy.mock.calls[0][0].audience).toEqual([env.GOOGLE_CLIENT_ID]);
  });
});
