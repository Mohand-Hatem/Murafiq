import { describe, it, expect } from '@jest/globals';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envConfigUrl = pathToFileURL(path.join(__dirname, '../../src/config/env.config.js')).href;

/**
 * Regression guard for docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X6: NODE_ENV defaulted
 * to 'development' (so a deploy that forgot to set it silently ran on placeholder JWT
 * secrets instead of failing to boot), and nothing checked whether a real production
 * .env still held the literal placeholder value even when NODE_ENV WAS correctly set to
 * 'production' -- which is the exact state this repository's own working-tree .env was
 * found in during the audit.
 */
// A realistic-looking value for every other `secret()`-wrapped field, so a production
// run only fails on the one thing each test is actually checking (the JWT secrets) and
// not on unrelated fields this repository's real .env happens not to define.
const OTHER_REQUIRED_PROD_SECRETS = {
  MONGO_URI: 'mongodb://prod-host/murafiq',
  GOOGLE_CLIENT_ID: 'real-google-client-id.apps.googleusercontent.com',
  CLOUDINARY_CLOUD_NAME: 'real-cloud',
  CLOUDINARY_API_KEY: 'real-cloudinary-key',
  CLOUDINARY_API_SECRET: 'real-cloudinary-secret',
  RESEND_API_KEY: 're_real_key',
  MAIL_FROM_ADDRESS: 'no-reply@murafiq.app',
  MOCK_WEBHOOK_SECRET: 'real-mock-webhook-secret',
  PAYMOB_SECRET_KEY: 'sk_live_real',
  PAYMOB_PUBLIC_KEY: 'pk_live_real',
  PAYMOB_HMAC_SECRET: 'real-hmac-secret',
  PAYMOB_CARD_INTEGRATION_ID: '999999',
  PAYMOB_API_KEY: 'real-legacy-api-key',
  FIREBASE_PROJECT_ID: 'murafiq-prod',
  FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk@murafiq-prod.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: 'real-firebase-private-key',
  REDIS_URL: 'redis://prod-host:6379',
  GEMINI_API_KEY: 'real-gemini-key',
  UPSTASH_VECTOR_REST_URL: 'https://real-vector.upstash.io',
  UPSTASH_VECTOR_REST_TOKEN: 'real-upstash-token',
};

describe('env.config.js — production secret hardening', () => {
  const run = (extraEnv) => {
    const script =
      "import('" +
      envConfigUrl +
      "').then(function () { console.log('BOOTED'); })" +
      ".catch(function () { console.log('CRASHED'); });";
    const isProd = extraEnv.NODE_ENV === 'production';
    return spawnSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          ...(isProd ? OTHER_REQUIRED_PROD_SECRETS : {}),
          ...extraEnv,
        },
      }
    );
  };

  it('refuses to boot with no NODE_ENV set at all', () => {
    const result = run({ NODE_ENV: '' });
    expect(result.status).not.toBe(0);
  });

  it('refuses to boot in production with the placeholder JWT_ACCESS_SECRET', () => {
    const result = run({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'dev_access_secret_change_me_in_prod',
      JWT_REFRESH_SECRET: 'a-real-unique-production-refresh-secret',
      MONGO_URI: 'mongodb://real-host/prod',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/placeholder/i);
  });

  it('refuses to boot in production with the placeholder JWT_REFRESH_SECRET', () => {
    const result = run({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'a-real-unique-production-access-secret',
      JWT_REFRESH_SECRET: 'dev_refresh_secret_change_me_in_prod',
      MONGO_URI: 'mongodb://real-host/prod',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/placeholder/i);
  });

  it('boots normally in development with the default placeholder secrets', () => {
    const result = run({ NODE_ENV: 'development' });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/BOOTED/);
  });
});
