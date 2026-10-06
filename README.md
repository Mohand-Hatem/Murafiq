# Murafiq (مرافق) — Production Backend API & Marketplace Engine

[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-339933?style=flat&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5.x-000000?style=flat&logo=express&logoColor=white)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas%20%2F%20ReplicaSet-47A248?style=flat&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Redis](https://img.shields.io/badge/Redis-BullMQ-DC382D?style=flat&logo=redis&logoColor=white)](https://redis.io/)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.0%20Validated-6BA539?style=flat&logo=swagger&logoColor=white)](https://swagger.io/)
[![Tests](https://img.shields.io/badge/Tests-1%2C715%20Passing-brightgreen?style=flat&logo=jest&logoColor=white)](https://jestjs.io/)
[![License](https://img.shields.io/badge/License-ISC-blue?style=flat)](#license)

**Murafiq** is an enterprise-grade backend platform power-linking clients with certified personal stylists and shopping companions for curated offline, in-person styling sessions, smart digital wardrobe management, and multimodal AI-driven fashion advisory.

Engineered with a **Layered Modular Monolith** architecture, Murafiq features a double-entry financial escrow ledger, BullMQ asynchronous worker queues, Firebase realtime communications, and a multi-stage AI Stylist pipeline powered by Google Gemini and Upstash Vector.

---

## Table of Contents

- [Core Platform Capabilities](#core-platform-capabilities)
- [Architecture & Tech Stack](#architecture--tech-stack)
- [Dual-Mode API Architecture](#dual-mode-api-architecture)
- [Process Model & Worker Topology](#process-model--worker-topology)
- [Project Directory Structure](#project-directory-structure)
- [Quick Start & Setup](#quick-start--setup)
  - [Prerequisites](#prerequisites)
  - [Environment Configuration](#environment-configuration)
  - [Database Seeding](#database-seeding)
  - [Running the Application](#running-the-application)
- [Testing & Quality Assurance](#testing--quality-assurance)
- [API Documentation & Swagger](#api-documentation--swagger)
- [Operations & Production Readiness](#operations--production-readiness)
- [Documentation Index](#documentation-index)

---

## Core Platform Capabilities

### 🛍️ Marketplace & Scheduling Engine
* **Dynamic Requests & Offers:** Clients broadcast styling requests; verified stylists submit tailored, competitive bids.
* **Double-Booking Prevention:** Atomic schedule slot reservations guard against overlaps (`existingStart < newEnd AND existingEnd > newStart`) inside MongoDB transactions.
* **Cairo Timezone Integrity:** Business caps (daily request/offer quotas) and schedule blocks operate strictly in `Africa/Cairo` time (`BUSINESS_TIMEZONE`).
* **Check-In & Session Verification:** Strict 30-minute pre-session temporal window; session completion requires mutual digital confirmation from both parties.

### 💳 Financial Ledger, Escrow & Payments
* **Paymob Integration:** Automated credit card and digital wallet checkouts with SHA-512 HMAC webhook verification.
* **Double-Entry Financial Ledger:** Zero-drift bookkeeping storing exact piastres (`amountMinor`) in immutable `LedgerEntry` records.
* **Escrow Safety:** Funds are held in escrow upon payment confirmation; disbursements to stylists are unlocked only after mutual completion or arbitrated resolution.
* **4-Branch Cancellation Policy:** Rigorous refund calculation (Client $\ge$24h: 97% refund; Client <24h: 80% refund; Stylist cancellation: 100% client refund with stylist penalty).
* **Automated Midnight Reconciliation:** Nightly cron sweep verifying parity across bookings, payments, and ledger balances with out-of-band alert dispatching.

### 🧠 AI Stylist & Digital Wardrobe Pipeline
* **Asynchronous Garment Tagging:** Garment photo uploads trigger background BullMQ jobs leveraging Google Gemini Vision for automatic categorization, fabric identification, color analysis, and seasonality extraction.
* **Vector Semantic Search:** Wardrobe items and fashion editorial guidelines are indexed via `@upstash/vector` with strict per-user metadata isolation.
* **Stylist Consultation & RAG:** Context-aware styling advice utilizing fashion knowledge retrieval, dress-code rules, and wardrobe gap analysis.
* **Virtual Try-On:** Asynchronous generative try-on pipeline with background job queue processing.

### 💬 Realtime Chat & Push Notifications
* **Scoped Firestore Chats:** Direct client-stylist chat rooms (`conversationId === bookingId`) unlocked upon escrow payment and locked automatically upon session completion or cancellation.
* **Push Notifications:** Firebase Cloud Messaging (FCM) push notifications paired with MongoDB persistence and automatic stale token pruning.

### 🛡️ Enterprise Security & Observability
* **Dual-Mode Authentication:** Flexible JWT delivery supporting HTTP-only secure cookies for web clients and Bearer tokens for mobile clients (`X-Client-Type`).
* **Fast Token Revocation:** 30-second in-memory LRU cache (`tokenVersionCache`) backed by MongoDB to enable instantaneous token revocation.
* **Zero PII Logging:** Winston logging transports strip passwords, auth tokens, and financial credentials; failed logins log structured security telemetry (`AUTH_LOGIN_FAILED`).
* **Correlation Tracking:** Asynchronous request context tracking using `AsyncLocalStorage` for end-to-end log correlation.

---

## Architecture & Tech Stack

Murafiq strictly follows a decoupled **Layered Modular Monolith** pattern:

$$\text{HTTP Request} \longrightarrow \text{Route} \longrightarrow \text{Validator (Zod)} \longrightarrow \text{Controller} \longrightarrow \text{Service} \longrightarrow \text{Repository} \longrightarrow \text{Model (Mongoose)}$$

| Layer / Component | Technology | Rationale |
| :--- | :--- | :--- |
| **Runtime** | Node.js (ESM) | Native ECMAScript Modules (`"type": "module"`), top-level await. |
| **Framework** | Express 5.x | High-throughput, robust REST API routing with centralized error envelopes. |
| **Primary Database** | MongoDB Atlas / Replica Set | Mongoose ODM, strict multi-document ACID transactions via `withTransaction()`. |
| **Cache & Queues** | Redis + BullMQ v5 | Resilient job queues with exponential backoff and worker process isolation. |
| **Realtime & Push** | Firebase Admin SDK | Cloud Firestore for chat state; FCM for device notifications. |
| **Media Pipeline** | Sharp + Cloudinary | In-memory buffer image compression before authenticated streaming to Cloudinary. |
| **AI Models** | `@google/genai` (Gemini 3.1 Flash) | Multimodal visual classification, fashion consultation, and outfit generation. |
| **Vector DB** | Upstash Vector | Serverless vector embeddings for user wardrobes and fashion knowledge RAG. |
| **Payments** | Paymob SDK / Provider | Live Egyptian payment gateway (Cards, Wallets) + Mock sandbox provider. |
| **Mail Dispatch** | Resend SDK | Transactional email delivery with verified domain authentication. |
| **Validation** | Zod | Runtime schema validation with `.strict()` mass-assignment guards. |
| **Documentation** | Swagger / OpenAPI 3.0 | Modular `@swagger` JSDoc annotations compiled and validated via CLI. |

---

## Dual-Mode API Architecture

Murafiq provides two fully functional API environments hosted simultaneously:

```text
                               ┌───► /api/v1/*   (Production Marketplace: Paymob, Real Subscriptions, Escrow, Payouts)
[Inbound Client Traffic] ──────┤
                               └───► /api/demo/* (Sandbox Experience: COD Simulator, Free-Tier, Bypassed Gateways)
```

1. **Production Mode (`/api/v1/*`):** Full operational marketplace with real credit card processing, subscription orders, platform commissions, escrow locking, and automated payouts.
2. **Demo Sandbox Mode (`/api/demo/*`):** Designed for investor walkthroughs, client onboarding, and staging. Bypasses online payment requirements via Cash-on-Delivery (COD) simulation, automatically serves Free-tier subscription plans, and writes `payoutStatus: 'not_owed'` with zero ledger/escrow contamination.

---

## Process Model & Worker Topology

In production, Murafiq separates web request handling from CPU-intensive background tasks using **PM2** in `fork` mode (`instances: 1`):

```text
┌─────────────────────────────────┐
│     murafiq-api (Process 1)     │  ◄── Express REST Server, In-Process Cron Sweeps (Node-Cron),
│       Port: 4000 (Fork)         │      Firebase Event Listeners, Authentication
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ murafiq-worker-wardrobe (Proc 2)│  ◄── BullMQ Queue Consumer: Gemini Flash Vision Tagging,
│      Isolated Runner Script     │      Embedding Generation, Upstash Vector Indexing
└─────────────────────────────────┘
┌─────────────────────────────────┐
│  murafiq-worker-tryon (Proc 3)  │  ◄── BullMQ Queue Consumer: Asynchronous Generative Try-On
│      Isolated Runner Script     │      Pipeline Tasks
└─────────────────────────────────┘
```

> **Why `instances: 1`?** Running the API server in fork mode is an intentional correctness invariant: recurring sweeps (offer expiration, session reminders, midnight reconciliation) run in-process without distributed lock contention, and token revocation caches maintain deterministic state.

---

## Project Directory Structure

```text
Murafiq/
├── content/                     # Editorial fashion knowledge markdown documents
│   └── fashion-knowledge/       # Rules for dress codes, color theory, silhouette, norms
├── docs/                        # Architectural documentation, ADRs, and guides
│   └── operations/              # PRODUCTION_DEPLOYMENT_READINESS.md source of truth
├── scripts/                     # Operational, database seeding, and validation CLI tools
│   ├── seed-plans.js            # Upserts canonical Free, Basic, Pro, VIP subscription tiers
│   ├── seed-admin.js            # Bootstraps platform super administrator
│   ├── ingest-fashion-knowledge.js # Indexes markdown rules into Upstash Vector KB
│   └── validate-openapi.js      # Strict structural validator for OpenAPI specifications
├── src/
│   ├── common/                  # Cross-cutting utilities, middlewares, constants, helpers
│   │   ├── events/              # EventBus and safeListener error containment wrapper
│   │   ├── middlewares/         # Auth, correlation-id, rate-limiter, validator
│   │   └── utils/               # Time utilities, money conversions, transaction wrappers
│   ├── config/                  # Validated Zod environment, database, logger, Redis configs
│   ├── database/                # MongoDB connection management and pool configuration
│   ├── jobs/                    # Node-cron recurring schedules and BullMQ worker runners
│   │   ├── queues/              # BullMQ queue definitions (wardrobe, tryon)
│   │   └── workers/             # Dedicated worker runners and processing logic
│   ├── modules/                 # Modular domain features (Layered Architecture)
│   │   ├── admin/               # Administrative analytics, moderation, user management
│   │   ├── ai/                  # Gemini Vision, stylist chat, try-on, knowledge RAG
│   │   ├── auth/                # JWT lifecycle, Google OAuth, OTP verification
│   │   ├── bookings/            # Scheduling, check-ins, disputes, cancellation engine
│   │   ├── chat/                # Firebase Firestore conversation orchestration
│   │   ├── health/              # Deep system health probes (Mongo, Redis, Firebase)
│   │   ├── mail/                # Resend transactional email provider
│   │   ├── notifications/       # FCM push delivery and user notification inbox
│   │   ├── offers/              # Stylist bidding engine and daily Cairo quotas
│   │   ├── payments/            # Paymob checkout, HMAC webhooks, double-entry ledger
│   │   ├── payouts/             # Stylist disbursements and batch settlements
│   │   ├── requests/            # Client styling request feed and broadcast
│   │   ├── reviews/             # Two-way reciprocal rating system
│   │   ├── stylists/            # Stylist profiles, portfolio, availability blocks
│   │   ├── subscriptions/       # Tier plans, checkout, order polling, entitlements
│   │   ├── users/               # Identity verification (KYC), profiles, address geo
│   │   └── wardrobe/            # Digital closet items, categories, visual search
│   ├── routes/                  # Central route mounting (/api/v1 and /api/demo)
│   ├── app.js                   # Express application configuration and security middlewares
│   └── server.js                # Server entrypoint and graceful shutdown handling
└── tests/                       # Automated test suite (Jest)
    ├── ai/                      # AI evaluation and golden pipeline tests
    ├── integration/             # Multi-collection lifecycle tests (in-memory replica set)
    └── unit/                    # Fast isolated domain service and utility tests
```

---

## Quick Start & Setup

### 1. Prerequisites
* **Node.js:** `>= 20.0.0`
* **MongoDB:** `>= 6.0` (Must be running as a **Replica Set** for transaction support)
* **Redis:** `>= 6.2` (Required for BullMQ queues)

### 2. Environment Configuration
Copy the environment template and populate your local credentials:
```bash
cp .env.example .env
```

Ensure core variables are configured:
```env
PORT=4000
NODE_ENV=development
API_URL=http://localhost:4000
CLIENT_URL=http://localhost:3000

# Database & Cache
MONGO_URI=mongodb://127.0.0.1:27017/murafiq?replicaSet=rs0
REDIS_URL=redis://127.0.0.1:6379

# Authentication Secrets (Min 32 characters)
JWT_ACCESS_SECRET=your_super_secret_jwt_access_key_min_32_characters
JWT_REFRESH_SECRET=your_super_secret_jwt_refresh_key_min_32_characters

# Providers (Mock supported in development)
PAYMENT_PROVIDER=mock
MAIL_PROVIDER=resend
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Database Seeding
Execute the initialization scripts to prepare the catalog and superadmin account:
```bash
# Seed canonical subscription tiers (Free, Basic, Pro, VIP)
node scripts/seed-plans.js

# Seed default platform administrator
npm run seed:admin
```
*(Default local admin: `admin@murafiq.dev` / `AdminPass123!`)*

### 5. Running the Application

#### Development Mode (with hot-reloading):
```bash
npm run dev
```

#### Running Background Queue Workers:
```bash
# Terminal 2: Wardrobe classification worker
npm run worker:wardrobe

# Terminal 3: AI Try-on generation worker
npm run worker:tryon
```

#### Production Mode (PM2 multi-process):
```bash
npm run start:prod
```

---

## Testing & Quality Assurance

Murafiq maintains a comprehensive test suite executed against an in-memory MongoDB Replica Set (`mongodb-memory-server`), ensuring real transactional semantics are validated on every run:

```bash
# Run complete test suite (Unit + Integration + E2E)
npm test

# Run code linter
npm run lint

# Validate OpenAPI specification parity (Zero ghost/undocumented routes)
npm run validate:openapi

# Execute full verification pipeline
npm run verify
```

### Quality Baseline
* **Test Suites:** **196 passed**, 196 total
* **Tests:** **1,715 passed**, 0 failures
* **Linting:** 0 ESLint errors
* **OpenAPI:** 0 ghost routes, 0 undocumented endpoints, 0 broken schema references

---

## API Documentation & Swagger

Interactive Swagger UI documentation is automatically generated from JSDoc annotations and accessible in development and production environments:

* **Production API V1 Documentation:** `http://localhost:4000/api-docs`
* **Sandbox Demo API Documentation:** `http://localhost:4000/demo-docs`

To verify documentation synchronization against runtime routes without booting the server:
```bash
npm run validate:openapi
```

---

## Operations & Production Readiness

Before executing a live production deployment, consult the definitive operational guide:

📘 **[`docs/operations/PRODUCTION_DEPLOYMENT_READINESS.md`](docs/operations/PRODUCTION_DEPLOYMENT_READINESS.md)**

This document details:
1. **Mandatory Release Mode Selection:** (`DEMO`, `V1`, or `BOTH`).
2. **Pre-Deployment Checklist:** MongoDB replica set verification, PM2 process management, secret provisioning, and reverse proxy rules.
3. **Paymob Webhook Reachability:** HMAC validation verification and proxy whitelist requirements.
4. **Automated Ledger Alerting (`OBS-04`):** Out-of-band email and webhook alerting configuration.
5. **Mode-Specific Smoke Tests:** Concrete verification steps before opening public traffic.

---

## Documentation Index

| Guide | Description |
| :--- | :--- |
| [`AGENTS.md`](AGENTS.md) | Agent contract, cross-cutting invariants, and architecture rules. |
| [`docs/operations/PRODUCTION_DEPLOYMENT_READINESS.md`](docs/operations/PRODUCTION_DEPLOYMENT_READINESS.md) | Production release procedures, mode matrices, and verification checklist. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Architectural layering, module boundaries, and folder structure. |
| [`docs/BUSINESS_RULES.md`](docs/BUSINESS_RULES.md) | Marketplace policies, cancellation tiers, caps, and disputes. |
| [`docs/MONEY_AND_LEDGER.md`](docs/MONEY_AND_LEDGER.md) | Financial ledger specifications, escrow rules, and reconciliation logic. |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Database schemas, indexes, and relationship architecture. |
| [`docs/ROUTES.md`](docs/ROUTES.md) | Complete dictionary of V1 and Demo REST endpoints. |
| [`docs/AUTH_AND_PERMISSIONS.md`](docs/AUTH_AND_PERMISSIONS.md) | RBAC hierarchy, token rotations, and session security. |

---

## License

This project is licensed under the [ISC License](LICENSE).
