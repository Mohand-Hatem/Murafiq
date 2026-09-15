import * as dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Secrets/credentials get a dev-only fallback so local setup stays frictionless;
// in production the same field becomes required (no default), so a misconfigured
// deploy fails at boot instead of silently running on placeholder values.
const isProd = process.env.NODE_ENV === 'production';
const secret = (devDefault) => (isProd ? z.string().min(1) : z.string().default(devDefault));

const envSchema = z.object({
  // No default: an environment must say what it is. A default of 'development' here
  // previously meant a deploy that simply forgot to set NODE_ENV=production booted
  // silently as development -- which lets every `secret()` field above fall back to its
  // well-known placeholder value instead of failing to boot. See
  // docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X6. `npm start`/`npm run dev` set this
  // explicitly via `cross-env` (package.json) so local development is unaffected.
  NODE_ENV: z.enum(['development', 'production', 'test']),
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
  // Phase 14: Redis & BullMQ queue connection
  REDIS_URL: secret('redis://127.0.0.1:6379'),
  // Phase 14 & 15: Google Gemini Multimodal Vision & Reasoning API Key
  GEMINI_API_KEY: secret('dev_gemini_api_key_placeholder'),
  // Phase 14 & 15: Upstash Vector DB REST credentials (namespaced per client)
  UPSTASH_VECTOR_REST_URL: secret('https://dev-vector.upstash.io'),
  UPSTASH_VECTOR_REST_TOKEN: secret('dev_upstash_vector_token_placeholder'),
  // Phase 15D: Upstash Knowledge Vector Index (isolated from wardrobe closet index)
  UPSTASH_KB_VECTOR_REST_URL: secret('https://dev-kb-vector.upstash.io'),
  UPSTASH_KB_VECTOR_REST_TOKEN: secret('dev_upstash_kb_vector_token_placeholder'),
  // Phase 15: Configurable model IDs (defaults to gemini-3.1-flash-lite for all tasks)
  AI_MODEL_VISION: z.string().default('gemini-3.1-flash-lite'),
  AI_MODEL_REASONING: z.string().default('gemini-3.1-flash-lite'),
  // Phase 15F: Virtual Try-On experimental subsystem
  AI_TRY_ON_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  AI_IMAGE_PROVIDER: z.enum(['gemini', 'mock', 'openrouter']).default('gemini'),
  AI_MODEL_IMAGE: z.string().default('gemini-3.1-flash-lite-image'),
  AI_IMAGE_RESOLUTION: z.enum(['512x512', '1024x1024']).default('1024x1024'),
  OPENROUTER_API_KEY: z.string().optional(),
  AI_TRY_ON_MODEL: z.string().default('google/gemini-3.1-flash-lite-image'),
  AI_TRY_ON_TIMEOUT_MS: z.coerce.number().default(60000),
  // Moderation enforcement switch (see moderation.service.js scanAndEnforce). This field
  // was previously read from `env.MODERATION_MODE` with no schema entry -- Zod's default
  // object parsing strips any key not declared here, so the read was permanently
  // `undefined` and enforcement could never leave DRY_RUN regardless of the actual
  // environment variable. See docs/archive/audits/AUDIT_2026_09_FULL_SYSTEM.md finding X2.
  MODERATION_MODE: z.enum(['DRY_RUN', 'ENFORCE']).default('DRY_RUN'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

// Belt-and-braces beyond the isProd/secret() split above: those only make an UNSET secret
// fail to boot in production. They do nothing if an operator's real production .env was
// created by copying .env.example and never editing it -- the exact state this audit found
// on this repository's own working tree (finding X6). Refuse to boot on the two
// authentication secrets specifically, since a forged token signed with either is a full
// account-takeover / privilege-escalation primitive.
if (parsed.data.NODE_ENV === 'production') {
  const placeholders = {
    JWT_ACCESS_SECRET: 'dev_access_secret_change_me_in_prod',
    JWT_REFRESH_SECRET: 'dev_refresh_secret_change_me_in_prod',
    FIREBASE_PRIVATE_KEY: 'dev_firebase_private_key_change_me_in_prod',
    GEMINI_API_KEY: 'dev_gemini_api_key_placeholder',
    UPSTASH_VECTOR_REST_URL: 'https://dev-vector.upstash.io',
    UPSTASH_VECTOR_REST_TOKEN: 'dev_upstash_vector_token_placeholder',
    PAYMOB_API_KEY: 'paymob_legacy_api_key_placeholder',
    PAYMOB_SECRET_KEY: 'sk_test_placeholder',
    PAYMOB_PUBLIC_KEY: 'pk_test_placeholder',
    PAYMOB_HMAC_SECRET: 'dev_hmac_placeholder',
  };
  const stillPlaceholder = Object.entries(placeholders).filter(
    ([key, value]) => parsed.data[key] === value
  );
  if (stillPlaceholder.length > 0) {
    console.error(
      `❌ Refusing to start in production with placeholder value(s) for: ${stillPlaceholder
        .map(([key]) => key)
        .join(', ')}. Set real secrets in your production environment before deploying.`
    );
    process.exit(1);
  }
}

// Loud and unconditional, not gated on NODE_ENV: a silently-wrong moderation mode is
// exactly the failure this line exists to make impossible to miss (see finding X2).
if (process.env.NODE_ENV !== 'test') {
  console.log(`[env] MODERATION_MODE resolved to: ${parsed.data.MODERATION_MODE}`);
}

export default parsed.data;
