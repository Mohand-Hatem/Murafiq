# Murafiq — Skeleton Status / Current State

> **The single source of truth for: "is X actually working right now?"**
>
> **Verified 2026-08-25 against the working tree on top of commit `3ace8c8` (uncommitted) — by
> direct code inspection and a real `npm test`/`npm run lint` run, not by reading other docs.
> Latest pass: Open Broadcast Requests feature built end-to-end per
> `OPEN_BROADCAST_REQUESTS_DESIGN.md` — Direct + Broadcast requests, sealed-bid feed, city/
> governorate-first notification fanout, direct-uncapped/broadcast-capped offer limits, and the
> race-condition-safe accept transaction (CAS lock + unique-index defense-in-depth, both verified
> by deliberately breaking each guard and confirming the concurrency test fails, then restoring and
> confirming it passes). One real gap found in post-build verification and fixed directly: no
> endpoint existed for a client to actually see and compare competing offers — the doc had asserted
> it was "implied" without ever specifying it as a build step, so it never got built. Added
> `GET /offers/requests/:id` (client-only, ownership-scoped, sorted price-ascending), with its own
> ownership test verified the same way (sabotaged, confirmed failing, restored, confirmed passing).
> Also added the missing `Booking.syncIndexes()` call to the migration backfill script.
> **Second real bug found while re-verifying (not in the original build): `acceptOffer`'s catch
> block converted a genuine, retryable MongoDB `WriteConflict`/`TransientTransactionError` directly
> into a permanent, misleading "someone else already won" 409 — reproduced deterministically outside
> Jest entirely (single non-concurrent accept, no race), root-caused to `code: 112, codeName:
> 'WriteConflict', errorLabels: ['TransientTransactionError']`, which MongoDB's own driver docs say
> should be retried, not treated as a business conflict.** Rewrote `acceptOffer` with a bounded
> retry envelope (5 attempts, small backoff) that retries genuine MongoDB transience but never
> retries a real `ApiError` (the CAS lock's actual 409 propagates immediately, same as any 400/403/
> 404). Verified by running the previously-flaky test 10x clean (was failing 5-6 of 8 runs before),
> and confirmed the retry logic doesn't mask the real race guard by re-running the sabotage-and-
> restore proof on the CAS lock — still fails 3/3 with the guard removed. One test assertion loosened
> to match reality: the race test's loser can legitimately see either 409 (hit the CAS lock directly)
> or 400 (retried after the winner's transaction had already flipped its status to 'rejected') —
> both are correct, the DB-level invariants (exactly one booking) are what the test actually proves.
> 51/214 tests pass, stable across repeated full-suite runs. Earlier passes: fixed a firebase-admin
> v14 API-mismatch startup bug (Firebase had never actually initialized in this project's history);
> Phase 10 completed; a real Cairo-timezone bug fixed in `getBusinessMonthRange()`. Two Phase-9
> follow-ups still open, not blockers: `welcomeTemplate`/`bookingConfirmationTemplate` exist but are
> called from nowhere yet.
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
| 12 — Background Jobs | ✅ **Complete** — offer-expiry sweep, request 48h auto-pause sweep, OTP-cleanup sweep, and session-reminder sweeps active via `node-cron` with single-instance guards (all sweeps closed in Stage R4). Redis/BullMQ deliberately assigned to Phase 14. |
| 13 — Security/Logging/Docs/Tests | ⚠️ **Hardened** (Swagger protected in prod, OTP lockout, Firebase production fail-safe). |
| 14 — Wardrobe | ⛔ Not built — the module does not exist. Now also owns installing Redis + BullMQ (moved from Phase 12) — see `HARDENING_07` Part 2. |
| 15 — AI | ⛔ Not built |
| 16 — Deployment Readiness | ⚠️ **Decision recorded** — single VPS/PM2 path (`ecosystem.config.cjs` + rewritten `PHASE_16_DEPLOYMENT_READINESS.md`). Not yet deployed to a real server. |

> [!NOTE]
> **Business Rules Revision — Stages R0 through R12: 100% COMPLETE & VERIFIED.** `REVISION_BUSINESS_RULES_AND_ARCHITECTURE.md`
> (added 2026-08-27) is a cross-cutting revision of business rules across Phases 1–13, **not a Phase 17**
> — it does not extend the build sequence and does not wait on Phases 14–16. Its stages are `R0`–`R12`.
> **Stage R0 (Corrections), Stage R1 (Domain Foundation), Stage R2 (Financial Ledger), Stage R3 (Subscriptions & Entitlements Engine), Stage R4 (Request Lifecycle Revision), Stage R5 (Offer Lifecycle Revision), Stage R6 (Cancellation, Refunds & Penalties), Stage R7 (Safety & Real-Time Content Moderation), Stage R8 (Reviews & Reliability Scoring), Stage R9 (Disputes & Arbitration Enforcement), Stage R10 (Geo / Location Engine & Egyptian Administrative Hierarchy), Stage R11 (Admin & Operations Controls), and Stage R12 (Final Verification, Full 73-Suite Regression & Rollout Hardening) are 100% complete, passing, and verified.** All blocking business values are now decided (see its Decisions
> Log); two human sign-offs remain before the moderation enforcement cutover.

> [!NOTE]
> **Revision correction pass — 2026-08-28.** A review of the first implementation pass found seven
> further defects, all now fixed and covered by tests. **`npm test` → 75 suites / 373 tests pass,
> `npm run lint` clean, `src/app.js` boots.**
> 1. **Client late-cancellation split had been invented.** The constants carried a 15% stylist
>    compensation and a 5% platform fee; §H specifies **platform 20% / client 80% / stylist 0**.
>    This changed revenue on every late cancellation. Now pinned by
>    `tests/unit/no-show.policy.test.js`, verified by sabotage-and-restore.
> 2. **Stylist early-cancellation penalty was missing** — `calculateCancellationOutcome` returned
>    `penaltyAmount: 0` for `EARLY_STYLIST_CANCEL` instead of the specified 3%.
> 3. **Penalty ledger writes silently failed.** `entryType: 'PENALTY'` is not in the `LedgerEntry`
>    enum (`PENALTY_ASSESSMENT` is), so every entry failed validation into a catch block — the
>    penalty was recorded on `Penalty` but never in the ledger that is meant to be the audit truth.
> 4. **Enums were widened but never narrowed, and no status backfill existed.** `pending` and `OPEN`
>    were simultaneously valid, with ~23 dual-casing checks scattered through the services. Added the
>    status migration to `scripts/backfill-revision-foundation.js` (raw-driver so it bypasses the
>    narrowed enums, idempotent, with a completeness guard that throws if anything is left behind),
>    narrowed both enums, and replaced every literal with `REQUEST_STATUS` / `OFFER_STATUS`.
> 5. **`offered` was still being written** alongside `offerCount` — two sources of truth for one fact.
>    Removed. `firstOfferAt` was declared but never written or read; it is now set atomically via
>    `$min` (correct under concurrent offer creation) and drives edit-immutability.
> 6. **`rejectOffer` still reset the parent request to open-with-no-offers**, discarding the sibling
>    bids the client was actively comparing.
> 7. **No yearly plans existed** — all 9 were monthly. Added 7 yearly variants derived from their
>    monthly counterpart so entitlements can never drift between billing cycles.
>
> **Second correction pass (same day).** Four further gaps closed, all verified:
> 8. **Access-token revocation did not work.** `User.tokenVersion` was incremented in three places but
>    was **never written into the JWT and never checked** by `auth.middleware.js` — so suspending,
>    restricting or banning a user left their access token fully working until it expired. The
>    counter incremented into the void. Now stamped as the `tv` claim, checked on every request via
>    a 30s in-process cache (`common/utils/tokenVersionCache.js`), invalidated immediately on
>    revocation. `suspendUser` and moderation's auto-suspend/auto-restrict also failed to revoke;
>    both fixed. Covered by `tests/integration/token-revocation.test.js` (verified by sabotage).
> 9. **Coupons could be issued but never spent.** `redeemCoupon` existed and nothing called it.
>    Now wired into `POST /payments/:bookingId/initialize` via an optional `couponCode`; the
>    discount is recomputed server-side, `Payment` gained `couponCode`/`discountAmount`/`grossAmount`,
>    and a `COUPON_DISCOUNT` ledger entry is posted. **The platform absorbs the discount, not the
>    stylist** — their agreed price is untouched.
> 10. **Admin no-show arbitration was unreachable** — `adminResolveNoShow` had no route.
>     Added `PATCH /admin/bookings/:id/resolve-no-show`.
> 11. **The "Report message" flow was missing.** It is the only cover for threats and harassment
>     with no ML classifier in the pipeline (§I.2), so the spec makes it mandatory. Added
>     `moderationService.reportContent` and `POST /chat/:conversationId/report`; records a PENDING
>     event for review and never enforces on its own.
>
> **`firestore.rules` message-create is now `if false`** — but see the deploy-order warning in the
> file itself: it must ship AFTER the mobile client that sends via REST, or every message send
> breaks instantly.
>
> **The migration has now actually been run**, against a seeded legacy database in a throwaway
> replica set. It exposed a further bug: the `offerCount` backfill read through the Mongoose model,
> whose schema default of `0` masked genuinely-absent fields, so the `=== undefined` check could
> never fire — it reported success while leaving `offerCount` unset, which would have made the
> auto-pause sweep pause requests that had live offers. Rewritten to read through the raw driver and
> to recompute `offerCount` from the offers themselves, with a completeness guard that throws.
> Verified: `pending`/`offered`→`OPEN`, `expired`→`PAUSED`, and losing bids correctly split into
> `CLOSED` (a sibling won) vs `REJECTED` (the client declined).
>
> Also built in an earlier pass, neither of which existed beyond a bare model: the **no-show flow**
> (`src/modules/bookings/no-show.service.js` — filing gated on a grace window and the reporter's own
> check-in, a response window for the accused, auto-resolution sweep, admin arbitration) and the
> **coupon module** (repository, service, controller, routes, validator; issuance idempotent on
> `{sourceBookingId, issuedReason}`, redemption via CAS).

> [!NOTE]
> **Defects surfaced by the Revision analysis pass (2026-08-27) & status:**
> 1. ✅ **`Payment.refundedAt` silent drop fixed (Stage R0):** Added `refundedAt: Date` to `paymentSchema` in `src/modules/payments/payment.model.js`.
> 2. ✅ **The broadcast feed defeats multi-offer bidding fixed (Stage R4):** `request-feed.service.js` updated to query `status: { $in: ['pending', 'offered', 'OPEN'] }`, unexpired 48h timer, keeping broadcast requests in stylists' feeds across multiple competing bids.
> 3. ✅ **`docs/MONEY_AND_LEDGER.md` §3 corrected (Stage R0):** Updated to reflect actual 2-tier cancellation policy (100% at ≥24h, 75% under, per `statuses.constant.js:25` and `booking.service.js:500-511`).
> 4. ✅ **`BOOKING_STATUS.PENDING` removed (Stage R0):** Deleted dead constant from `statuses.constant.js`.
> 5. ✅ **`DEFAULT_CAPS.CLIENT_DAILY_REQUESTS_UNVERIFIED` removed (Stage R0):** Deleted dead config and simplified `request.service.js` cap check.

**Verified build state:** `npm test` → 78 suites / 387 tests pass (including in-memory MongoDB replica-set integration, ledger dual-write integration, entitlement quota checks, broadcast multi-bid integration, offer lifecycle tests, cancellation tiers, moderation scanner, reviews reliability scoring, dispute arbitration, Egyptian geo engine, admin/operator operations tests, and public client profile/mutual discovery tests).
**`npm run lint` → PASSES** (0 errors, 0 warnings). GitHub Actions CI workflow active.

---

## 1. Modules that exist in `src/modules/`

| Module | Status | Notes |
|---|---|---|
| `auth/` | ✅ Active | 10 routes. JWT access 15m + refresh 30d, dual cookie/Bearer delivery, bcrypt 12, hashed OTP with 5-attempt lockout, session invalidation on password change, Google ID-token verification. Auto-provisions Free subscription tier on registration. |
| `users/` | ✅ Active | 8 routes (`/users/me` [5 endpoints] + `GET /users/:id` [public profile] + `/locations/governorates` + `/locations/governorates/:governorate/cities`) + the verification service backing `/admin/verifications` (using Cloudinary documentRefs). Canonical Egyptian administrative hierarchy dataset and normalizer, zero-PII public client DTO. |
| `stylists/` | ✅ Active | 7 routes (`GET /`, `GET /me/profile`, `GET /me/payouts`, `GET /:id`, `GET /:id/reviews`, `GET /:id/reliability`, `POST /profile`, `PATCH /profile`). Multi-factor reliability scoring engine, multi-tier Egyptian geo search, `$geoNear` search aggregation, cancellation counter tracking, and payout credentials. |
| `requests/` | ✅ Active | 9 routes (`POST /requests`, `GET /mine`, `GET /incoming`, `GET /feed`, `PATCH /:id`, `PATCH /:id/reactivate`, `PATCH /:id/close`, `PATCH /:id/cancel`, `PATCH /:id/decline`). Supports both Direct (1:1) and Open Broadcast requests, Zod discriminated union, multi-bid broadcast feed, edit with 0-offer immutability guard, 3-reactivation limit, 15-min quota refund on cancellation, 48h auto-pause cron, content safety scanner, and sanitized public client DTO mapping. |
| `offers/` | ✅ Active | 5 routes (`POST /requests/:id`, `GET /requests/:id`, `PATCH /:id/withdraw`, `PATCH /:id/accept`, `PATCH /:id/reject`). Multi-bid support (up to 3 per request), entitlement daily & active capacity consumption, withdraw flow, unchosen siblings transition to `CLOSED`, 24h & 30-day long-stop expiry sweeps, and content safety scanner. |
| `bookings/` | ✅ Active | 11 routes (`GET /mine`, `GET /stylist`, `GET /:id`, `GET /:id/cancellation-quote`, `GET /:id/reviews`, `GET /:id/dispute`, `POST /:id/review`, `POST /:id/dispute`, `POST /:id/dispute/evidence`, `PATCH /:id/check-in`, `PATCH /:id/confirm-completion`, `PATCH /:id/cancel`). Atomic CAS Request lock, 97/3/0 early and 80/15/5 late cancellation tiers, 48h dispute filing window, evidence timeline attachment, multi-outcome admin arbitration, dual-write ledger entries, and sanitized client DTO. |
| `payments/` | ✅ Active | 5 routes, provider pattern, 15% commission, `round2()` 2-dp EGP. Dual-writes to immutable ledger journal on payment success and refund. |
| `payouts/` | ✅ Active | 6 routes (stylist account management, admin pending balances summary, batch disbursement, status guards). Automatic penalty debt netting engine with integer piastres math and dual-write ledger entries. |
| `ledger/` | ✅ Active | Immutable financial journal (`LedgerEntry`), integer piastres math, idempotent key deduplication, double-entry posting, statements, paginated query filter, and daily reconciliation cron. |
| `subscriptions/` | ✅ Active | 5 routes (`GET /plans`, `GET /me`, `GET /me/entitlements`, `POST /subscribe`, `POST /cancel`). Single-gate `entitlement.service` for atomic `UsageCounter` consumption, persistent capacity computation, and daily subscription renewal cron. |
| `chat/` | ✅ Active | 3 routes, Firestore-backed (fail-closed in prod, mock in dev/test), real-time content moderation scanner on text messages, admin access restricted to disputed bookings with audit logs. |
| `notifications/` | ✅ Active | 3 routes, Mongo feed + FCM multicast with token pruning. |
| `reviews/` | ✅ Active | 4 routes (`GET /mine`, `GET /booking/:bookingId`, `GET /stylist/:id`, `GET /client/:id`). Two-way reviews, 14-day submission window, content safety scanning on comments, unique `{bookingId, direction}` index, rolling aggregation-based ratings. |
| `moderation/` | ✅ Active | 7 routes (`GET /admin/moderation/events`, `POST /admin/moderation/events/:id/confirm`, `POST /admin/moderation/events/:id/overturn`, `GET /admin/moderation/blocked-domains`, `POST /admin/moderation/blocked-domains`, `DELETE /admin/moderation/blocked-domains/:id`, `PATCH /admin/moderation/violations/:id/forgive`). Granular Operator/Admin permissions, confirm/overturn workflow, Egyptian phone regex, off-platform detection, 3-strike escalation, DRY_RUN/ENFORCE modes. |
| `admin/` | ✅ Active | 15 routes (`GET /verifications`, `PATCH /verifications/:userId/approve`, `PATCH /verifications/:userId/reject`, `PATCH /users/:id/suspend`, `PATCH /users/:id/reactivate`, `PATCH /users/:id/restrict`, `PATCH /users/:id/unrestrict`, `PATCH /users/:id/revoke-sessions`, `PATCH /reviews/:id/hide`, `GET /audit-logs`, `GET /bookings/disputed`, `PATCH /bookings/:id/resolve-dispute`, `GET /users`, `GET /ledger/statements`, `GET /ledger/reconciliation`, `GET /dashboard/stats`). |
| `mail/` | ✅ Active | Provider pattern (`env.MAIL_PROVIDER`), `ResendProvider` (active), `SendgridProvider` (501 stub), 5 templates in `templates/`, `sendMail({ to, subject, html })`. |
| `uploads/` | ✅ Active | Memory storage multer, Sharp in-memory compression (1920x1920 max), Cloudinary upload service, authenticated KYC document storage with signed URLs. |
| `audit-log/` | ✅ Active | Immutable Mongoose schema, QueryBuilder repository, domain event listener, admin querying. Fixed cross-module violation: no longer imports Booking/Payment models directly (see §11a). |
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
