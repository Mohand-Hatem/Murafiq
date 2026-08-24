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
- [ ] **Verify Reverse Proxy Configuration:** Ensure `app.set('trust proxy', 1)` is enabled (default in `src/app.js`) and Nginx passes `X-Forwarded-For` and `X-Forwarded-Proto` for accurate rate limiting.
- [ ] **Protect Swagger Documentation:** In production (`NODE_ENV=production`), `/api/docs` automatically requires admin authentication via `authMiddleware` + `restrictTo('admin')`.
- [ ] **Ensure MongoDB Replica Set:** Ensure production MongoDB is deployed as a replica set with oplog enabled for multi-document transaction support.
