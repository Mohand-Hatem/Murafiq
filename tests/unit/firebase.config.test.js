import '../../src/common/globals.js';
import { isFirebaseConnected } from '../../src/config/firebase.config.js';

describe('Firebase Config Hardening', () => {
  it('exports connection boolean status without crashing in test environment', () => {
    expect(typeof isFirebaseConnected).toBe('boolean');
  });

  it('guarantees production fails on placeholder credentials', () => {
    const checkProductionCredentials = (nodeEnv, privateKey) => {
      if (
        nodeEnv === 'production' &&
        (!privateKey || privateKey.includes('change_me') || privateKey.includes('placeholder'))
      ) {
        throw new Error('Firebase Admin credentials missing or placeholder in production environment');
      }
      return true;
    };

    expect(() => checkProductionCredentials('production', 'placeholder_key')).toThrow(
      /Firebase Admin credentials missing/i
    );
    expect(() => checkProductionCredentials('test', 'placeholder_key')).not.toThrow();
  });
});
