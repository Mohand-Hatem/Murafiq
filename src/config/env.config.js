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
  // Token lifetimes, previously hardcoded in generateTokens.js. Any `ms`-style string
  // jsonwebtoken accepts ('15m', '30d', '2h'). The access token is deliberately short:
  // it is the only credential that cannot be revoked without the tokenVersion check.
  ACCESS_TOKEN_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('30d'),
  // Hard ceiling on simultaneous signed-in devices. The oldest session is evicted past
  // this, so a user cannot accumulate credentials indefinitely.
  MAX_SESSIONS_PER_USER: z.string().default('10').transform(Number),
  // ID-token verification only needs the audience (client ID) — no client secret, since there's
  // no server-side authorization-code exchange (the client hands us an already-signed ID token).
  GOOGLE_CLIENT_ID: secret('dev-google-client-id.apps.googleusercontent.com'),
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
  MOCK_WEBHOOK_SECRET: secret('dev_mock_webhook_secret'),
  PAYMOB_SECRET_KEY: secret('sk_test_placeholder'),
  PAYMOB_PUBLIC_KEY: secret('pk_test_placeholder'),
  PAYMOB_HMAC_SECRET: secret('dev_hmac_placeholder'),
  PAYMOB_CARD_INTEGRATION_ID: secret('123456'),
  // Paymob's LEGACY api_key (Settings → Account Info in the Paymob dashboard) — distinct from
  // PAYMOB_SECRET_KEY. Only the classic refund endpoint (api/acceptance/void_refund/refund)
  // needs it: it's exchanged for a short-lived auth_token via POST /api/auth/tokens before
  // each refund call. The Intention API used for initialize()/webhooks doesn't need this.
  PAYMOB_API_KEY: secret('paymob_legacy_api_key_placeholder'),
  PAYMOB_WALLET_INTEGRATION_ID: z.string().optional(),
  PAYMOB_BASE_URL: z.string().default('https://accept.paymob.com'),
  PAYMOB_NOTIFICATION_URL: z.string().optional(),
  PAYMOB_REDIRECTION_URL: z.string().optional(),
  // The FRONTEND origin — used for CORS and for building user-facing redirect links.
  CLIENT_URL: z.string().default('http://localhost:3000'),
  // This BACKEND's own public origin. Distinct from CLIENT_URL: payment webhooks must be
  // delivered here, not to the frontend. In production this is the public API hostname.
  API_URL: z.string().default('http://localhost:4000'),
  PLATFORM_FEE_PERCENTAGE: z.string().default('15').transform(Number),
  FIREBASE_PROJECT_ID: secret('murafiq-dev'),
  FIREBASE_CLIENT_EMAIL: secret('firebase-adminsdk@murafiq-dev.iam.gserviceaccount.com'),
  FIREBASE_PRIVATE_KEY: secret('dev_firebase_private_key_change_me_in_prod'),
  // Reserved for Phase 14 (wardrobe photo classification/embedding). Nothing reads these yet,
  // so they are OPTIONAL — making them required in production would force a v1 deploy to supply
  // four meaningless secrets or fail at boot. Promote back to secret() in Phase 14, when the
  // wardrobe classification worker actually calls them.
  OPENAI_API_KEY: z.string().optional(),
  VECTOR_DB_URL: z.string().optional(),
  VECTOR_DB_API_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export default parsed.data;
