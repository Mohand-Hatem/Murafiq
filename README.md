# Murafiq (مرافق) — Backend API

Murafiq is a production-grade marketplace backend built with **Node.js**, **Express**, and **MongoDB** connecting **Clients** with **Personal Stylists / Shopping Companions** for offline, in-person shopping and styling sessions.

---

## Architecture & Tech Stack

- **Architecture:** Modular Monolith with layered separation (`Routes → Validators → Controllers → Services → Repositories → Models`).
- **Runtime:** Node.js (ESM `"type": "module"`).
- **Database:** MongoDB with Mongoose (transactions for multi-collection writes, in-memory replica set for tests).
- **Authentication:** JWT (access 15m + refresh 30d) via httpOnly cookies or Bearer headers, bcrypt (12 rounds), Google Sign-In, 5-attempt OTP lockout.
- **Realtime:** Firebase (Firestore for Chat, FCM for Push Notifications).
- **Storage:** Cloudinary (authenticated KYC document storage + signed URLs).
- **Payments & Payouts:** Paymob / Mock gateway provider, 15% platform commission, 48h escrow hold, manual batch disbursements.

---

## Quick Start

### 1. Prerequisites
- Node.js >= 18.0.0
- MongoDB >= 6.0 (or Docker MongoDB replica set)

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Key environment variables:
```env
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb://localhost:27017/murafiq
JWT_ACCESS_SECRET=your_jwt_access_secret_min_32_chars
JWT_REFRESH_SECRET=your_jwt_refresh_secret_min_32_chars
PLATFORM_FEE_PERCENTAGE=15
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Seed Superadmin Account
Run the idempotent admin seeding script:
```bash
npm run seed:admin
```
*(Default credentials: `admin@murafiq.com` / `AdminPass123!`, configurable via `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`)*.

### 5. Run Server
```bash
# Development with auto-reload
npm run dev

# Production
npm start
```

### 6. Run Tests & Linter
```bash
# Run all unit and in-memory replica-set integration tests
npm test

# Run ESLint check
npm run lint
```

---

## Documentation Index

**Start here:** [`docs/PHASES_INDEX.md`](docs/PHASES_INDEX.md) — the phase map and the pointer to
every current source of truth.

### Current

| Document | Owns |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Agent + engineering contract |
| [`docs/STATUS.md`](docs/STATUS.md) | What is actually built, right now |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Architecture principles and folder tree |
| [`docs/PROJECT_RULES.md`](docs/PROJECT_RULES.md) | Coding conventions and engineering standards |
| [`docs/BUSINESS_RULES.md`](docs/BUSINESS_RULES.md) | Business rules — the authority |
| [`docs/MONEY_AND_LEDGER.md`](docs/MONEY_AND_LEDGER.md) | Escrow, refunds, commission, payouts |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Schemas, relationships, index rationale |
| [`docs/ROUTES.md`](docs/ROUTES.md) | Route dictionary |
| [`docs/API_DOCUMENTATION_AND_LIFECYCLE_GUIDE.md`](docs/API_DOCUMENTATION_AND_LIFECYCLE_GUIDE.md) | End-to-end API lifecycle narrative |
| [`docs/AUTH_AND_PERMISSIONS.md`](docs/AUTH_AND_PERMISSIONS.md) | RBAC, tokens, account-status enforcement |
| [`docs/ERRORS.md`](docs/ERRORS.md) | HTTP status contract and response envelopes |
| [`docs/OPS.md`](docs/OPS.md) | Production operations and health checks |
| [`docs/DEPLOYMENT_READINESS.md`](docs/DEPLOYMENT_READINESS.md) | Go-live checklist |
| [`docs/END_TO_END_TESTING_GUIDE.md`](docs/END_TO_END_TESTING_GUIDE.md) | Manual E2E test walkthrough |
| [`docs/MURAFIQ_PRODUCT_AND_BUSINESS_GUIDE.md`](docs/MURAFIQ_PRODUCT_AND_BUSINESS_GUIDE.md) | Product definition |

### Next phase — Phase 15 (AI Stylist, **not implemented**)

[`docs/next-phase/`](docs/next-phase/) — product brief, architecture decision of record,
sub-phase specs 15A–15F, and [`BACKLOG.md`](docs/next-phase/BACKLOG.md) (the only current list of
open technical debt).

### History

[`docs/archive/`](docs/archive/README.md) — Phase 0–14 build records (one file per phase),
completed audits, remediation, simplification and hardening work. Preserved, **not** current
guidance.
