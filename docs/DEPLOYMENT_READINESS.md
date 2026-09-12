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

## Infrastructure Summary

| Layer | Development (Current) | Production (VPS Deployment) |
|---|---|---|
| **Process Manager** | Local `npm run dev` / `node src/server.js` | **PM2**, `ecosystem.config.cjs` (`fork` mode, `instances: 1`) |
| **Reverse Proxy / TLS** | Direct localhost (`http://localhost:4000`) | **Nginx** + Let's Encrypt SSL (`certbot`) |
| **Database** | MongoDB Atlas (replica set) | **MongoDB Atlas** (production cluster with replica set) |
| **Queue & Message Broker** | **Upstash Redis** (`rediss://...`) | **Native `redis-server`** on VPS (`redis://127.0.0.1:6379`) |
| **Vector Database** | Upstash Vector (`https://...upstash.io`) | **Upstash Vector** (production namespace isolation) |
| **AI / Multimodal** | Google Gemini Flash (`@google/genai`) | **Google Gemini Flash** (`@google/genai`) |
| **Background Workers** | BullMQ Worker inside server process | **BullMQ Worker** running inside PM2 process |
| **Periodic Sweeps** | `node-cron` (offer-expiry cron) | **`node-cron`** in-process sweep |

---

## Message Queue & Redis Architecture (Across the Project)

### Is BullMQ + Redis only for Wardrobe, or for the whole platform?
**It is the global asynchronous message broker for the entire platform:**
1. **Wardrobe AI Vision Classification (Active — Phase 14):** Asynchronous Gemini Flash classification & Upstash Vector indexing without blocking client HTTP responses.
2. **Transactional Emails & Notifications (Phase 9/10/12):** Async delivery with exponential backoff retries when external mail/SMS providers experience temporary outages.
3. **Heavy Media & KYC Processing:** Offloading CPU-heavy image resizing and watermarking off the Express event loop.
4. **Paymob Webhook & Refund Retries:** Reliable retry mechanisms for third-party financial transactions.

---

## Step-by-Step Production Deployment on Ubuntu VPS

### 1. Install & Configure Native Redis on VPS
On your Ubuntu VPS, native Redis runs locally with **0ms latency** and zero cost:

```bash
# 1. Install redis-server
sudo apt update
sudo apt install redis-server -y

# 2. Configure Redis for BullMQ Queue (noeviction policy)
# Open configuration file:
sudo nano /etc/redis/redis.conf

# Ensure the following directives are set:
# bind 127.0.0.1 ::1
# maxmemory-policy noeviction
# supervised systemd

# 3. Restart and enable Redis service on boot
sudo systemctl restart redis.service
sudo systemctl enable redis.service

# 4. Verify Redis status & ping
redis-cli ping
# Expected output: PONG
```

---

### 2. Process Management — PM2 (`ecosystem.config.cjs`)

The repo includes `ecosystem.config.cjs` at its root. It pins `exec_mode: 'fork'` and `instances: 1` so in-process crons and BullMQ workers do not double-process tasks.

```bash
# 1. Install PM2 globally
sudo npm install -g pm2

# 2. Start Murafiq in production mode
npm run start:prod        # runs: pm2 start ecosystem.config.cjs --env production

# 3. Configure PM2 to auto-start on server reboots
pm2 save
pm2 startup               # copy and execute the command printed by PM2

# 4. Install log rotation to protect disk space
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 14
```

---

### 3. Reverse Proxy & TLS — Nginx

Nginx terminates TLS and forwards incoming traffic to Node (port `4000`):

```nginx
# /etc/nginx/sites-available/murafiq-api
server {
    server_name api.murafiq.app;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # Pass real client IP (app.set('trust proxy', 1) is configured)
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# Enable site and issue free SSL certificate
sudo ln -s /etc/nginx/sites-available/murafiq-api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
sudo certbot --nginx -d api.murafiq.app
```

---

### 4. Production Environment Checklist (`.env`)

| Variable | Production Value | Note |
|---|---|---|
| `NODE_ENV` | `production` | Enables production security & logging modes |
| `PORT` | `4000` | Matched with Nginx proxy_pass |
| `MONGO_URI` | `mongodb+srv://...` | Atlas production replica set |
| `REDIS_URL` | `redis://127.0.0.1:6379` | **Native VPS Redis** (0ms latency) |
| `GEMINI_API_KEY` | `AIzaSy...` | Production Gemini API key |
| `UPSTASH_VECTOR_REST_URL` | `https://...upstash.io` | Production Upstash Vector endpoint |
| `UPSTASH_VECTOR_REST_TOKEN` | `your_token` | Production Upstash Vector token |
| `CLIENT_URL` | `https://murafiq.app` | Real frontend URL for CORS |
| `API_URL` | `https://api.murafiq.app` | Backend public URL for Paymob webhooks |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | 64-char random hex | Secure cryptographically generated secrets |
| `RESEND_API_KEY` / `MAIL_FROM_ADDRESS` | Live Resend key & domain | Verified sending domain |
| `MAIL_TO_ADDRESS` | *(Unset / Empty)* | **Must be removed** in production |
| `PAYMENT_PROVIDER` | `paymob` | Live payment processing |
| `PAYMOB_*` | Live credentials | Real Paymob credentials |

---

### 5. Health Monitoring

`GET /api/v1/health` dynamically verifies and returns:
```json
{
  "status": "success",
  "data": {
    "status": "healthy",
    "uptime": 1284.5,
    "timestamp": "2026-08-30T22:00:00.000Z",
    "services": {
      "mongodb": "connected",
      "redis": "connected"
    }
  }
}
```
If either database or Redis becomes unreachable, it returns HTTP 503 so your uptime monitor (e.g. UptimeRobot, BetterUptime) alerts immediately.

---

## Go-Live Checklist

- [ ] Native `redis-server` installed, active, and verified with `redis-cli ping`.
- [ ] Redis configured with `maxmemory-policy noeviction`.
- [ ] `pm2 start ecosystem.config.cjs --env production` running with 0 errors.
- [ ] `pm2 save` + `pm2 startup` configured.
- [ ] Nginx configured with SSL (`certbot`) and exactly 1 proxy hop (`trust proxy: 1`).
- [ ] `GET /api/v1/health` returns `200` with both `mongodb: connected` and `redis: connected`.
- [ ] `MAIL_TO_ADDRESS` removed from production `.env`.
- [ ] `npm run seed:admin` executed to provision the initial superadmin.
- [ ] Full end-to-end regression test passing against deployed domain.
