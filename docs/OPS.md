# Murafiq — Operations & Deployment Runbook

This document details deployment requirements, log monitoring, health check semantics, and the production go-live checklist.

---

## 1. Production Health Check (`GET /api/v1/health`)

The health check endpoint provides real-time readiness status for all database and infrastructure dependencies:

### Healthy Response (`200 OK`)
```json
{
  "success": true,
  "message": "Service healthy",
  "data": {
    "status": "UP",
    "timestamp": "2026-08-24T17:00:00.000Z",
    "uptimeSeconds": 86400,
    "services": {
      "mongodb": {
        "status": "connected",
        "readyState": 1
      },
      "firebase": {
        "status": "connected"
      },
      "redis": {
        "status": "disconnected",
        "note": "planned for BullMQ Phase 12"
      }
    }
  }
}
```

### Unhealthy Response (`503 Service Unavailable`)
If MongoDB `readyState !== 1` (connected), the endpoint returns `503 Service Unavailable`, signaling load balancers to remove the instance from traffic routing.

---

## 2. Logging Architecture & Troubleshooting

- **Log Engine:** Winston with Morgan HTTP access logging.
- **Log Destinations:**
  - `logs/error.log` — Contains all uncaught exceptions, 5xx errors, and operational warnings.
  - `logs/combined.log` — Contains all HTTP traffic logs with method, route, status code, response time, and IP.
  - Standard output (Console) — Formatted with colorized timestamps in `development`, JSON format in `production`.

### Common Operational Issues:
1. **Paymob Webhook Signature Failures:**
   - Check `HMAC_SECRET` in `.env`.
   - Ensure the reverse proxy (Nginx / Cloudflare) is passing raw headers without tampering.
2. **Firebase Connection Failures in Production:**
   - In production (`NODE_ENV=production`), Murafiq fails closed on Firebase errors to prevent orphaned messages or unauthenticated chat sessions.
   - Verify `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` formatting (ensure newlines `\n` in private keys are parsed correctly).

---

## 3. Production Go-Live Checklist

Before switching traffic to production, verify every item on this checklist:

- [ ] **Rotate Secrets:** Ensure all secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PAYMOB_HMAC_SECRET`, `ADMIN_PASSWORD`) are randomized strings with $\ge 32$ characters, not development defaults.
- [ ] **Remove Sandbox Redirect:** Ensure `MAIL_TO_ADDRESS` is **removed** or left empty in `.env` so registration and notification emails deliver directly to end users.
- [ ] **Configure Payment Gateway:** Set `PAYMENT_PROVIDER=paymob` and provide production Paymob API keys, HMAC secret, and integration IDs.
- [ ] **Seed Initial Admin:** Run `npm run seed:admin` once to bootstrap the platform superuser.
- [ ] **Seed Subscription Plan Catalogue:** Run `node scripts/seed-plans.js` once per database to populate canonical client and stylist plans. Without this step, `GET /subscriptions/plans` returns empty and every checkout 404s.
- [ ] **Verify Reverse Proxy Configuration:** Ensure `app.set('trust proxy', 1)` is enabled (default in `src/app.js`) and Nginx passes `X-Forwarded-For` and `X-Forwarded-Proto` for accurate rate limiting.
- [ ] **Run Predeploy Checks:** Execute `npm run predeploy` (`scripts/check-duplicate-active-subscriptions.js`) to verify no user holds duplicate active subscriptions before index creation.
- [ ] **Ensure MongoDB Replica Set:** Ensure production MongoDB is deployed as a replica set with oplog enabled for multi-document transaction support.

---

## 4. Maintenance & Seeding Scripts

- **`npm run predeploy` / `node scripts/check-duplicate-active-subscriptions.js` (Required Deploy Gate):**
  Pre-flight check for the partial unique index on Subscription `{ userId }` where `status: 'active'`. Confirms zero users have duplicate active subscriptions before deployment. Fails with exit code 1 if duplicates exist.

- **`node scripts/seed-plans.js` (Required / Production-Safe):**
  Seeds and updates canonical subscription tiers (client and stylist) and entitlements. Also safely migrates legacy `.yearly` rows to the unified pricing schema. Idempotent and safe to run on live environments.

- **`node scripts/reset-subscription-test-data.js` (DEVELOPMENT / TEST ONLY):**
  Cleans up unbacked subscription test data, reverts unpaid test accounts to free tier, and clears test checkout orders and ledger dual-writes. **Hard-refuses to run** when `NODE_ENV=production` (throws immediately to protect immutable accounting records). In production, accounting errors must be corrected with offsetting journal entries, never deletions.

---

## 5. Background Jobs & Database Invariants

### Pre-Sweep Indexes (Task S6.4)
- `Booking`: `{ 'noShowDetails.reportedAt': 1, 'noShowDetails.respondedAt': 1, status: 1 }` with `{ background: true }` to eliminate COLLSCAN during the 15-minute `no-show-resolution` sweep.
- `Offer`: `{ status: 1, expiresAt: 1 }` with `{ background: true }` to index the 5-minute `offer-expiry` sweep.
- `Request`: `{ status: 1, autoPauseAt: 1 }` already indexes the 5-minute `request-autopause` sweep.

### OTP Expiry Safety Invariant (CRITICAL)
- **NEVER add a MongoDB TTL index on `User.otpExpiresAt`.** In MongoDB, a TTL index deletes the **entire containing document**. Adding a TTL index to `otpExpiresAt` on the `User` collection would delete user accounts 10 minutes after receiving an OTP.
- OTP expiration is enforced strictly at point of use (`auth.service.js:132`, `:403` checks `user.otpExpiresAt.getTime() < Date.now()`), and attempts are reset on every reissue (`:106`, `:168`, `:391`). The legacy `otp-cleanup.cron.js` sweep has been removed (Task S6.2) with no replacement needed.


