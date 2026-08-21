import * as dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Secrets/credentials get a dev-only fallback so local setup stays frictionless;
// in production the same field becomes required (no default), so a misconfigured
// deploy fails at boot instead of silently running on placeholder values.
const isProd = process.env.NODE_ENV === 'production';
const secret = (devDefault) => (isProd ? z.string().min(1) : z.string().default(devDefault));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('4000'),
  MONGO_URI: secret('mongodb://127.0.0.1:27017/murafiq'),
  JWT_ACCESS_SECRET: secret('dev_access_secret_change_me_in_prod'),
  JWT_REFRESH_SECRET: secret('dev_refresh_secret_change_me_in_prod'),
  // ID-token verification only needs the audience (client ID) — no client secret, since there's
  // no server-side authorization-code exchange (the client hands us an already-signed ID token).
  GOOGLE_CLIENT_ID: secret('dev-google-client-id.apps.googleusercontent.com'),
  REDIS_URL: secret('redis://127.0.0.1:6379'),
  CLOUDINARY_CLOUD_NAME: secret('my_cloud_name'),
  CLOUDINARY_API_KEY: secret('my_api_key'),
  CLOUDINARY_API_SECRET: secret('my_api_secret'),
  MAIL_PROVIDER: z.enum(['resend', 'sendgrid']).default('resend'),
  RESEND_API_KEY: secret('re_dev_key_change_me_in_prod'),
  MAIL_FROM_ADDRESS: secret('no-reply@murafiq.dev'),
  // Dev-only: redirect ALL outgoing emails to this address (sandbox workaround).
  // Leave empty or remove in production to send to the actual recipient.
  MAIL_TO_ADDRESS: z.string().optional(),
  PAYMENT_PROVIDER: z.enum(['mock', 'paymob']).default('mock'),
  PAYMOB_SECRET_KEY: secret('sk_test_placeholder'),
  PAYMOB_PUBLIC_KEY: secret('pk_test_placeholder'),
  PAYMOB_HMAC_SECRET: secret('dev_hmac_placeholder'),
  PAYMOB_CARD_INTEGRATION_ID: secret('123456'),
  PAYMOB_WALLET_INTEGRATION_ID: z.string().optional(),
  PAYMOB_BASE_URL: z.string().default('https://accept.paymob.com'),
  PAYMOB_NOTIFICATION_URL: z.string().optional(),
  PAYMOB_REDIRECTION_URL: z.string().optional(),
  CLIENT_URL: z.string().default('http://localhost:3000'),
  PLATFORM_FEE_PERCENTAGE: z.string().default('15').transform(Number),
  FIREBASE_PROJECT_ID: secret('murafiq-dev'),
  FIREBASE_CLIENT_EMAIL: secret('firebase-adminsdk@murafiq-dev.iam.gserviceaccount.com'),
  FIREBASE_PRIVATE_KEY: secret('dev_firebase_private_key_change_me_in_prod'),
  // Required starting Phase 14 (wardrobe photo classification/embedding) — added now so the
  // schema doesn't drift from what Phases 9/14/15 already assume is there.
  OPENAI_API_KEY: secret('sk-dev-key-change-me-in-prod'),
  VECTOR_DB_URL: secret('https://dev-vector-db.local'),
  VECTOR_DB_API_KEY: secret('dev_vector_db_key_change_me_in_prod'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export default parsed.data;
