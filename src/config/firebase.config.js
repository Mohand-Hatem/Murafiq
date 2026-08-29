import { initializeApp, cert, getApps } from 'firebase-admin/app';
import env from './env.config.js';
import logger from './logger.config.js';

// firebase-admin v12+ dropped the old namespaced default export (admin.credential.cert,
// admin.apps.length, admin.firestore()/.auth()/.messaging()) in favor of this modular API.
//
// getFirestore/getAuth/getMessaging are deliberately NOT imported statically here. The
// firebase-admin/auth submodule's dependency chain (jwks-rsa -> jose, a pure-ESM package) breaks
// under Jest's CJS transform on Node versions without synchronous VM-module support — and a static
// top-level import loads that chain unconditionally, even in the test environment where Firebase
// never actually initializes. Loading them dynamically, only inside the branch where
// isFirebaseInitialized is genuinely true, means the test environment (placeholder credentials,
// isFirebaseInitialized always false) never touches that dependency tree at all.
let isFirebaseInitialized = false;
let app;
let firestoreInstance = null;
let authInstance = null;
let messagingInstance = null;

try {
  const existingApps = getApps();
  if (existingApps.length > 0) {
    app = existingApps[0];
    isFirebaseInitialized = true;
  } else if (
    env.FIREBASE_PRIVATE_KEY &&
    !env.FIREBASE_PRIVATE_KEY.includes('change_me') &&
    !env.FIREBASE_PRIVATE_KEY.includes('placeholder')
  ) {
    const formattedPrivateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
    app = initializeApp({
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: formattedPrivateKey,
      }),
    });
    isFirebaseInitialized = true;
    logger.info('Firebase Admin initialized successfully');
  } else {
    if (env.NODE_ENV === 'production') {
      throw new Error('Firebase Admin credentials missing or placeholder in production environment');
    }
    logger.warn('Firebase Admin running in mock/uninitialized mode (placeholder credentials detected)');
  }

  if (isFirebaseInitialized) {
    const [{ getFirestore }, { getAuth }, { getMessaging }] = await Promise.all([
      import('firebase-admin/firestore'),
      import('firebase-admin/auth'),
      import('firebase-admin/messaging'),
    ]);
    firestoreInstance = getFirestore(app);
    authInstance = getAuth(app);
    messagingInstance = getMessaging(app);
  }
} catch (error) {
  if (env.NODE_ENV === 'production') {
    logger.error(`Fatal Firebase initialization error in production: ${error.message}`);
    throw error;
  }
  logger.warn(`Firebase Admin initialization skipped or failed: ${error.message}`);
  isFirebaseInitialized = false;
}

export const isFirebaseConnected = isFirebaseInitialized;
export const firestore = firestoreInstance;
export const auth = authInstance;
export const messaging = messagingInstance;

export default { initializeApp, cert, getApps };
