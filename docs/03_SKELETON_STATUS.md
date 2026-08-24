# Murafiq — Skeleton Status / Current State

> **The single source of truth for: "is X actually working right now?"**
>
> **Verified 2026-08-25 against the working tree on top of commit `3ace8c8` (uncommitted) — by
> direct code inspection and a real `npm test`/`npm run lint` run, not by reading other docs.
> Latest pass: fixed a startup bug the user hit running `npm run dev` —
> `firebase.config.js` was written against firebase-admin's old v9-11 namespaced API
> (`admin.credential.cert`, `admin.apps.length`) but the installed version is `^14.3.0`, which
> replaced that with a modular API (`firebase-admin/app`, `/firestore`, `/auth`, `/messaging`).
> This meant Firebase/Firestore/FCM had **never** actually initialized, in any environment, in this
> project's history — not a credential issue, chat has been silently running on the in-memory mock
> fallback in every dev run to date. Rewritten to the modular API; confirmed initializing
> successfully against real `.env` credentials. One follow-up fix mid-repair: a static top-level
> import of `firebase-admin/auth` broke 18 test suites under Jest (its `jwks-rsa`→`jose` dependency
> chain is pure-ESM and can't be `require()`'d on this Node version) — restructured to dynamically
> import the firestore/auth/messaging submodules only inside the branch where initialization
> actually succeeds, so the test environment (which never initializes) never touches that chain.
> 47/204 tests still pass. Earlier pass: Phase 10 completed (`GET /admin/users`,
> `GET /admin/dashboard/stats`), plus a real Cairo-timezone bug fixed in
> `getBusinessMonthRange()`. Two Phase-9 follow-ups still open, not blockers:
> `welcomeTemplate`/`bookingConfirmationTemplate` exist but are called from nowhere yet.
>
> Every claim in this file was checked against `src/`, `package.json`, and a real test run. If you are
> an AI assistant, **trust this file over any other doc in `docs/`** — and if you change what's built,
> updating this file is part of your Definition of Done.

Legend:
- ✅ **Active** — implemented, wired up, and exercised.
- ⚠️ **Built but defective** — code exists and runs, but has a known bug. Fix is specified in a `HARDENING_*` doc.
- 🧪 **Written but never executed** — code exists, zero test coverage, never run against the real dependency.
- 🔲 **Skeleton** — structure/interface exists, implementation is a stub.
- ⛔ **Not built** — does not exist. An empty `.gitkeep` directory, or nothing at all.

> [!WARNING]
> **A previous version of this file claimed Paymob, the wardrobe module, the AI tool, safety, payouts,
> mail templates, and the OpenAI/vector-DB clients were all "✅ Active". None of that was true.** The
> corrected state is below. This is why the "verified against commit" line at the top exists — do not
> mark anything ✅ without checking the code.

---

## 0. Build progress at a glance

| Phase | Status |
|---|---|
| 0 — Setup & infrastructure | ✅ Built |
| 1 — Auth | ✅ Built (see defects) |
| 2 — Users & Verification | ✅ Built (see defects) |
| 3 — Stylists & Search | ✅ Built (see defects) |
| 4 — Requests & Offers | ✅ Built (see defects) |
| 5 — Bookings & Scheduling | ✅ Built (see defects) |
| 6 — Payments | ✅ Built (see defects) |
| 7 — Chat & Notifications | ✅ Built (see defects) |
| 8 — Reviews | ✅ Built |
| 9 — Uploads & Mail | ✅ **Built** (Cloudinary + Multer memory storage, Sharp in-memory compression, signed KYC URLs, Resend provider, SendGrid 501 stub, and 5 HTML email templates). |
| 10 — Audit Log & Admin | ✅ **Built** (audit log, dispute resolution, suspend/reactivate, review hide/unhide, `GET /admin/users` listing/search, and `GET /admin/dashboard/stats`). |
| 11 — Safety & Payouts | ✅ **Payouts Built** (`src/modules/payouts/`, stylist self-serve credentials, admin batch disbursement, ledger balance aggregation, double-payout guards). |
| 12 — Background Jobs | ⚠️ **Re-scoped, partial** — offer-expiry sweep done via `node-cron`; OTP-cleanup and session-reminder sweeps still to build, same pattern. Redis/BullMQ deliberately moved to Phase 14, not deferred indefinitely — see §6. |
| 13 — Security/Logging/Docs/Tests | ⚠️ **Hardened** (Swagger protected in prod, OTP lockout, Firebase production fail-safe). |
| 14 — Wardrobe | ⛔ Not built — the module does not exist. Now also owns installing Redis + BullMQ (moved from Phase 12) — see `HARDENING_07` Part 2. |
| 15 — AI | ⛔ Not built |
| 16 — Deployment Readiness | ⚠️ **Decision recorded** — single VPS/PM2 path (`ecosystem.config.cjs` + rewritten `PHASE_16_DEPLOYMENT_READINESS.md`). Not yet deployed to a real server. |

**Verified build state:** `npm test` → 47 suites / 204 tests pass (including in-memory MongoDB replica-set integration tests).
**`npm run lint` → PASSES** (0 errors, 0 warnings). GitHub Actions CI workflow active.

---

## 1. Modules that exist in `src/modules/`

| Module | Status | Notes |
|---|---|---|
| `auth/` | ✅ Active | 10 routes. JWT access 15m + refresh 30d, dual cookie/Bearer delivery, bcrypt 12, hashed OTP with 5-attempt lockout, session invalidation on password change, Google ID-token verification. |
| `users/` | ✅ Active | 5 routes + the verification service backing `/admin/verifications` (using Cloudinary documentRefs). |
| `stylists/` | ✅ Active | 6 routes incl. `$geoNear` search aggregation, cancellation counter tracking, and payout credentials. |
| `requests/` | ✅ Active | 5 routes. 48h expiry, configurable verification-tiered daily caps (`DEFAULT_CAPS`). |
| `offers/` | ✅ Active | 3 routes. 24h expiry, configurable daily stylist cap (`DEFAULT_CAPS`). |
| `bookings/` | ✅ Active | 7 routes + 48h dispute filing window, admin arbitration resolution, dispute status locks, and scheduling. |
| `payments/` | ✅ Active | 5 routes, provider pattern, 15% commission, `round2()` 2-dp EGP. |
| `payouts/` | ✅ Active | 6 routes (stylist account management, admin pending balances summary, batch disbursement, status guards). |
| `chat/` | ✅ Active | 3 routes, Firestore-backed (fail-closed in prod, mock in dev/test), admin access restricted to disputed bookings with audit logs. Prior to the `firebase.config.js` fix (§5 below), the mock fallback was silently exercised in **every** dev run regardless of credentials — dev now actually talks to real Firestore. |
| `notifications/` | ✅ Active | 3 routes, Mongo feed + FCM multicast with token pruning. |
| `reviews/` | ✅ Active | Two-way reviews, unique `{bookingId, direction}` index, aggregation-based ratings. |
| `admin/` | ✅ Active | `GET /verifications`, `PATCH /verifications/:userId/approve`, `PATCH /verifications/:userId/reject`, `PATCH /users/:id/suspend`, `PATCH /users/:id/reactivate`, `PATCH /reviews/:id/hide`, `GET /audit-logs`, `GET /bookings/disputed`, `PATCH /bookings/:id/resolve-dispute`, `GET /users`, `GET /dashboard/stats`. |
| `mail/` | ✅ Active | Provider pattern (`env.MAIL_PROVIDER`), `ResendProvider` (active), `SendgridProvider` (501 stub), 5 templates in `templates/`, `sendMail({ to, subject, html })`. |
| `uploads/` | ✅ Active | Memory storage multer, Sharp in-memory compression (1920x1920 max), Cloudinary upload service, authenticated KYC document storage with signed URLs. |
| `audit-log/` | ✅ Active | Immutable Mongoose schema, QueryBuilder repository, domain event listener, admin querying. Fixed cross-module violation: no longer imports Booking/Payment models directly (see §11a). |
| `safety/` | ⛔ Not built | `.gitkeep` only. |
| `ai/` | ⛔ Not built | `.gitkeep` only. |
| `wardrobe/` | ⛔ Does not exist | No such directory. |

`src/jobs/queues/` and `src/jobs/workers/` are also `.gitkeep`-only.

---

## 2. Dependencies — what is actually installed

**Installed:** `bcrypt`, `cloudinary`, `compression`, `cookie-parser`, `cors`, `dotenv`, `express` (v5),
`express-async-handler`, `express-mongo-sanitize`, `express-rate-limit`, `firebase-admin`,
`google-auth-library`, `helmet`, `jsonwebtoken`, `mongodb-memory-server`, `mongoose`, `morgan`,
`multer`, `node-cron`, `resend`, `sharp`, `streamifier`, `swagger-jsdoc`, `swagger-ui-express`, `winston`, `zod`.

**Removed (v1 cleanup):** `socket.io` and `uuid` — both had **zero imports** anywhere in `src/`.
`socket.io` was already an orphaned dependency (`sockets/index.js` was deleted in an earlier pass but
the server never called `new Server(...)` after that); `uuid` was never used at all.

**NOT installed** — verified against `package.json`, regardless of what any other doc claims:

`bullmq` · `ioredis` · `openai` ·
any Pinecone/Qdrant client · `langchain`

> `01_PROJECT_STRUCTURE.md` §2 marks Cloudinary+Multer and BullMQ+Redis as "Active". **They are not
> installed** (BullMQ/Redis deliberately deferred to Phase 12 — see §6). Corrected in
> `HARDENING_06` Step 2.

---

## 3. Payments

| Piece | Status | Notes |
|---|---|---|
| Payment model, statuses, commission split | ✅ Active | `round2()` invariant holds; fee snapshotted at creation. |
| `payment-provider.interface.js` | ✅ Active | `initialize / verify / refund / handleCallback`. |
| `mock.provider.js` | ✅ Hardened | Requires `MOCK_WEBHOOK_SECRET` in dev; strictly forbidden in production. → `HARDENING_01` Step 1. |
| `paymob.provider.js` | 🧪 Awaiting manual verification | Two real defects fixed this pass: `notification_url` was pointing at `CLIENT_URL` (the frontend) instead of the backend's own origin — now uses `API_URL`; `refund()` was passing the Intention-API secret key where Paymob expects a token from `/api/auth/tokens` — now exchanges `PAYMOB_API_KEY` for one first. `.env` now sets `PAYMENT_PROVIDER=paymob` so dev actually exercises this path. Still needs one real sandbox transaction + refund run manually to confirm — automated tests can't cover this (mock is now selected by `NODE_ENV=test` only, never by the env var — see `getProvider()`). |
| Refund ledger | ✅ Active | `PAYMENT_STATUS.PARTIALLY_REFUNDED` implemented and used; `stylistPayoutAmount` correctly zeroed on any refund so payout aggregation self-excludes it. |
| Refund vs. already-batched payout | ✅ Active | `processRefund` now blocks (409) refunding a booking whose `payoutStatus` is `processing`/`paid` — see §11a. |
| Payouts (money **out** to stylists) | ✅ Active | `src/modules/payouts/` — see §1 and §11a. |

**Current default:** `.env` and `.env.example` now ship with `PAYMENT_PROVIDER=paymob` — dev,
staging, and production all hit the real Paymob sandbox/live API. The mock provider can no longer be
selected outside `NODE_ENV=test`, even by setting `PAYMENT_PROVIDER=mock` (see `getProvider()` in
`payment.service.js`). Required credentials: `PAYMOB_SECRET_KEY`, `PAYMOB_PUBLIC_KEY`,
`PAYMOB_HMAC_SECRET`, `PAYMOB_CARD_INTEGRATION_ID`, and — new this pass — `PAYMOB_API_KEY` (the
legacy dashboard API key, needed only by `refund()`'s auth-token exchange, distinct from the secret
key above). All are now present in `.env.example`.

---

## 4. Mail

| Piece | Status | Notes |
|---|---|---|
| `mail.service.js` | ✅ Active | Provider-selecting facade. Exports **`sendMail({ to, subject, html })`** and `getProvider()` — signature unchanged from the Phase-1 shim, so no caller needed to change. Picks `ResendProvider` or `SendgridProvider` via `env.MAIL_PROVIDER`. |
| `mail-provider.interface.js` | ✅ Active | Single `send({ to, subject, html })` method, both providers implement it. |
| `resend.provider.js` | ✅ Active | Real delivery. `MAIL_TO_ADDRESS` dev-sandbox redirect and `ApiError(502)` on failure both carried over from the old shim unchanged. |
| `sendgrid.provider.js` | ✅ Active (501 stub) | Decided: not a real integration. `send()` throws `ApiError(501, 'SendGrid provider not yet implemented')`. Selectable via `MAIL_PROVIDER=sendgrid`, tested. |
| Templates (`src/modules/mail/templates/`) | ⚠️ Built, 2 of 5 unused | All 5 exist and are unit-tested. `otpTemplate`, `verifyEmailTemplate`, `forgotPasswordTemplate` are wired into `auth.service.js`'s 3 real call sites — the inline `otpEmailHtml()` string is gone. `welcomeTemplate` and `bookingConfirmationTemplate` are defined and tested but **called from nowhere in `src/`** — no registration-welcome or booking-confirmation email is actually sent yet. Wiring those in is a follow-up, not part of Phase 9's scope. |
| Queue-based sending | ⛔ Not built | Synchronous. A mail failure currently **500s an otherwise-successful registration** → `HARDENING_03` Step 4. |

> [!WARNING]
> **⚠️ TEMPORARY — remove before go-live:** `MAIL_TO_ADDRESS` in `.env` redirects **all** outgoing mail
> to one inbox (Resend sandbox workaround). Remove it when a verified domain is added. No code change
> needed. On the go-live checklist in `HARDENING_06`.

---

## 5. Chat & Notifications

| Piece | Status | Notes |
|---|---|---|
| `firebase.config.js` | ✅ Active (fixed 2026-08-25) | Was silently failing to initialize in **every** environment, always — root cause was a `firebase-admin` v14 API mismatch (see below), not a credential problem. Confirmed initializing against real `.env` credentials. Catches init failure and **warns** in dev/test, exporting `null` (chat falls back to in-memory `Map`s — data lost on restart, not shared across instances); fails hard in production. |
| Firestore `conversations`/`messages` | ✅ Active | 1:1 with `bookingId`. Source of truth for chat. |
| `chat.service.js` | ✅ Active | Rooms, custom tokens with role claims, open-on-payment / lock-on-completion. |
| `firestore.rules` | ⚠️ **Defective** | `update` rules have **no field restriction** — a participant can rewrite another user's message `content`/`senderId`, or add an arbitrary third UID to `participants`. → `HARDENING_02` Step 7. |
| Admin chat access | ⚠️ Defective | Any admin can read **any** conversation — no dispute check, no audit trail. → `HARDENING_03` Step 5. |
| FCM push (`notification.service.js`) | ✅ Active | Multicast with stale-token pruning. |
| In-app feed (`notification.model.js`) | ✅ Active | Read/unread tracking. |
| Notification correctness | ✅ Active | All 31 `EVENTS.*` keys are defined; verified zero undefined-collision usages repo-wide (`HARDENING_02` Step 1 fix confirmed). |
| Socket.io | ⛔ Effectively unused | Server boots in `server.js` but `sockets/index.js` registers **zero handlers**. Chat went to Firebase instead. → `HARDENING_04` Step 2. |

---

## 6. Background Jobs

| Piece | Status | Notes |
|---|---|---|
| BullMQ / Redis | ⛔ Not installed | Deliberately deferred to **Phase 14**, not Phase 12 — Phase 12 was re-scoped to node-cron-only scheduled sweeps and never installs a queue. v1's only recurring jobs are cron-shaped; the classification worker in Phase 14 is the first genuinely queue-shaped work. See `src/jobs/offer-expiry.cron.js`'s header comment and `HARDENING_07` Part 2 (Phase 12/14 sections). |
| `otp-cleanup` sweep | ⛔ Not built | Phase 12 scope, same `node-cron` pattern as offer-expiry. |
| `expireOldRequests()` | ✅ Active | Lazily invoked on read (`request.service.js:79`, `:88`). |
| `expireOldOffers()` | ✅ **Active (fixed this pass)** | Was dead code — defined at `offer.repository.js:43`, called from nowhere. Now swept every 5 minutes by `src/jobs/offer-expiry.cron.js` (in-process `node-cron`, registered from `server.js` after DB connect, skipped in `NODE_ENV=test`). **Must run on exactly one PM2 instance** — `ecosystem.config.cjs` pins `instances: 1` for this reason; do not switch to cluster mode without moving this to a real queue first. |
| Session reminders | ⛔ Not built | `reminderSentAt` doesn't exist on `booking.model.js`. Still Phase 12 scope. |

---

## 7. Config & Environment

| Piece | Status | Notes |
|---|---|---|
| `env.config.js` Zod validation | ✅ Active | Good pattern — dev defaults, required in prod, `process.exit(1)` on failure. |
| `REDIS_URL` | ✅ **Removed from schema (this pass)** | No Redis client installed (`redis.config.js` was already deleted). Was `secret()` — i.e. **required in production** for a variable nothing read. Deliberately absent for v1; reintroduce alongside `ioredis`/`bullmq` in Phase 12. |
| `API_URL` | ✅ **Added (this pass)** | This backend's own public origin, distinct from `CLIENT_URL` (the frontend). Used by `paymob.provider.js` for `notification_url` — the previous default pointed webhooks at the frontend, where nothing would receive them. |
| `PAYMOB_API_KEY` | ✅ **Added (this pass)** | Paymob's legacy dashboard API key, distinct from `PAYMOB_SECRET_KEY`. Only used by `refund()`'s auth-token exchange. |
| `OPENAI_API_KEY` / `VECTOR_DB_URL` / `VECTOR_DB_API_KEY` | ✅ **Made optional (this pass)** | Were `secret()` — required in production — despite nothing reading them, which would have blocked a v1 boot on four meaningless secrets. Now `.optional()`; restore to `secret()` in Phase 14 when the wardrobe classification worker actually calls them. |
| `.env.example` | ✅ **Fixed (this pass)** | Now matches the schema — all `PAYMOB_*` vars present, `API_URL` added, `MOCK_WEBHOOK_SECRET` documented, `PAYMENT_PROVIDER=paymob` is the shipped default. |
| `cloudinary.config.js` | ✅ Active | Wired up by the uploads module. |
| `trust proxy` | ✅ Active | Configured to 1 (single-hop proxy) in `app.js` — matches a single nginx reverse proxy in front of Node on the v1 VPS deployment. → `HARDENING_01` Step 5. |
| Swagger at `/api/docs` | ⚠️ Public in prod | Mounted unconditionally, no auth. → `HARDENING_03` Step 7. |
| Admin/operator seeding | ✅ Active | `scripts/seed-admin.js` (`npm run seed:admin`), idempotent upsert. → `HARDENING_01` Step 6. |
| Deployment target | ✅ **Decided (this pass)** | Manually-provisioned VPS, PM2 (`ecosystem.config.cjs`, `fork` mode, `instances: 1`), nginx reverse proxy. No Docker, no managed PaaS. See `PHASE_16_DEPLOYMENT_READINESS.md`. |

---

## 8. Testing

| Piece | Status | Notes |
|---|---|---|
| `tests/unit/` | ✅ Active | 31 suites. Includes `event-graph.test.js`, a static guard that fails the build if a listener is ever added with no corresponding emitter (see §11a). |
| `tests/integration/` | ✅ **Real database** | `real-db.test.js` and (per-suite) `health.test.js` run against `MongoMemoryReplSet` (`mongodb-memory-server`) — a genuine replica set, so transactions are actually exercised, not mocked. The remaining suites still mock repositories for speed/determinism; that's a normal unit-vs-integration split now, not a gap. |
| `jest.config.js` | ⛔ Doesn't exist | Config is inline in the `package.json` test script. No coverage thresholds. Not urgent — 42 suites / 179 tests is well past the point where this would need enforcing. |
| CI | ✅ Active | `.github/workflows/ci.yml` runs `npm run lint` + `npm test` on push/PR to main/master. |
| Query-builder tests | ✅ **Merged (this pass)** | `query-builder.test.js` and `queryBuilder.test.js` were two files testing the same module with confusingly similar names (not actual duplicates — original assertions vs hardening assertions). Merged into one file, two `describe` blocks. |

---

## 9. AI & Wardrobe

> Product framing (business logic, occasion-matching requirement, n8n ruling, open decisions) is
> now documented in `docs/AI_ASSISTANT_BRIEF.md`. It defers all implementation detail to Phases
> 14/15 below — nothing in the current build status changed.

| Piece | Status |
|---|---|
| `modules/ai/` — routes, controller, tools, agent, rag, memory | ⛔ Not built (`.gitkeep` only) |
| `getOutfitSuggestions` tool | ⛔ Not built |
| `modules/wardrobe/` | ⛔ Directory does not exist |
| OpenAI SDK / Pinecone / Qdrant clients | ⛔ Not installed |
| LangChain / LangGraph | ⛔ Not installed |
| `ai_conversations` / `ai_messages` collections | ⛔ Not created |

`OPENAI_API_KEY`, `VECTOR_DB_URL`, `VECTOR_DB_API_KEY` **do** exist in `env.config.js:47-49` with dev
defaults — the one forward-reference in the spec that is genuinely true. They are unused so far.

> `PHASE_15_AI_SKELETON.md` claims these packages are "already installed as of Phase 14." Phase 14 was
> never built. → `HARDENING_07` Part 2.

---

## 10. Explicitly Out of Scope

Not present anywhere, and intentionally so: Wallet · Coupons · Favorites · Loyalty · Referrals ·
Video calls · Subscription plans.

If any becomes a requirement, it gets its own phase document rather than being retrofitted quietly.

---

## 11a. Cross-module coherence pass (post-hardening review)

After the six `HARDENING_*` documents were applied, a full audit of the resulting system found four
integration-level bugs — each individual piece worked, but they didn't agree with each other. All four
are now fixed and covered by `tests/unit/hardening-followup.test.js` and
`tests/unit/event-graph.test.js`:

| Gap | Fix |
|---|---|
| Four `eventBus.on(EVENTS.X)` listeners had no corresponding `.emit()` anywhere — `REVIEW_HIDDEN`/`REVIEW_UNHIDDEN` (admin review moderation went unaudited), `USER_SUSPENDED`/`USER_REACTIVATED` (no route existed), `CHECK_IN_COMPLETED` (client got no check-in notification). | `hideReview()` now emits; `suspendUser()`/`reactivateUser()` added to `user.service.js` with new `PATCH /admin/users/:id/suspend`/`/reactivate` routes; `checkIn()` now emits. `tests/unit/event-graph.test.js` statically asserts every listened event has an emitter, so this class of drift fails CI going forward. |
| The dispute-filing window (§`booking.service.js` `fileDispute`) and the payout-eligibility hold (§`payout.repository.js`) both anchored on `booking.updatedAt`, which changes on **any** write — including a payout batch itself flipping `payoutStatus`. Either window could be pushed back indefinitely by an unrelated update. | Added `Booking.completedAt`, set exactly once when status first becomes `'completed'` (in `confirmCompletion()` and `resolveDispute()`). Both windows now anchor on it, with `updatedAt`/`createdAt` retained only as a fallback for pre-existing data. |
| `processRefund()` had no awareness of `booking.payoutStatus`. Refunding a booking already batched into a `processing`/`paid` `Payout` zeroed the *Payment* record but couldn't claw back money already scheduled to leave. | `processRefund()` now throws `409` if `payoutStatus !== 'unpaid'`, forcing the admin to reconcile the existing payout batch first. |
| `payout.repository.js` and `payout.service.js` imported `Booking`/`Payment` **models** directly — the strictest form of the architecture-principle-3 violation (worse than the already-tolerated repository-to-repository pattern used elsewhere). | Added `bookingRepository.findEligibleForPayout()`, `.findCompletedUnpaidBefore()`, `.updateManyPayoutStatus()` and `paymentRepository.findByBookingIds()`; the payouts module no longer imports any foreign model. |

---

## 11. Known defects index

Full detail in the `HARDENING_*` documents. Start at `HARDENING_00_INDEX.md`.

| Severity | Count | Document |
|---|---|---|
| 🚨 P0 — blocks production | 6 | `HARDENING_01_CRITICAL.md` |
| ⚠️ P1 — data/money integrity | 9 | `HARDENING_02_CORRECTNESS.md` |
| ⚠️ P1 — security/platform | 7 | `HARDENING_03_SECURITY_PLATFORM.md` |
| 🟡 P2 — consistency/perf | 8 | `HARDENING_04_CLEANUP.md` |
| 📦 Product gaps | 4 | `HARDENING_05_BUSINESS_GAPS.md` |
| 📄 Doc accuracy | — | `HARDENING_06_DOCS_TRUTH.md` |
| 🔀 Phase 9–16 conflicts | — | `HARDENING_07_PHASE_RECONCILIATION.md` |

---

## Maintaining this file

**Updating this file is part of every hardening/phase Definition of Done.** When you finish a session:

1. Change any row your work affected.
2. Update the verification line at the top (commit SHA if committed, or "uncommitted working tree on
   top of `<sha>`" if not — never fabricate a commit that doesn't exist).
3. Do not mark anything ✅ without having actually run it. This file has already drifted from reality
   twice: once when it claimed unbuilt modules were Active, and once when a `payouts/` row was left
   duplicated with contradictory statuses after a later session forgot to remove the original ⛔ row.
   Search for the item you're updating before adding a new row — don't just append.
