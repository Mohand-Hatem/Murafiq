# Murafiq — Phase Index

> **How to read this file.** Phases 0–14 are **shipped history**. Their documents record how
> each phase was built and are preserved individually in `docs/archive/phases/`. They are
> **not current instructions** — where an archived phase doc disagrees with the active
> documents listed below, the active document wins.
>
> Phase 15 is the **only active development target**. Nothing in it is implemented yet.

## Current source of truth

| Topic | Document |
|---|---|
| What is built, today | [`STATUS.md`](STATUS.md) |
| Business rules | [`BUSINESS_RULES.md`](BUSINESS_RULES.md) |
| Architecture & layering | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Engineering rules | [`PROJECT_RULES.md`](PROJECT_RULES.md) |
| Money & ledger | [`MONEY_AND_LEDGER.md`](MONEY_AND_LEDGER.md) |
| Data model | [`DATA_MODEL.md`](DATA_MODEL.md) |
| API routes | [`ROUTES.md`](ROUTES.md) · [`API_DOCUMENTATION_AND_LIFECYCLE_GUIDE.md`](API_DOCUMENTATION_AND_LIFECYCLE_GUIDE.md) |
| Operations | [`OPS.md`](OPS.md) · [`DEPLOYMENT_READINESS.md`](DEPLOYMENT_READINESS.md) |
| Open technical debt | [`next-phase/BACKLOG.md`](next-phase/BACKLOG.md) |

## Phases 0–14 — IMPLEMENTED (history)

| # | Phase | Status | Record |
|---|---|---|---|
| 0 | Setup & infrastructure | IMPLEMENTED | [`archive/phases/PHASE_00_SETUP.md`](archive/phases/PHASE_00_SETUP.md) |
| 1 | Auth & sessions | IMPLEMENTED | [`archive/phases/PHASE_01_AUTH.md`](archive/phases/PHASE_01_AUTH.md) |
| 2 | Users & verification | IMPLEMENTED | [`archive/phases/PHASE_02_USERS_VERIFICATION.md`](archive/phases/PHASE_02_USERS_VERIFICATION.md) |
| 3 | Stylists & search | IMPLEMENTED | [`archive/phases/PHASE_03_STYLISTS_SEARCH.md`](archive/phases/PHASE_03_STYLISTS_SEARCH.md) |
| 4 | Requests & offers | IMPLEMENTED | [`archive/phases/PHASE_04_REQUESTS_OFFERS.md`](archive/phases/PHASE_04_REQUESTS_OFFERS.md) |
| 5 | Bookings & scheduling | IMPLEMENTED | [`archive/phases/PHASE_05_BOOKINGS_SCHEDULING.md`](archive/phases/PHASE_05_BOOKINGS_SCHEDULING.md) |
| 6 | Payments & escrow | IMPLEMENTED | [`archive/phases/PHASE_06_PAYMENTS.md`](archive/phases/PHASE_06_PAYMENTS.md) |
| 7 | Chat & notifications | IMPLEMENTED — Firestore + FCM, **no Socket.IO** (P7) | [`archive/phases/PHASE_07_CHAT_NOTIFICATIONS.md`](archive/phases/PHASE_07_CHAT_NOTIFICATIONS.md) |
| 8 | Reviews & ratings | IMPLEMENTED | [`archive/phases/PHASE_08_REVIEWS.md`](archive/phases/PHASE_08_REVIEWS.md) |
| 9 | Uploads & mail | IMPLEMENTED | [`archive/phases/PHASE_09_UPLOADS_MAIL.md`](archive/phases/PHASE_09_UPLOADS_MAIL.md) |
| 10 | Audit log & admin | IMPLEMENTED | [`archive/phases/PHASE_10_AUDIT_ADMIN.md`](archive/phases/PHASE_10_AUDIT_ADMIN.md) |
| 11 | Safety & payouts | **PARTIALLY** — payouts shipped; the safety module was deliberately **not built** (P1) | [`archive/phases/PHASE_11_SAFETY_PAYOUTS.md`](archive/phases/PHASE_11_SAFETY_PAYOUTS.md) |
| 12 | Background jobs | IMPLEMENTED — 6 crons, all `Africa/Cairo` | [`archive/phases/PHASE_12_BACKGROUND_JOBS.md`](archive/phases/PHASE_12_BACKGROUND_JOBS.md) |
| 13 | Security, logging, docs | IMPLEMENTED | [`archive/phases/PHASE_13_SECURITY_LOGGING_DOCS.md`](archive/phases/PHASE_13_SECURITY_LOGGING_DOCS.md) |
| 14 | Wardrobe & embeddings | IMPLEMENTED | [`archive/phases/PHASE_14_WARDROBE.md`](archive/phases/PHASE_14_WARDROBE.md) |

## Phase 15 — AI Stylist · PLANNED / NOT IMPLEMENTED

`src/modules/ai/` contains only `.gitkeep`. There is **no** `/api/v1/ai` route — it returns
`404`. No sub-phase has started.

| Document | Role |
|---|---|
| [`next-phase/PHASE_15_PRODUCT_BRIEF.md`](next-phase/PHASE_15_PRODUCT_BRIEF.md) | The *what* and *why* |
| [`next-phase/PHASE_15_AI_ARCHITECTURE_DECISION.md`](next-phase/PHASE_15_AI_ARCHITECTURE_DECISION.md) | **The architecture decision of record** — model strategy, RAG, scope guard, cost |
| [`next-phase/PHASE_15_AI_SKELETON.md`](next-phase/PHASE_15_AI_SKELETON.md) | Overview + locked decisions. *Not a work unit* |
| `next-phase/PHASE_15A` … `PHASE_15F` | The work units, implemented in order |

| Sub-phase | Status |
|---|---|
| 15A Data model & retrieval | ✅ IMPLEMENTED |
| 15B Stylist pipeline | ✅ IMPLEMENTED |
| 15C Image input | 🟡 Ready to start |
| 15D Fashion knowledge RAG | ⛔ Not started |
| 15E External product search | ⛔ Not started |
| 15F Virtual try-on | ⛔ Not started |

**Prerequisites — all satisfied.** `HARDENING_08` is completed and verified. `Phase 15A` and `Phase 15B` are fully implemented and verified (all 11 test suites / 115 tests passing, 42-case golden evaluation harness passing). Phase 15C is ready to begin.

## Phase 16 — Deployment · PARTIALLY IMPLEMENTED

Checklist and PM2 configuration exist; there is no CI deploy step.
See [`DEPLOYMENT_READINESS.md`](DEPLOYMENT_READINESS.md).

## Archive

| Directory | Contents |
|---|---|
| `archive/phases/` | Phase 0–14 build records (preserved individually) |
| `archive/audits/` | Completed full-system and post-simplification audits |
| `archive/remediation/` | Completed remediation programme |
| `archive/simplification/` | Completed S0–S7 simplification assessment, plan and baseline |
| `archive/hardening/` | Hardening series + per-issue analyses. **Status is historical — see `next-phase/BACKLOG.md`** |
| `archive/design/` | Design records for shipped features (broadcast requests, moderation classifier gate) |
| `archive/handoffs/` | Historical handoffs |
| `archive/reviews/` | Point-in-time code reviews |
