# Phase 16 — Deployment Readiness (Final Phase)

## Goal
Deploy Murafiq to production on a manually-provisioned VPS running PM2.

> **Decision recorded 2026-08-24:** this doc previously presented two undecided paths (managed
> PaaS vs self-hosted VPS). The VPS/PM2 path is now the only one — no Docker anywhere, no managed
> PaaS. There was never a Docker setup in this repo to migrate away from; this is a decision being
> written down, not a migration.
>
> **Why not serverless (Vercel etc.):** serverless kills connections after each request. The
> `src/jobs/offer-expiry.cron.js` sweep needs a long-running process, and `server.js`'s graceful
> shutdown (draining requests, closing the Mongo connection) has nothing to do on a platform that
> tears the process down between invocations. A persistent Node process is required either way, so
> a VPS is no more work than a managed PaaS and gives full control over that process.

## Depends on
Phase 13 (security/logging/tests) and Phase 15 (AI module in place — `getOutfitSuggestions` active,
the rest skeleton).

## Infrastructure summary

| Layer | Choice |
|---|---|
| Process manager | PM2, `ecosystem.config.cjs` (repo root) — `fork` mode, `instances: 1` |
| Database | MongoDB **Atlas** (managed) — free/M0 tier is a replica set by default, required for the transactions in `offer.service.js`, `booking.service.js`, `payout.service.js` |
| Reverse proxy / TLS | nginx |
| Containers | None |
| Redis / message queue | None for v1 — see "What v1 deliberately doesn't need" below |
| Background jobs | In-process `node-cron` (`src/jobs/offer-expiry.cron.js`), not BullMQ |

### What v1 deliberately doesn't need

- **No Redis, no BullMQ.** The only recurring job today is the offer-expiry sweep, handled by
  `node-cron` inside the API process. Redis earns its keep once there are multiple job types
  needing retries/backoff/multi-worker — that's Phase 12, not v1.
- **No Postgres.** MongoDB Atlas is the only database.
- **No container layer.** One Node service against a managed database doesn't need the
  reproducibility Docker buys you at this size; it costs a debugging layer nobody benefits from yet.

---

## Steps

### 1. Process management — PM2

The repo already has `ecosystem.config.cjs` at its root — do not write a new one, use it. It pins
`exec_mode: 'fork'` and `instances: 1` **on purpose**: the offer-expiry cron job has no distributed
lock, so cluster mode would run the sweep once per worker on every tick. Read the comment at the top
of that file before changing either setting.

```bash
npm install -g pm2
npm run start:prod        # runs: pm2 start ecosystem.config.cjs --env production
pm2 save                  # persist across reboots
pm2 startup                # generate + run the OS boot script PM2 prints
```

### 2. Reverse proxy — nginx

nginx terminates TLS and proxies to the Node process (default `PORT=4000`). This is **exactly one
proxy hop**, which matters concretely: `app.js` calls `app.set('trust proxy', 1)`. If you ever add a
second hop in front of nginx (a CDN, a load balancer), that value must change or `req.ip` — and every
rate limiter keyed on it — silently breaks.

### 3. Environment variables

Copy `.env.example` to `.env` on the server and fill in production values. **Never commit `.env`.**
Confirm `.gitignore` still excludes it.

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4000` (or whatever nginx proxies to) |
| `MONGO_URI` | Atlas production connection string |
| `CLIENT_URL` | real frontend origin — used for CORS |
| `API_URL` | **this backend's own public origin** (e.g. `https://api.murafiq.app`) — distinct from `CLIENT_URL`. Paymob's `notification_url` is built from this; getting it wrong sends webhooks nowhere. |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | strong random strings, not the dev defaults |
| `RESEND_API_KEY` / `MAIL_FROM_ADDRESS` | production Resend key + verified sending domain |
| `MAIL_TO_ADDRESS` | **must be unset** — dev-only sandbox redirect, see `03_SKELETON_STATUS.md` §4 |
| `CLOUDINARY_*` | production Cloudinary account |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | production Firebase service account |
| `PAYMENT_PROVIDER` | `paymob` — the mock provider is selected by `NODE_ENV=test` only and cannot be chosen any other way, see `payment.service.js#getProvider` |
| `PAYMOB_SECRET_KEY` / `PAYMOB_PUBLIC_KEY` / `PAYMOB_HMAC_SECRET` / `PAYMOB_CARD_INTEGRATION_ID` | production (live) Paymob credentials, not the sandbox ones used in dev |
| `PAYMOB_API_KEY` | production legacy API key — only used by `refund()`'s auth-token exchange |
| `PAYMOB_NOTIFICATION_URL` | explicit `${API_URL}/api/v1/payments/callback` — don't rely on the default in production |
| `PLATFORM_FEE_PERCENTAGE` | your live commission rate |
| `OPENAI_API_KEY` / `VECTOR_DB_URL` / `VECTOR_DB_API_KEY` | optional until Phase 14 — see `env.config.js` |

### 4. Health check endpoint

`GET /api/v1/health` returns `200` when Mongo is reachable (there is no Redis to check for v1 — see
"What v1 deliberately doesn't need" above; don't add a Redis check here until Phase 12 actually
installs one). Wire this into your process monitor / uptime check.

### 5. Graceful shutdown

Confirm `server.js`'s `SIGTERM`/`SIGINT` handlers still work under PM2: stop accepting new requests,
drain in-flight ones, close the Mongoose connection, exit. `ecosystem.config.cjs` sets
`kill_timeout: 12000` to give the existing 10-second forced-exit timer room to finish before PM2
escalates to `SIGKILL` — do not lower it below that.

### 6. MongoDB — Atlas, confirmed replica set

Atlas's free/M0 tier is a replica set by default, which is what the transactions in
`offer.service.js`, `booking.service.js`, and `payout.service.js` require. No self-hosted
alternative is in scope for v1 — a standalone `mongod` will fail the offer-acceptance transaction on
first use.

### 7. Logs on the server

PM2 captures stdout/stderr; `ecosystem.config.cjs` points its own log files at `logs/pm2-*.log`,
alongside the app's existing Winston output (`logs/error.log`, `logs/combined.log`). Confirm the
`logs/` directory is writable and exists on the server (it's created by the app, but confirm the
deploy user has write permission). Add rotation so it doesn't fill the disk:

```bash
pm2 install pm2-logrotate
```

### 8. Final review against original requirements

Go through `01_PROJECT_STRUCTURE.md` and confirm every module present and functioning: auth, users,
stylists, requests, offers, bookings, scheduling, payments, chat, notifications, reviews, uploads,
mail, audit-log, admin, safety, payouts, ai (skeleton). Confirm the "Out of Scope" list (wallet,
coupons, favorites, loyalty, referral, video calls, subscriptions) was correctly **not** built.

---

## Go-live checklist

Combines this phase's checklist with the items already flagged in `HARDENING_06`:

- [ ] `pm2 start ecosystem.config.cjs --env production` (or `npm run start:prod`) starts with no errors.
- [ ] `pm2 save` + `pm2 startup` — app survives a server reboot without manual intervention.
- [ ] `pm2 restart` does not double-register the offer-expiry cron job (check logs for one
      "Offer-expiry cron scheduled" line, not two).
- [ ] `/api/v1/health` returns `200` with Mongo healthy, and a non-200 status when Mongo is
      intentionally disconnected (simulated outage test).
- [ ] `.env` is confirmed absent from git history (`git log --all -- .env` shows nothing).
- [ ] All production secrets differ from dev/test values.
- [ ] MongoDB confirmed a replica set — run a real offer-acceptance flow against production and
      confirm it doesn't fail on `mongoose.startSession()`.
- [ ] `MAIL_TO_ADDRESS` removed from production `.env`.
- [ ] `PAYMENT_PROVIDER=paymob` with live (not sandbox) Paymob credentials.
- [ ] `PAYMOB_NOTIFICATION_URL` explicitly set to the production `API_URL`.
- [ ] Every secret rotated off its dev default (`JWT_*`, `PAYMOB_*`, Firebase, Cloudinary, Resend).
- [ ] `npm run seed:admin` run once against production to create the first admin account.
- [ ] `app.set('trust proxy', 1)` matches the actual number of proxy hops in front of Node.
- [ ] Full end-to-end test passes against the deployed URL, not just local dev.
- [ ] Every module from `01_PROJECT_STRUCTURE.md` confirmed present; every out-of-scope item
      confirmed absent.
- [ ] PM2 log rotation active and `logs/` writable.
