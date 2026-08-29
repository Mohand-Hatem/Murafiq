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

- [`docs/01_PROJECT_STRUCTURE.md`](file:///docs/01_PROJECT_STRUCTURE.md) — Architecture principles and complete folder tree.
- [`docs/02_PROJECT_RULES.md`](file:///docs/02_PROJECT_RULES.md) — Coding conventions and engineering standards.
- [`docs/03_SKELETON_STATUS.md`](file:///docs/03_SKELETON_STATUS.md) — Verified live implementation status.
- [`docs/04_ROUTES.md`](file:///docs/04_ROUTES.md) — Complete API route dictionary with active status indicators.
- [`docs/DATA_MODEL.md`](file:///docs/DATA_MODEL.md) — MongoDB schemas, relationships, and index rationale.
- [`docs/AUTH_AND_PERMISSIONS.md`](file:///docs/AUTH_AND_PERMISSIONS.md) — RBAC matrix, token lifecycle, and session invalidation.
- [`docs/MONEY_AND_LEDGER.md`](file:///docs/MONEY_AND_LEDGER.md) — Escrow, refunds, commission, and payout mechanics.
- [`docs/ERRORS.md`](file:///docs/ERRORS.md) — HTTP status-code contract and response envelopes.
- [`docs/OPS.md`](file:///docs/OPS.md) — Production operations, health checks, and go-live checklist.
