import admin from 'firebase-admin';
import env from './env.config.js';
import logger from './logger.config.js';

let isFirebaseInitialized = false;

try {
  if (admin.apps.length > 0) {
    isFirebaseInitialized = true;
  } else if (
    env.FIREBASE_PRIVATE_KEY &&
    !env.FIREBASE_PRIVATE_KEY.includes('change_me') &&
    !env.FIREBASE_PRIVATE_KEY.includes('placeholder')
  ) {
    const formattedPrivateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
    admin.initializeApp({
      credential: admin.credential.cert({
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
} catch (error) {
  if (env.NODE_ENV === 'production') {
    logger.error(`Fatal Firebase initialization error in production: ${error.message}`);
    throw error;
  }
  logger.warn(`Firebase Admin initialization skipped or failed: ${error.message}`);
}

export const isFirebaseConnected = isFirebaseInitialized;
export const firestore = isFirebaseInitialized ? admin.firestore() : null;
export const auth = isFirebaseInitialized ? admin.auth() : null;
export const messaging = isFirebaseInitialized ? admin.messaging() : null;

export default admin;
