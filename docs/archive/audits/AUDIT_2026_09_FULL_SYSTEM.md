# Murafiq — Full System Audit (Phases 0–15)

> **Date:** 2026-09-11 · **Scope:** entire backend + all documentation ·
> **Type:** report only, no source changes.
>
> This audit assumes neither the code nor the documentation is correct, and
> treats conflicts between them as findings in their own right. Every CRITICAL
> and HIGH below was re-read at the cited `file:line` before being accepted.
>
> **Read alongside** `hardening/next-phase/BACKLOG.md` — this audit
> re-verifies those 14 deferred items rather than restating them, and adds what
> that pass did not cover.

---

## 1. Executive Summary

**Overall health: structurally strong, with a small number of severe defects
that the test suite is shaped to miss.**

This is a well-engineered codebase. The layering (`Route → Validator →
Controller → Service → Repository → Model`) is real and consistently applied
across 23 modules; the DTO layer genuinely prevents Mongoose documents from
reaching HTTP responses; Zod `.strict()` is used everywhere, and no
mass-assignment path exists; the offer-acceptance race is closed by three
independent mechanisms; the ledger primitives are correct double-entry with
integer minor units and real idempotency keys. The inline commentary is unusually
high-quality — most non-obvious decisions carry a written rationale explaining
what was tried and why it was rejected. That is rare and it made this audit
faster.

**The problem is not the architecture. It is that several controls which the
documentation describes as live are, in fact, inert** — and in each case a
passing test suite conceals it. `npm run verify` was run as part of this audit:
lint clean, OpenAPI clean (137/137 routes documented), and
**102/102 suites with 635/635 tests passing, exit code 0**. All four defects
below are live in that same green tree:

- **A stylist no-show never refunds the client** (X1). Two individually-correct
  hardening fixes collide through an overloaded `payoutStatus` value. The client's
  money silently stays in escrow. Both halves are unit-tested and green; the
  interaction is untested because the only no-show test covers the *client*
  branch and mocks the refund.
- **The moderation enforcement gate can never fire** (X2). `MODERATION_MODE` is
  absent from the env schema, which strips unknown keys — so the flag is
  permanently `undefined`, the `422` is never thrown, and flagged contact details
  always pass. The tests reach that branch only by mutating the imported config
  object at runtime.
- **The OTP 5-attempt lockout is inoperative** (X3). `otpAttempts` is
  `select: false` and is missing from the `withSecrets` projection, so the
  counter reads `undefined` on every attempt and never reaches the threshold. An
  integration test *asserts* the field is undefined — the bug is pinned by a test.
- **An admin can resurrect any booking from any state to `confirmed`** (X4), with
  no status guard and no check that a no-show was ever reported.

The common shape is worth naming: **every one of these is an integration defect
between two independently-correct units, and the suite's heavy use of module
mocks is what hides them.** This is not a call for "more tests" — it is a
specific argument that the money and moderation paths need tests that exercise
real collaborators.

**Architectural maturity: high.** Module boundaries are respected, the two
documented cross-module exceptions are genuinely justified, the provider pattern
is properly applied to payments and mail. The one real architectural gap is that
the booking state machine is **scattered across nine writers** with no central
transition table, which is the direct cause of X4, X9 and X10.

**Business-logic correctness: mixed.** The marketplace loop (request → offer →
booking → completion) is correct and well-guarded. The money *edges* —
no-shows, disputes, admin refunds, cancelled-booking escrow — are where the
defects cluster.

**Security posture: good core, three serious gaps.** Auth is genuinely well
built: distinct secrets, per-session refresh rotation with an atomic CAS and
replay detection, SHA-256 session hashes, full invalidation on password change.
Multi-tenant scoping is disciplined and I found **no IDOR and no cross-user data
leak**. Against that: the OTP lockout is dead, the moderation gate is dead, and
`NODE_ENV` defaults to `development` with placeholder JWT secrets on disk.

**Production readiness: not yet.** X1 loses customer money silently. X6 is a
deployment foot-gun that yields forgeable admin tokens. Beyond the defects, there
is **no observability** — no correlation IDs, no alerting sink, no coverage
threshold. The single control that detects money moving without a ledger record
writes to a log file nobody watches.

**Phase 15 readiness: the prerequisites are nearly met, but the foundation has
holes.** `src/modules/ai/` is empty; Phase 15 is 0% implemented. Two of the five
`HARDENING_08` blockers are genuinely closed (SSRF, wardrobe quota). The concern
is not Phase 15's own design — it is that 15B's scope guard is the same shape of
control as the moderation gate that currently cannot enforce (X2), and that
15F is hard-blocked on upload authorization by its own amendment.

**Biggest risks, in order:** (1) silent client money loss on stylist no-shows;
(2) a moderation system believed to be one flag away from enforcing that is in
fact non-functional; (3) a dead OTP lockout behind IP-only rate limiting; (4) an
admin endpoint that can un-finalize any booking; (5) `NODE_ENV` defaulting to
development.

---

## 2. Overall Statistics

| Metric | Count |
|---|---|
| JS source files | 342 |
| Markdown documents reviewed | 68 (54 `docs/`, 13 `docs/hardening/`, `AGENTS.md`) |
| Modules | 23 (**2 empty**: `ai/`, `safety/` — `.gitkeep` only) |
| Mongoose models | 25 |
| Services / Repositories / Controllers | 25 / 24 / 19 |
| HTTP endpoints | ~137 across 18 routers + `/health` |
| Unauthenticated endpoints | 9 (both webhooks HMAC-verified) |
| Test files | 102 (41 integration, 61 unit) — **635 tests, all passing** (Appendix B) |
| Background jobs | 7 in-process `node-cron` + 1 BullMQ worker |
| Phases audited | 0–16 (17 phase docs + 6 Phase-15 sub-docs) |

### Findings by severity

| Severity | IDs | Count |
|---|---|---|
| CRITICAL | X1–X6 | 6 |
| HIGH | X7–X27 | 21 |
| MEDIUM | M1–M29 | 29 |
| LOW / INFO | L1–L16 | 16 |
| **Total** | | **72** |

### Findings by category

Assigned by **primary** category; most findings carry more than one tag, so read
this as a distribution, not a partition.

| Category | Count | Heaviest concentration |
|---|---|---|
| BUG | 21 | Booking lifecycle, subscriptions |
| SECURITY RISK | 14 | Auth, moderation, uploads |
| CONCURRENCY RISK | 11 | Payments, payouts, crons |
| BUSINESS LOGIC RISK | 8 | No-show, cancellation, entitlements |
| DOCUMENTATION DRIFT | 8 | `AGENTS.md`, `PHASE_05/06`, `03_SKELETON_STATUS` |
| TECH DEBT | 6 | Dead modules, swallowed errors |
| MISSING REQUIREMENT | 4 | Safety module, Socket.io, coupon issuance |
| PERFORMANCE RISK | 4 | Missing indexes, N+1, read-path writes |
| DESIGN RISK | 3 | Transaction guard, AI provider coupling |
| OVER-ENGINEERING | 3 | See §10 — notably little |

**Note on the 14 deferred HARDEN items:** all re-checked. **None has been
fixed.** HARDEN-004, 005, 009, 010, 012, 013, 014 were confirmed open by direct
read; 001 was confirmed open **and found to be worse than documented** (the
surrounding transaction does not cover the eligibility read either).

---

## 3. Phase Health Table

| Phase | Status | Confidence | Main issues | Notes |
|---|---|---|---|---|
| **0** — Setup & infrastructure | ⚠️ Needs attention | High | `NODE_ENV` defaults to `development` (X6); **Socket.io was never installed** despite being specified here and referenced in 8 docs | Layering, event bus, error handler, Swagger all real and good |
| **1** — Auth | ❌ Incorrect | High | **OTP lockout inoperative (X3)**; resend-OTP + register are enumeration oracles; revocation lags 30s because `invalidate()` is dead (X22) | Refresh rotation, replay detection and session invalidation are genuinely excellent — the defects are at the edges |
| **2** — Users & Verification | ⚠️ Needs attention | High | KYC docs are stored `authenticated` but `getSignedKycUrl` is **never called** — reviewers cannot view them; `blocked` users' profiles still public | Verification gating itself is correctly enforced at 4 points |
| **3** — Stylists & Search | ✅ Correct | High | Unescaped regex in governorate/city lookup (unscoped, collection-wide) | Sort allowlist, geo handling and the public DTO are all done right |
| **4** — Requests & Offers | ⚠️ Needs attention | High | Auto-pause cron lost update (bypasses repository, `doc.save()` with no precondition); losing stylists never notified; feed exclusion never fires; unbounded offer `duration` | **Offer acceptance concurrency is correct and tested** — three real layers |
| **5** — Bookings & Scheduling | ❌ Incorrect | High | **Admin can resurrect any booking (X4)**; disputes infinitely re-openable (X7); `in-progress` cancellable for 80% (X10); dispute evidence written as objects into a `[String]` path; every booking response returns a nameless counterparty (X26) | Session completion is the one race-free path in the module (two CAS stages) |
| **6** — Payments | ❌ Incorrect | High | **Stylist no-show never refunds (X1)**; no CAS on `Payment.status` (X18); webhook never verifies the amount (X19); admin refund zeroes stylist earnings (X21); refund calls the provider before persisting (X17) | HMAC verification is textbook-correct; coupon application is properly transactional |
| **7** — Chat & Notifications | ⚠️ Needs attention | High | Chat moderation bypassed via `type:'image'` (X12); report endpoint has no participant check (X13); **Socket.io realtime delivery does not exist** | Chat authorization fails closed; admin access is narrowly scoped and audited; `firestore.rules` is well-constructed |
| **8** — Reviews | ✅ Correct | High | `tags` accepted and silently discarded; raw E11000 leaks on concurrent double-submit | Two-way unique index and from-source aggregate recomputation are both right |
| **9** — Uploads & Mail | ⚠️ Needs attention | High | **No per-folder authorization** (HARDEN-004); Sharp failure uploads raw bytes; no HTML escaping in any mail template | Folder allowlist prevents traversal; Sharp re-encode is the right instinct |
| **10** — Audit Log & Admin | ⚠️ Needs attention | High | Audit writes are fire-and-forget, **never in the recording transaction**, not tamper-evident; `ip` always null; operator actions logged as `admin`; 3 session-revocation endpoints emit nothing | Event-bus-only discipline is correctly maintained; the new admin-grant work is well designed |
| **11** — Safety & Payouts | ❌ Incomplete | High | **Safety module does not exist**; `isFrozen` is read by payout eligibility and **never written** (X25), so an open safety report cannot block a payout — a stated invariant is unenforceable | Payouts themselves are built; `createBatchPayouts` has a retry-accumulator bug and no CAS (HARDEN-001) |
| **12** — Background Jobs | ⚠️ Needs attention | High | **All 7 crons run in host timezone** despite "Cairo time" comments — no `timezone` option anywhere; "single-instance guards" are process-local flags, not locks | BullMQ config (retries, backoff, concurrency, shutdown) is correct; reconciliation job's design reasoning is excellent |
| **13** — Security/Logging/Docs | ⚠️ Needs attention | High | Rate limiters all in-memory and IP-only; **no correlation IDs, no alerting sink, no coverage threshold** despite this phase requiring them | Swagger is admin-gated in production; mongo-sanitize applied; helmet present |
| **14** — Wardrobe | ⚠️ Needs attention | High | Model JSON regex-extracted with no schema validation into un-enumed fields; enqueue failure leaves permanently-pending items; unmetered embedding calls on PATCH | **Per-user vector namespaces are correctly applied on all three operations — no cross-user leak** |
| **14.5** — `HARDENING_08` | ⚠️ Partial | High | #1 SSRF ✅ closed · #2 wardrobe quota ✅ closed · #3 enum constraints ❌ · #4 structured output ⚠️ partial · #5 sub-category ❌ | Doc still marks itself "⛔ Not started" — it is *pessimistic*, which is the safe direction |
| **15 / 15A–15F** — AI | 💤 Not started | High | `src/modules/ai/` is `.gitkeep` only; no `/api/v1/ai` route | The commits labelled "AI Phase 15" added **specifications, not code** |
| **16** — Deployment Readiness | 💤 Deferred | High | `ecosystem.config.cjs` comment is stale; `instances: 1` is load-bearing for far more than it says | Decision recorded (single VPS/PM2); not deployed |
| **Revision R0–R12** | ⚠️ Needs attention | Medium | Claimed "100% complete and verified", but the moderation enforcement it specifies **cannot run** (X2), and plan versioning / proration from §E.5 were never built | Ledger, entitlements and cancellation-policy work did land and are solid |

**Legend:** ✅ Correct · ⚠️ Needs attention · ❌ Incorrect/Broken · 💤 Intentionally deferred

---

## 4. Findings

### CRITICAL

---

#### [CRITICAL] [BUG · BUSINESS LOGIC · MONEY] X1 — A stylist no-show never refunds the client

- **Location:** `src/modules/bookings/no-show.service.js:196-228`, `src/modules/payments/payment.service.js:364-371`
- **Evidence:**
  ```js
  // no-show.service.js:207 — the booking is updated BEFORE the refund
  payoutStatus: policy.STYLIST_PERCENTAGE > 0 ? 'unpaid' : 'paid', // 'paid' == nothing owed

  // payment.service.js:365-370 — processRefund then re-reads and refuses
  if (booking && booking.payoutStatus && booking.payoutStatus !== 'unpaid') {
    throw new ApiError(409, `Cannot refund: this booking's payout is already '...'`);
  }
  ```
- **Problem:** For `reportedAgainst: 'stylist'`, `NO_SHOW_POLICY.STYLIST.STYLIST_PERCENTAGE` is `0` (`statuses.constant.js:99-105`), so line 207 writes `payoutStatus: 'paid'`. The refund call at `:216-221` then hits the guard above and throws 409. That 409 is caught at `:222-228`, written to `refundError`/`refundFailedAt`, logged — and `resolveNoShow` **returns success**.
- **Why it matters:** `payoutStatus: 'paid'` is overloaded. `no-show.service` writes it to mean *"nothing is owed to the stylist"*; `processRefund` reads it to mean *"a payout batch has already gone out"*. Two individually-correct fixes, one shared value, opposite meanings.
- **Failure scenario:** A stylist fails to attend. The client reports it; the report is upheld. The booking becomes `no-show-stylist`, the stylist takes the 10% penalty, the client receives a goodwill coupon — and **the client's money stays in escrow permanently.** `Payment.status` remains `paid`. The only signal is one `logger.error` line in a file with no alerting. The client's only recourse is a support ticket.
- **Why the suite is green:** `tests/unit/no-show.service.test.js:106` contains the **only** `reportedAgainst` in the entire test suite, and it is `'client'` — the broken branch is never exercised. That test also mocks `processRefund` outright (`:42-44`), so the 409 could not fire even if it were. Meanwhile `tests/unit/hardening-followup.test.js:199-215` tests the `payoutStatus` guard in isolation and passes. **Both halves are tested and green; only their interaction is broken.**
- **Required fix:** Refund **before** writing `payoutStatus`, or stop overloading the value (introduce a `'not_owed'` state distinct from `'paid'`). Then make the whole of `resolveNoShow` transactional — that is HARDEN-003, still open. Add an integration test driving `resolveNoShow` with `reportedAgainst: 'stylist'` against a real Payment + Booking, asserting `payment.status === 'refunded'` and `refundAmount === payment.amount`.
- **Priority:** P0 · **Can it wait?** **No.** This loses customer money on every occurrence, silently.

---

#### [CRITICAL] [SECURITY · BUG] X2 — The moderation enforcement gate can never fire

- **Location:** `src/config/env.config.js:12-81`, `src/modules/moderation/moderation.service.js:71-138`
- **Evidence:**
  ```js
  // moderation.service.js:71
  const mode = env.MODERATION_MODE || 'DRY_RUN';
  const actionTaken = mode === 'ENFORCE' ? 'BLOCK_ONLY' : 'OBSERVED';
  ```
  `MODERATION_MODE` appears nowhere in `env.config.js`. The schema is a plain `z.object({...})` — which **strips** unknown keys — and the module exports the parsed result: `export default parsed.data;` (`env.config.js:81`).
- **Problem:** `env.MODERATION_MODE` is permanently `undefined`, `mode` is always `'DRY_RUN'`, and setting `MODERATION_MODE=ENFORCE` in `.env` or in PM2 has **zero effect**.
- **Why it matters:** The entire enforcement block (`:91-138`) is unreachable in production. No `PolicyViolation` is ever created; the 3-strike escalation never runs; `accountStatus` is never set to `suspended` or `restricted`; `tokenVersion` is never bumped; and **the `422` at `:134` is never thrown**. All six call sites — `chat.service.js:224`, `booking.service.js:386`, `offer.service.js:66`, `request.service.js:64` and `:161`, `review.service.js:62` — `await` a function that logs and returns `{ isAllowed: true }`.
- **Failure scenario:** Contact-detail exchange — the single behaviour the moderation system exists to prevent, and the platform's core trust-and-safety control — always passes. Operators believe the system is in a deliberate DRY_RUN observation period, one flag away from enforcing. It is not: flipping the flag changes nothing.
- **Conflicts with:** `STATUS.md` — *"two human sign-offs remain before the moderation enforcement cutover."* The cutover is a code change, not a sign-off.
- **Tests give false assurance:** `tests/unit/moderation.service.test.js:85` and `tests/integration/reviews-reliability.test.js:140` set `env.MODERATION_MODE = 'ENFORCE'` by mutating the imported config object at runtime — a branch reachable **only** from tests.
- **Required fix:** Add `MODERATION_MODE: z.enum(['DRY_RUN','ENFORCE']).default('DRY_RUN')` to the schema. Add a boot-time log of the resolved mode so a missing key can never again silently disable enforcement. Change the two tests to drive the real config rather than mutating the export.
- **Priority:** P0 · **Can it wait?** **No.** One line of schema, and the entire trust-and-safety subsystem is currently decorative.

---

#### [CRITICAL] [SECURITY · BUG] X3 — The OTP 5-attempt lockout is inoperative

- **Location:** `src/modules/auth/auth.repository.js:9,15,21`, `src/modules/users/user.model.js:28`, `src/modules/auth/auth.service.js:137-141,408-412`
- **Evidence:**
  ```js
  // auth.repository.js:9 — otpAttempts is NOT in the projection
  if (withSecrets) query.select('+passwordHash +otpCode +otpExpiresAt');

  // user.model.js:28 — but it is select:false
  otpAttempts: { type: Number, default: 0, select: false },

  // auth.service.js:137-138
  user.otpAttempts = (user.otpAttempts || 0) + 1;  // undefined||0 + 1 === 1, always
  if (user.otpAttempts >= 5) {                     // 1 >= 5 — never true
  ```
- **Problem:** Every OTP path loads the user with `withSecrets: true`, so `user.otpAttempts` reads `undefined` on every request. The counter never accumulates and the threshold is never reached. Identical defect in `resetPassword` at `:408-409`.
- **Why it matters:** The OTP is never burned after repeated failures. The only remaining brute-force control is `authRateLimiter` — **5 attempts per 5 minutes, keyed by IP, in an in-memory store** (see X27). Against a distributed attacker that is not a control.
- **Failure scenario:** A 6-digit OTP has 10⁶ possibilities and a 10-minute validity window. With the per-account lockout dead and only per-IP limiting, an attacker distributing across source addresses can brute-force a password-reset OTP inside the window and take over the account. The owner sees nothing.
- **The bug is pinned by a test:** `tests/integration/admin.users.test.js:114` asserts `expect(user.otpAttempts).toBeUndefined()`. And `tests/unit/auth.service.test.js:14` hand-builds a plain object with `otpAttempts: 4`, bypassing the projection entirely — so the unit test passes against a code path that cannot occur in production.
- **Required fix:** Add `+otpAttempts` to all three projections in `auth.repository.js`; update the two tests. Separately, add per-account (not per-IP) rate limiting on OTP verification.
- **Priority:** P0 · **Can it wait?** **No.** This is an account-takeover path.

---

#### [CRITICAL] [BUG · BUSINESS LOGIC] X4 — `adminResolveNoShow` resurrects any booking from any state

- **Location:** `src/modules/bookings/no-show.service.js:328-346`, routed at `src/modules/admin/admin.routes.js:137-142`
- **Evidence:**
  ```js
  export const adminResolveNoShow = async (adminUser, bookingId, { upheld, notes = '' }) => {
    if (adminUser.role !== ROLES.ADMIN) throw new ApiError(403, 'Forbidden');
    const booking = await bookingRepository.findById(bookingId);
    if (!booking) throw new ApiError(404, 'Booking not found');

    if (!upheld) {
      const restored = await bookingRepository.updateById(bookingId, {
        status: BOOKING_STATUS.CONFIRMED,   // ← from ANY prior state
  ```
- **Problem:** There is **no status guard** and **no check that a no-show was ever reported**. The status is reset to a hardcoded `confirmed` rather than to whatever the booking was before the report.
- **Why it matters:** `PATCH /api/v1/admin/bookings/<any-id>/resolve-no-show {"upheld": false}` un-completes a completed booking, un-cancels a cancelled one, and reopens a settled no-show. `resolveNoShowSchema` (`admin.validator.js:149-156`) defines a `body` but **no `params`**, unlike every sibling schema, so the id is not validated either.
- **Failure scenario:** An admin dismisses a no-show report and mistypes the booking id, hitting a completed, already-paid-out session. It becomes `confirmed` while retaining `payoutStatus: 'paid'`. It is now non-terminal, so the client can cancel it, triggering a second refund/penalty cycle against money that has already left the platform. Nothing in the audit trail distinguishes this from a legitimate dismissal.
- **Required fix:** Require an open no-show report (`noShowDetails.reportedAt` set, `confirmedAt` unset); restore to the **pre-report** status rather than a hardcoded `confirmed`; make the write a CAS; add `params` to the validator.
- **Priority:** P0 · **Can it wait?** **No.** Reachable by any admin, in one request, with no confirmation step.

---

#### [CRITICAL] [MONEY · CONCURRENCY] X5 — A paid subscription can be charged and never granted, with no retry path

- **Location:** `src/modules/subscriptions/subscription.service.js:566-599`
- **Evidence:**
  ```js
  if (order.status === 'paid') return { order, alreadyProcessed: true };   // :566-568
  ...
  const updatedOrder = await subscriptionOrderRepository.updateById(order._id, {
    status: 'paid', paidAt: new Date(), ...                                // :582-587
  });
  const updatedSubscription = await subscribe(order.userId, userRole, {    // :592
    ..., paid: true,
  });
  ```
- **Problem:** The order is marked `paid` **before** the grant, and the two are not in a transaction. If `subscribe()` throws — the 409 from the CAS at `:211`, a plan missing from the catalogue, a validation error — the order is already `paid`, and the provider's retry hits the early return at `:566` and **never retries the grant**.
- **Why it matters:** The customer has been charged, receives no entitlement, and gets **no ledger entry either**, because the ledger dual-write lives inside `subscribe()`. Nothing reconciles it: the reconciliation cron starts from `Payment` and never looks at `SubscriptionOrder` (see M2).
- **Failure scenario:** A plan is renamed or deactivated between checkout and webhook delivery. Every in-flight purchase of that plan is charged and silently ungranted, with no report that surfaces it.
- **Required fix:** Mark the order `paid` and apply the grant in one transaction; or mark `paid` only *after* a successful grant, making the transition a CAS (`findOneAndUpdate({_id, status:'pending'})`) so retries are safe. Add a sweep for `paid` orders with no matching active subscription.
- **Priority:** P0 · **Can it wait?** No — it takes money without delivering.

---

#### [CRITICAL] [SECURITY · DEPLOYMENT] X6 — `NODE_ENV` defaults to `development`; placeholder JWT secrets are on disk

*(HARDEN-005 — re-verified, still open.)*

- **Location:** `src/config/env.config.js:9-17`, working-tree `.env`
- **Evidence:**
  ```js
  const isProd = process.env.NODE_ENV === 'production';
  const secret = (devDefault) => (isProd ? z.string().min(1) : z.string().default(devDefault));
  NODE_ENV: z.enum(['development','production','test']).default('development'),
  JWT_ACCESS_SECRET: secret('dev_access_secret_change_me_in_prod'),
  ```
  The on-disk `.env` has `NODE_ENV=development` with both JWT secrets **byte-identical to the placeholders in the tracked `.env.example`**.
- **Problem:** Production hardening is gated on a variable that itself defaults to non-production. A deploy that omits `NODE_ENV=production` boots happily on publicly-known secrets.
- **Why it matters:** Anyone can mint `{sub: <any id>, role: 'admin', tv: 0}`, sign it with the placeholder, and obtain full admin access — including dispute resolution and payout batching.
- **Failure scenario:** The app is started with `npm start` or a bare `pm2 start`. Note `package.json`'s `start` script does **not** set `NODE_ENV`; only `start:prod` passes `--env production`. Amplifiers in the same state: `error-handler.middleware.js:33-35` attaches full stack traces to every error response, and `app.js:89-95` serves Swagger unauthenticated.
- **Mitigating:** `.env` is correctly gitignored and untracked — this is a deployment risk, not a disclosure.
- **Required fix:** Make `NODE_ENV` required with no default and fail closed. Add a boot assertion rejecting any secret equal to its placeholder, regardless of `NODE_ENV`.
- **Priority:** P0 (before any real deployment) · **Can it wait?** Only while nothing is deployed.
---

### HIGH

Format is compressed below — every entry still carries location, evidence, failure mode and fix.

---

**[HIGH] [BUG] X7 — Disputes are infinitely re-openable, and the second round bricks the booking**

- **Location:** `src/modules/bookings/booking.service.js:320-331`, `:487-489`
- **Evidence:** `:487-489` rewrites `completedAt` on resolution —
  `...(targetStatus === 'completed' ? { completedAt: new Date() } : {})` — while `:323`
  measures the 48h filing window from `completedAt`.
- **Problem:** Each admin resolution restarts the dispute clock. Note that `:321-322`
  carries the comment *"completedAt is set exactly once when status first becomes
  'completed' — do not fall back to updatedAt, which drifts on unrelated writes"*.
  `resolveDispute` is itself the write that breaks that stated invariant, three hundred
  lines below the comment asserting it. `disputeDetails` is *replaced* wholesale at `:335`, destroying the original filing while leaving the now-stale `disputeResolution` in place. There is no `disputeCount` and no reopen guard.
- **Failure scenario:** A client re-files immediately after every resolution, indefinitely. Worse, the **second resolution cannot complete**: `resolveDispute` calls `processRefund` at `:479` before writing the booking, and `payment.service.js:355-357` rejects an already-`refunded` payment — so the booking is left permanently stuck in `disputed` with no admin path out and the stylist never paid.
- **Fix:** Anchor the window on a separate `resolvedAt`; stop rewriting `completedAt`; refuse to re-open an already-resolved dispute. **P1 — no.**

---

**[HIGH] [CONCURRENCY · MONEY] X8 — The subscription renewal sweep can delete a plan the user just paid for**

- **Location:** `src/jobs/subscription-renewal.cron.js:19,34,67`
- **Evidence:** `findExpiringSubscriptions(now)` reads all expired rows, then `updateById` writes `planCode: freePlanCode, currentPeriodEnd: null` with **no re-check that the row is still expired**.
- **Problem:** No compare-and-set. The loop `await`s per subscription, so the race window is the entire sweep duration, not microseconds.
- **Failure scenario:** A Paymob webhook lands mid-sweep and grants a fresh period via `applyPlanGrant`. The sweep, holding a stale read, then overwrites `planCode` to `*.free` and `currentPeriodEnd` to `null`. **The user has paid and lost the plan**, with no history row recording it (see X15).
- **Fix:** CAS on `{_id, status:'active', currentPeriodEnd:{$lte: now, $ne: null}}`; treat `null` as "skip". Also violates `AGENTS.md`'s own rule to write plan changes through `replaceActivePlanCAS`, not `updateById`. **P1 — no.**

---

**[HIGH] [BUG · CONCURRENCY] X9 — `resolveNoShow` overwrites terminal states**

- **Location:** `src/modules/bookings/no-show.service.js:181-208`
- **Evidence:** The only guard is an early return when status is already `no-show-*`. The cron pre-filters on status (`booking.repository.js:221-228`) but `resolveNoShow` re-reads the document and never re-checks.
- **Failure scenario:** The 15-minute sweep selects a booking at T0. Both parties confirm completion at T1 — `promoteToCompleted` fires, `SESSION_COMPLETED` is emitted, reliability recomputes, chat locks. At T2 the sweep stamps `no-show-client`, deletes the schedule block, refunds 60% to the client and issues a coupon — **on a session that demonstrably happened**. `completedAt` survives, so the booking still matches payout eligibility via the `no-show-client` branch, at a lower amount.
- **Fix:** Re-check status inside the write as a CAS. **P1 — no.**

---

**[HIGH] [BUSINESS LOGIC] X10 — An `in-progress` session can be cancelled for an 80% refund**

- **Location:** `src/modules/bookings/booking.service.js:682-691`, `:546-586`
- **Evidence:** The guard blocks only `BOOKING_TERMINAL_STATUSES` and `'disputed'`; `'in-progress'` passes both. `calculateCancellationOutcome` prices purely on hours-to-appointment, so a session already under way has negative `diffHours` → `LATE_CLIENT_CANCEL` → 80% to the client, **stylist gets 0**.
- **Failure scenario:** The client lets the stylist complete the work, then cancels instead of confirming completion. The stylist's only recourse, `fileDispute`, requires status `in-progress` or `completed` (`:316`) — `cancelled` is neither. **There is no recourse.** This is directly exploitable and costs the stylist their entire fee.
- **Fix:** Add `'in-progress'` to the set that cannot be unilaterally cancelled by the client, or route it through the dispute flow. **P1 — no.**

---

**[HIGH] [BUG] X11 — Moderation admin review is a no-op**

- **Location:** `src/modules/moderation/moderation.service.js:231,247` vs `moderation-event.model.js:52`
- **Evidence:** The service writes `reviewOutcome: 'CONFIRMED'` / `'OVERTURNED'`. The model has **no such path** — it defines `reviewStatus` (enum `PENDING|APPROVED|DISMISSED`). Mongoose strict mode drops the unknown key silently.
- **Failure scenario:** `POST /admin/moderation/events/:id/confirm` and `/overturn` stamp a reviewer and timestamp but leave `reviewStatus: 'PENDING'` forever. The admin queue never clears, and `findOpenUserReport`'s anti-flood check (`moderation-event.repository.js:50-58`) never releases — so a reporter can never re-report the same message even after dismissal. Neither action creates a `PolicyViolation`, suspends, or restricts: **human review has no enforcement arm at all.** Combined with X2, moderation is non-functional in both its automated and manual halves.
- **Fix:** Write `reviewStatus`; add enforcement on confirm. **P1 — no.**

---

**[HIGH] [SECURITY] X12 — Chat moderation is bypassed by one field**

- **Location:** `src/modules/chat/chat.service.js:221-228`, `chat.validator.js:24-29`
- **Evidence:** `if (type === 'text' && content)` gates the scan; `content` is `z.string().trim().min(1).max(2000)` — **not URL-validated and not conditioned on `type`**.
- **Failure scenario:** `POST /chat/:id/messages {"type":"image","content":"call me 01012345678"}` skips the scan entirely, is stored verbatim, and `chat.dto.js:51-62` returns `content` unchanged for every type. Even with X2 fixed, this is a one-field bypass of the whole gate.
- **Fix:** Scan regardless of `type`, or require `content` to be a Cloudinary URL when `type === 'image'`. **P1 — no.**

---

**[HIGH] [SECURITY] X13 — `POST /chat/:conversationId/report` has no participant check**

- **Location:** `src/modules/chat/chat.controller.js:49-62`, `moderation.service.js:168-176`
- **Evidence:** The controller calls `moderationService.reportContent` directly, never touching `chatService` (which is where every other chat authorization check lives). `reportContent` validates only that the reporter is not reporting themselves.
- **Failure scenario:** Any authenticated user files a `USER_REPORT` against an arbitrary stranger on an arbitrary conversation id. Varying `messageId` defeats the dedup, making it a queue-flooding vector as well as a false-accusation one. `reportContent`'s own docstring warns that letting one user's accusation restrict another "would hand every user a weapon" — correct, but the queue-pollution surface is still open.
- **Fix:** Route through `chatService` and assert the reporter is a participant and the reported user is the counterparty. **P1 — no.**

---

**[HIGH] [BUG · DATA INTEGRITY] X14 — SubscriptionHistory is written before the write it describes, outside any transaction on the paid path**

- **Location:** `src/modules/subscriptions/subscription.service.js:174`, `:198`, `:210-212`, `:350`
- **Evidence:** `createHistoryEntry` at `:174` precedes `replaceActivePlanCAS` at `:198`; a lost CAS throws 409 at `:210-212`. `subscribe()` calls `applyPlanGrant` at `:350` with **no session**.
- **Problem:** On the billing path there is no atomicity between the history row and the plan write. A lost CAS, or an E11000 from the `createSubscription` else-branch at `:214`, leaves a permanent history row asserting a transition that never happened — and the model blocks every update and delete (`subscription-history.model.js:80-87`), so it can never be corrected.
- **Why it matters:** The admin path *did* get the transaction (`:693-704`), with a comment stating exactly this requirement ("must land together"). The path that matters for billing disputes did not.
- **Fix:** Write history inside the same session as the CAS on both paths, after the CAS succeeds. **P2 — yes, briefly.**

---

**[HIGH] [BUG · DOCUMENTATION DRIFT] X15 — The most common subscription transition writes no history**

- **Location:** `subscription-history.model.js:5-12,38-40`; `subscription-renewal.cron.js:34,67`; `subscription.service.js:315,439`
- **Evidence:** The model docblock claims an "append-only record of **every** Subscription plan transition" and names the renewal sweep explicitly. Grep confirms `createHistoryEntry` has exactly **one** caller (`subscription.service.js:174`).
- **Problem:** The renewal sweep, `cancelSubscription`, and the scheduled-downgrade branch all write via `updateById` with no history entry. Three of the six declared `changeType` enum values — `expiry_sweep`, `scheduled_downgrade`, `cancellation` — are **never written by any code path**.
- **Failure scenario:** A user disputes "I was on Pro until March." The expiry that moved them off Pro is the single most common transition in the system, and it left no record; the live row was overwritten in place. This is precisely the question the collection was built to answer.
- **Fix:** Route all four paths through `applyPlanGrant`, or call `createHistoryEntry` in each. **P2.**

---

**[HIGH] [BUSINESS LOGIC] X16 — Entitlements never check `currentPeriodEnd`**

- **Location:** `src/modules/subscriptions/entitlement.service.js:24-40`
- **Evidence:** `getEntitlements` resolves the plan from `findActiveByUserId` (which filters `status: 'active'` only) with no expiry comparison anywhere.
- **Failure scenario:** Expiry is enforced **solely** by the 02:00 daily sweep. A plan lapsing at 02:01 grants full paid entitlements for another ~24 hours — and indefinitely if the in-process cron stops, which nothing alerts on. Compare the coupon module, which checks expiry lazily at point of use (`coupon.service.js:100-102`) and treats the sweep as a cleanup convenience.
- **Fix:** Add a lazy expiry check in `getEntitlements`, making the cron a cleanup rather than the enforcement mechanism. **P1.**

---

**[HIGH] [MONEY · CONCURRENCY] X17 — `processRefund` calls the provider before persisting anything**

- **Location:** `src/modules/payments/payment.service.js:376-434`
- **Evidence:** `:376-378` calls `provider.refund()`; `:400` updates the Payment; `:411-434` posts the ledger. Three independent, unsessioned steps.
- **Failure scenario:** A crash between the provider call and the Payment write means the client was refunded and the platform has no record. The booking is still `paid` with a full `stylistPayoutAmount`, so it remains payout-eligible — **the stylist is then paid for a refunded session.**
- **Conflicts with:** `BUSINESS_RULES.md` §G.3, which specifies the opposite order (ledger inside the transaction, *then* the provider call) plus a retry queue. Neither is implemented. `booking.service.js` has the same shape — it commits the cancellation transaction and refunds afterwards, recording failures to `refundError`/`refundFailedAt`, fields **nothing in the codebase ever reads**.
- **Fix:** Persist intent first, then call the provider, then reconcile; add a retry consumer for the failure fields. **P2.**

---

**[HIGH] [CONCURRENCY] X18 — No compare-and-set on `Payment.status`**

- **Location:** `src/modules/payments/payment.repository.js:32-38`; `payment.service.js:229→245`, `:355→400`
- **Evidence:** `updateById` is a bare `findByIdAndUpdate` with no status predicate, used after a separate read.
- **Failure scenarios:** (a) *Webhook* — concurrent duplicate deliveries both pass the `status === PAID` check and `PAYMENT_SUCCEEDED` fires twice (`:287`), fanning out to chat unlock, notifications and the audit log. The ledger is protected by idempotency keys; the event fan-out is not. (b) *Refund* — two concurrent refund calls both pass and both invoke `provider.refund()`. The ledger key is scoped on the *reason string* (`:412`), so two refunds with different reasons produce two accepted ledger pairs.
- **Fix:** `findOneAndUpdate({_id, status: <expected>}, ...)` and treat `null` as already-processed. **P2.**

---

**[HIGH] [MONEY] X19 — The webhook never verifies the captured amount**

- **Location:** `src/modules/payments/payment.service.js:251`
- **Evidence:** `egpToPiastres(updated.amount)` reads the local record; nothing compares the callback's `amount_cents` against `payment.amount`.
- **Problem:** HMAC makes the payload unforgeable but not *correct*.
- **Failure scenario:** A partial capture, an under-capture, or an intention created before a coupon was applied all mark the booking fully `paid` and credit ESCROW more than was actually collected — which a later payout batch then pays out to the stylist.
- **Fix:** Compare `amount_cents` against the expected minor-unit amount and reject or flag a mismatch. **P2.**

---

**[HIGH] [MONEY · ACCOUNTING] X20 — Cancelled bookings never drain escrow**

- **Location:** `src/modules/payouts/payout.service.js:322-340`, `src/modules/bookings/booking.repository.js:158-165`
- **Evidence:** ESCROW → PLATFORM recognition exists in exactly one place — inside `markPaid`. `PAYOUT_ELIGIBILITY` matches only `status: 'completed'` or `'no-show-client'`.
- **Failure scenario:** A cancelled booking retains 3% (early) or 20% (late) for the platform per the cancellation policy, but never enters a payout batch — so that retained fee sits in ESCROW forever. Debits still equal credits, so the nightly reconciliation **never alerts**. The ESCROW account grows monotonically and platform cancellation revenue is permanently unrecognised in the ledger that is meant to be the audit truth.
- **Fix:** Recognise the retained platform fee at cancellation time, in the same transaction. **P2.**

---

**[HIGH] [BUSINESS LOGIC] X21 — Every admin refund silently zeroes the stylist's earnings**

- **Location:** `src/modules/payments/payment.controller.js:55-61`, `payment.service.js:348,387-389`, `payment.validator.js:31-42`
- **Evidence:** The controller forwards only `bookingId`, `refundPercentage` and `reason` — never `stylistPayoutOverrideAmount`, which therefore defaults to `0`. `:387-389` then computes `stylistPayoutAmount = min(0, retained) = 0`. The validator is `.strict()`, so an admin **cannot** supply the override even deliberately.
- **Failure scenario:** An admin issues a 50% goodwill refund for a partly-unsatisfactory session. The client gets 50% back; the stylist loses **100%** of their fee, not 50%. `resolveDispute` and `resolveNoShow` both compute the override correctly — this endpoint is the outlier. It also never updates `Booking.status`, so a refunded booking can remain `completed` and payout-eligible.
- **Fix:** Accept and forward the override; update booking status; or restrict this endpoint to full refunds only. **P1.**

---

**[HIGH] [SECURITY] X22 — Session revocation never takes effect early; the invalidation hook is dead code**

> **CORRECTION (2026-09-11 remediation pass).** This finding is a **FALSE POSITIVE.**
> `src/modules/users/user.service.js` already calls `invalidateTokenVersion(userId)` in
> `suspendUser`, `blockUser`, `unblockUser`, `restrictUser`, `unrestrictUser` and
> `revokeUserSessions` — six of the six functions that bump `tokenVersion`. The original
> grep that produced this finding searched `src/` incompletely and missed these call
> sites. `reactivateUser` does not call it, correctly: reactivation doesn't need to
> revoke anything, there is nothing to invalidate on the un-suspend path. No code
> change was made for this item. See `docs/archive/remediation/REMEDIATION_2026_09_FULL_SYSTEM.md` §12.

- **Location:** `src/common/utils/tokenVersionCache.js:91`, `src/common/middlewares/auth.middleware.js:26-27`
- **Evidence:** `invalidate(userId)` is exported and documented as "drop a user's cached version so the next request re-reads immediately". Grep across `src/` finds **zero callers**.
- **Failure scenario:** Suspend, block and revoke-sessions always lag the full 30s TTL (`:21`), contradicting the middleware's own comment that tokens "must stop working immediately." An admin suspends a user mid-abuse; that user keeps sending chat messages and creating offers for up to 30 more seconds — exactly the window that matters for a safety action.
- **Also:** the cache is per-process, so `instances: 1` is load-bearing for revocation correctness — documented nowhere (see M-ops).
- **Fix:** ~~Call `invalidate()` from `suspendUser`, `blockUser`, `restrictUser` and `revokeUserSessions`.~~ Already done. **No action required.**

---

**[HIGH] [SECURITY] X23 — `QueryBuilder.select()` and `.sort()` bypass `select: false`**

*(HARDEN-009 — re-verified, still open.)*

- **Location:** `src/common/query-builder/QueryBuilder.js:66-84`
- **Evidence:** `this.queryString.fields.replace(/\+/g,'').split(',').join(' ')` then `.select(fields)`. In Mongoose, an explicit inclusion projection **overrides** schema-level `select: false` — stripping the `+` does not help.
- **Failure scenario:** `GET /admin/users?fields=passwordHash` reaches `user.repository.js:50-53`, which passes no `fields` allowlist (note `.filter()` *does* take one). `.sort()` has the same gap, giving an ordering oracle over unselected fields (`?sort=passwordHash` orders by bcrypt hash).
- **Currently latent:** `user.service.js:392` maps results through the allowlist DTO, so nothing leaks today. It is one `return users` away from live. The right pattern already exists in the codebase — `stylist-search.service.js:7-15` enforces `ALLOWED_SORT_FIELDS` and throws 400 — and was simply not applied to the shared helper.
- **Fix:** Add a `fields`/`sort` allowlist parameter to `QueryBuilder`, defaulting to deny. **P1 (pre-production gate per the backlog).**

---

**[HIGH] [DOCUMENTATION DRIFT → MONEY] X24 — Three documents state cancellation percentages the code deliberately does not implement**

- **Location:** `AGENTS.md:181-184`, `docs/MONEY_AND_LEDGER.md:42`, `docs/archive/phases/PHASE_06_PAYMENTS.md:73,161` vs `src/common/constants/statuses.constant.js`
- **Evidence:** All three docs say **100% (≥24h) / 75% (<24h)**. The code implements `EARLY_CLIENT_REFUND_PERCENTAGE: 97` / `EARLY_PLATFORM_FEE_PERCENTAGE: 3` and `LATE_CLIENT_REFUND_PERCENTAGE: 80` / `LATE_PLATFORM_FEE_PERCENTAGE: 20`, consumed at `booking.service.js:555,573`. The Business Rules Revision changed the policy; the docs were never updated.
- **Why it matters:** `AGENTS.md` is the **always-loaded** agent contract. Every AI-assisted change to cancellation logic is currently handed the pre-revision numbers. `AGENTS.md:114` and `PHASE_05:177` additionally name constants (`CANCELLATION_FULL_REFUND_HOURS`, `CANCELLATION_PARTIAL_REFUND_PERCENTAGE`) that **do not exist**.
- **Failure scenario:** A well-intentioned "make the code match the documented contract" change alters the refund on every cancellation in production. This is the highest-consequence documentation defect in the repository.
- **Fix:** Update all three docs to 97/3 and 80/20 and correct the constant names. **P1 — cheap and high-value.**

---

**[HIGH] [BUSINESS LOGIC · MISSING REQUIREMENT] X25 — A stated payout invariant is unenforceable**

*(HARDEN-014 — re-verified, still open.)*

- **Location:** `AGENTS.md:189`, `src/modules/bookings/booking.repository.js:159`, `src/modules/safety/` (empty)
- **Evidence:** `AGENTS.md` states "a booking with an open dispute or open safety report must never appear as payable." `PAYOUT_ELIGIBILITY` correctly excludes `isFrozen: {$ne: true}` and `booking.model.js:42` defines the field — but **no code anywhere writes `isFrozen: true`**, because `src/modules/safety/` contains only `.gitkeep`.
- **Failure scenario:** The dispute half of the invariant works via `status`. The safety-report half does not exist: an open safety report cannot block a disbursement. `PHASE_11`'s Definition-of-Done item requiring this is unmet.
- **Fix:** A product decision is owed (build the safety module or remove the claim and the dead field). Until then the documentation overstates the control. **P1 for the decision; implementation timeline TBD.**

---

**[HIGH] [BUG] X26 — Every booking response returns a nameless counterparty, and fixing it naively leaks PII**

- **Location:** `src/modules/bookings/booking.repository.js` — 14 populate sites (lines 7-8, 14-15, 35-36, 58-59, 94-95, 118-119, 135-136)
- **Evidence:** All select `'nameEn nameAr profileImage'`. `User` has only `name` (`user.model.js:10`); `nameEn`/`nameAr` exist solely in `locations.constant.js` for governorate names — this was copy-pasted from the wrong shape.
- **Failure scenario:** Every booking list, detail, check-in, confirm-completion, cancel and dispute response returns a counterparty with `name: undefined`. `offer.repository.js:8-9` and `request.repository.js:7-8` correctly use `'name profileImage'`; only bookings is wrong. `findDisputedBookings` (`:80-81`) also uses `name`, so the admin view works while every user-facing endpoint does not.
- **The trap:** `booking.dto.js:10` maps the **stylist** through `toPublicUser`, which returns `email`, `phone`, `role` and `accountStatus` (`auth.dto.js:2-11`). Today the broken populate accidentally suppresses that. Widening the select without changing the DTO would expose stylist email and phone to every client on every booking read — **directly defeating the contact-exchange moderation the platform is built around.**
- **Fix:** Set the select to `'name profileImage'` **and** switch `booking.dto.js:10` to a client-safe projection, in the same change. **P2 — but never fix one half alone.**

---

**[HIGH] [RELIABILITY · SECURITY] X27 — All rate limiters are in-memory and IP-keyed, and the global one fronts the webhooks**

- **Location:** `src/common/middlewares/rate-limiter.middleware.js`, `auth-rate-limiter.middleware.js`, `src/app.js:73`
- **Evidence:** None of the four limiters passes a `store:` option, so all use `express-rate-limit`'s default in-memory store. No `keyGenerator` override exists anywhere, so all are IP-only. `ioredis` is already a dependency and `src/config/redis.config.js` already exports a client.
- **Failure scenarios:** (a) Counters reset on every deploy and are per-process — combined with X3, a distributed attacker faces no effective OTP limit. (b) `app.js:73` mounts the global 100-per-15-minutes limiter in front of **all** of `/api/v1`, including `/health` and both payment webhooks: a load balancer polling health from one source IP exhausts the budget, and a Paymob retry burst can be 429'd, leaving orders stuck `pending` after money was taken. (c) Carrier-NAT pools of mobile users share one budget.
- **Fix:** Wire the existing Redis client as the store; add per-account keying on auth routes; exempt `/health` and mount the webhook limiter ahead of the global one. **P1 for the webhook exemption, P2 for the rest.**
---

### MEDIUM

| # | Category | Finding | Location | Failure mode | Fix |
|---|---|---|---|---|---|
| M1 | SECURITY · TECH DEBT | **Audit log is fire-and-forget, never transactional, not tamper-evident.** `recordAction` wraps the write in a try/catch that only logs; `eventBus` is a bare `EventEmitter`, so `emit()` returns before the async listener writes; and the emit is always *outside* the transaction it records. `AuditLog` is an ordinary model — no hash chain, no `capped`, no WORM, no TTL. | `audit-log.service.js:28-31`; `subscription.service.js:704` (commit) vs `:708` (emit); `user.service.js:212` vs `:219`; `audit-log.model.js:6-19` | A DB blip, a crash or a SIGTERM between the action and the write loses the entry with no signal. Anyone with DB credentials can rewrite history undetectably. The trail can be strictly *less* complete than reality in exactly the money and moderation cases where it matters. | Write audit entries in the recording transaction for money/admin actions; add a prev-hash chain or WORM export |
| M2 | MONEY | **Ledger dual-writes are non-atomic and swallowed to `console.error` — in two modules.** Both post DEBIT and CREDIT as independent `postEntry` calls with no session, in a try/catch logging to `console.error` (not Winston, so it never reaches aggregation). | `subscription.service.js:381-403`; `payment.service.js:256-285` | DEBIT commits, CREDIT throws → the book is permanently unbalanced while the subscription is granted / payment marked `paid`. The correct primitive (`postDoubleEntry`, `ledger.service.js:99`) exists and is used correctly for coupons in the same file (`payment.service.js:162-173`). | Use `postDoubleEntry` inside a session; log via Winston and alert |
| M3 | MONEY | **Subscription ledger entries are structurally unreconcilable.** They are posted with **no `bookingId`**; the reconciliation cron walks `LedgerEntry.distinct('bookingId', {bookingId: {$ne: null}})` and its orphan pass starts from `Payment`, never `SubscriptionOrder`. | `subscription.service.js:381-400`; `ledger-reconciliation.cron.js:28-56` | A half-written subscription pair — exactly what M2 produces — is invisible to the job built to catch it. | Add a `SubscriptionOrder`-rooted pass, or a correlation field the job walks |
| M4 | CONCURRENCY | **Subscription webhook is check-then-act, not CAS.** `:566-568` reads `order.status === 'paid'`; `:582` writes. | `subscription.service.js:566-587` | Concurrent duplicate deliveries (routine for Paymob) both pass → duplicate history rows and duplicate `SUBSCRIPTION_ACTIVATED` events. Money is protected by `orderId`-scoped ledger keys. | `findOneAndUpdate({_id, status:'pending'})`; bail on `null` |
| M5 | CONCURRENCY | **`createBatchPayouts` corrupts its result on transaction retry.** `createdPayouts` is declared outside `work()`, and `withTransaction` retries the callback on `WriteConflict`, re-pushing every payout. The eligibility read (`:91`) and profile read (`:86`) take **no session**. | `payout.service.js:82,86,91,169,179-186` | Phantom rows returned to the admin, and `PAYOUT_CREATED` emitted twice per payout — duplicate "you've been paid" notifications and audit entries. The surrounding transaction does not cover the read-write cycle, so **HARDEN-001 is worse than documented**. | Move the accumulator inside `work()`; thread the session through the reads; add the CAS on `payoutStatus` |
| M6 | BUG | **Entitlement capacity treats a legitimate `0` as `1`.** `const limit = entitlements[metric] \|\| 1;` | `entitlement.service.js:130` | A plan granting zero of a capacity metric silently grants one; a missing entitlement key silently becomes 1 instead of failing loudly. Same class as the first-use bypass the team already closed for `consume()` at `:77`. | `?? ` with an explicit throw on missing keys |
| M7 | CONCURRENCY · BUSINESS LOGIC | **Capacity limits are TOCTOU.** `capacity()` is a `countDocuments` check with no atomic guard at the create site — unlike the daily counters, which are correctly atomic. | `entitlement.service.js:128-159` | Two concurrent creates at the boundary both pass, so a user holds more active requests/offers than their plan allows. These are the **monetized** limits, so the bypass hands users paid-tier capacity for free. | Enforce via a unique/partial index or an atomic counter |
| M8 | BUG · ABUSE | **`refundQuota` has no floor.** `$inc: {used: -count}` with no `used: {$gte: count}` guard (the schema's `min: 0` is not enforced by `updateOne`). | `entitlement.service.js:186-195` | Any double-fire drives `used` negative, after which `consume()`'s `used: {$lte: limit - count}` predicate passes indefinitely — daily caps become unlimited for the rest of the Cairo business day. | Add the `$gte` guard to the filter |
| M9 | CONCURRENCY | **Auto-pause cron does read-modify-write outside the repository.** Imports the model directly, filters on `'pending'` (a stale lowercase status not in `REQUEST_STATUS`), and `doc.save()`s with no precondition. The correct `requestRepository.findAutoPausableRequests` exists and is **never called**. | `request-autopause.cron.js:17-40`; `request.repository.js:102-108` | A request cancelled between the `find` and the `save` is silently reverted to `PAUSED` — and `PAUSED` is reactivatable, so a cancelled request comes back to life and can receive offers again. Also: `pauseCount` is incremented only here, while two other paths set `PAUSED` without it, so the "max 3 reactivations" rule is enforced against one of three pause paths. | Call the repository; write via CAS on `{_id, status:'OPEN'}` |
| M10 | PERFORMANCE | **`expireOldRequests()` is a collection-wide `updateMany` run on every list read.** | `request.service.js:270,279`; `request.repository.js:84-90` | Makes a read endpoint a write endpoint; two users paginating concurrently both run it. Idempotent, but it will not scale. Related: the same function pauses **any** expired `OPEN` request regardless of `offerCount`, which makes a later accept return a misleading `409 "already accepted via another offer"` when the request merely paused. | Move to the existing sweep; stop running it on reads |
| M11 | RELIABILITY · BUG | **All seven crons run in the host timezone despite "Cairo time" comments.** No `cron.schedule` call passes a `timezone` option — zero hits across `src/jobs`. | `otp-cleanup.cron.js:6`; `subscription-renewal.cron.js:9`; `ledger-reconciliation.cron.js:8` | On a UTC VPS the 02:00/03:00/04:00 sweeps run at 04:00/05:00/06:00 Cairo — misaligned with the `Africa/Cairo` business-day boundaries the rest of the system computes against (`businessDay.util.js`). | Pass `{ timezone: BUSINESS_TIMEZONE }` |
| M12 | BUG | **Dispute evidence is written as objects into a `[String]` schema path.** | `booking.model.js:82,90`; `booking.service.js:340,389-398`; `booking.validator.js:24-31` | `$push` of an object with `runValidators: true` raises a `CastError` → **400 on a legitimate evidence submission**. `tests/integration/dispute-evidence.test.js` mocks `booking.repository` entirely, so the schema is never exercised. `noShowSchema` (`booking.validator.js:63-69`) gets this right — evidence there is `z.array(z.string().url())`. | Change the schema to a proper subdocument; un-mock the repository in that test |
| M13 | SECURITY · PRIVACY | **Broadcast feed leaks precise meeting addresses.** `toPublicRequestDto` returns `meetingLocation` in full — street address plus exact GeoJSON coordinates — with date and time. | `request-feed.service.js:126`; `request.dto.js:19` | Every verified stylist in the governorate learns where a specific client will physically be, at a specific time, **before any offer is accepted**. `REVISION_MODERATION_CLASSIFIER_GATE.md` §4 names this exact data class as the platform's most sensitive. The `$geoNear` distance is computed server-side and does not require returning coordinates. | Project to area/governorate level in the feed; reveal the precise address only after acceptance |
| M14 | BUG | **The feed's "hide requests I already bid on" never fires.** `auth.middleware.js:60` sets `req.user = {id, role}` with no `_id`, so `stylistUser._id \|\| stylistUser.id` yields a **string**, compared against an ObjectId inside `$expr`. | `request-feed.service.js:76,88` | Always false: stylists keep seeing requests they have already bid on, and the `$lookup` runs for nothing on every feed page. | `new mongoose.Types.ObjectId(stylistId)` |
| M15 | SECURITY | **No per-folder authorization on uploads** (HARDEN-004, open). `router.post('/:folder', authMiddleware, uploadSingle, ...)` — no `restrictTo`; `upload.service.js:33` receives `user` and never reads it. | `upload.routes.js:8`; `upload.service.js:33` | Any authenticated principal of any role can write to `kyc-documents` or `stylist-portfolio`. Folder allowlisting (`:34`) prevents traversal but not cross-role writes. **Hard prerequisite for `PHASE_15F`** per the backlog amendment, since 15F adds a `shape-models` folder of full-body client photographs. | Map folder → allowed roles; enforce before upload |
| M16 | BUG | **KYC signed-URL retrieval is dead code.** `getSignedKycUrl` is exported and **never called**; `user.service.js:87-91` stores the raw `documentRef` into `verification.documents[].url`. | `upload.service.js:80-86`; `user.dto.js:20` | KYC documents are correctly stored `authenticated` and are therefore **unviewable through the API** — the verification-approval flow has no working document-viewing path. The field is also named `url` while holding a public_id, inviting clients to try fetching it. | Wire the signed-URL path into the admin verification view |
| M17 | SECURITY | **Sharp failure falls back to uploading the raw bytes.** MIME is client-declared with no magic-byte sniffing, and `resource_type: 'auto'` lets Cloudinary classify the result as `raw`. | `upload.service.js:44-51`; `multer.middleware.js:13-14` | Declare `image/png`, send arbitrary bytes: Sharp throws, the **original** buffer is uploaded and served from `res.cloudinary.com` — precisely the host both SSRF allowlists trust. PDFs are allowlisted and skipped by compression entirely, stored byte-for-byte. | Fail closed on a decode error; sniff magic bytes; pin `resource_type` |
| M18 | SECURITY | **Auth fails open when Mongo is unreachable.** `auth.middleware.js:33-35` skips revocation and account-status checks when `getCurrentSessionState` returns `undefined`. | `auth.middleware.js:33-35`; `tokenVersionCache.js:50-52` | The stated justification ("every downstream handler will fail anyway") does not hold for handlers that never touch Mongo: `POST /uploads/:folder` (Cloudinary only) and `POST /chat/token` (Firebase only). A suspended user can still upload and still mint a Firebase chat token during a Mongo outage. | Fail closed on those routes, or treat `undefined` as deny |
| M19 | SECURITY | **`/auth/resend-otp` and `/auth/register` are user-enumeration oracles.** `resend-otp` returns three distinguishable responses (404 = no account, 400 = exists+verified, 200 = exists+unverified); duplicate registration surfaces as `409 "Duplicate value for email"`. | `auth.service.js:159,162`; `error-handler.middleware.js:14-17` | Directly contradicts `PHASE_13_SECURITY_LOGGING_DOCS.md:24` ("verify no route leaks 'user not found'"). The correct pattern is six functions away in `forgotPassword`, which returns silently for unknown emails. | Return a uniform response from `resend-otp`; suppress the 11000 detail |
| M20 | SECURITY | **Mongoose error messages leak in production, and untrusted `statusCode` is reflected.** The `ValidationError` / `CastError` / `11000` branches run *before* the production message-scrubber. | `error-handler.middleware.js:5-20` | Schema paths, submitted values and indexed field names are returned to clients in production. Separately, `statusCode` is destructured from *any* error object, so a third-party library error (Cloudinary, fetch wrappers) can set the HTTP status. | Scrub after classification; allowlist `statusCode` to `ApiError` |
| M21 | SECURITY | **No HTML escaping in any mail template.** `` `<p>Hello ${name},</p>` `` with `name` user-controlled at registration (2-char minimum); zero escape helpers across `src/modules/mail/`. | `otp.template.js:2` | HTML/CSS injection into transactional email sent from Murafiq's own From address — a phishing-content-injection primitive with the platform's sender reputation behind it. | Escape all interpolated user values |
| M22 | RELIABILITY | **BullMQ enqueue failure leaves a permanently-pending wardrobe item.** The item is created in Mongo, then the enqueue failure is logged and execution continues. | `wardrobe.service.js:32-40` | Redis down for 30 seconds ⇒ items returned to the user with `classificationStatus: 'pending'` **forever**; there is no reconciliation sweep for stuck-pending items, and the API returned success. | Add a stuck-pending sweep, or fail the request |
| M23 | BUG · AI | **Model JSON is regex-extracted with no schema validation, into un-enumed fields.** `responseText.replace(/^[\s\S]*?({[\s\S]*})[\s\S]*$/, '$1')` then `JSON.parse`, straight into `updateWardrobeItemById`. `pattern`, `formality`, `material`, `primaryColor` are plain `String` with **no enum**. | `gemini.config.js:106-107`; `wardrobe-item.model.js:38-53` | Any model-emitted string persists. `HARDENING_08` #3 warns of exactly this ("a model that writes `Formal` instead of `formal` silently removes that item from every filtered query") — still open. `PHASE_15_AI_SKELETON.md:143-149` makes "the model returns item IDs, validated against the candidate set" a load-bearing Phase 15 invariant; the current classifier is the counter-example. | Validate the parsed object against a Zod schema; enum-constrain the fields |
| M24 | DESIGN RISK · AI | **Silent mock-mode fallback keyed on a string comparison.** Returns fabricated classification data when the API key equals the dev placeholder. | `gemini.config.js:55`; `vector.config.js:25` | In production `secret()` requires the var to be *present*, not *different from the placeholder* — so a copy-pasted `.env` yields a production system silently fabricating classification data for every garment, with **no warning log**. | Key mock mode on `NODE_ENV` alone; log loudly when active |
| M25 | DESIGN RISK | **The `readyState === 1` transaction guard is the wrong check, and it is duplicated four times.** | `subscription.service.js:693`; `payment.service.js:~168`; `payout.service.js:166`; `offer.service.js:178` | It tests *connectedness*, not replica-set support. On a standalone mongod the guard passes and `withTransaction` throws; the non-atomic `else` branch only runs when the DB is down, where nothing works anyway. The fallback reads as a safety net and is effectively dead code. | One shared `withOptionalTransaction` helper in `src/common/` |
| M26 | CONCURRENCY | **Coupon burn race in `initializePayment`.** `if (couponCode && !payment.couponCode)` reads a document fetched outside any transaction, and the write uses the predicate-less `updateById`. | `payment.service.js:70,89`; `payment.repository.js:32-38` | Two concurrent calls with **different** codes both see `couponCode` null, both redeem successfully (the CAS is per-coupon, so neither collides), and both write the same Payment — last write wins, and one coupon is permanently `REDEEMED` with no discount applied. The comment at `:87-88` is true but reassures about a different property than the one that breaks. | CAS on `{_id, couponCode: null}` |
| M27 | DEPLOYMENT | **Nothing gates the new one-active-subscription index at deploy time.** Correctness now *depends* on `uniq_active_subscription_per_user` — `findOrCreateActiveSubscription` swallows E11000 as its race resolution. `autoIndex` is not disabled. | `subscription.model.js:113-122`; `subscription.repository.js:49`; `src/config/database.config.js` | On an existing database holding duplicate active rows, the background index build fails while the app boots happily, believing an invariant the DB is not enforcing. The correct pre-flight `scripts/check-duplicate-active-subscriptions.js` exists and is wired into **no** npm script or startup check. | Add it to `package.json` and to a deploy gate |
| M28 | BUSINESS LOGIC · DOC CONFLICT | **No proration and no plan versioning.** `applyPlanGrant` resets `currentPeriodStart`/`End` outright. `Plan` has no `version`, `Subscription` no `planVersion`; entitlements resolve live. | `subscription.service.js:147-148`; `entitlement.service.js:27-37` | A user one month into a yearly plan who upgrades **loses ~11 months** of paid time. Editing a Plan's `entitlements` changes what every current subscriber gets, mid-period, instantly. `REVISION…md` §E.5 mandates proration and `:405,415` mandate version pinning; `MURAFIQ_PRODUCT_AND_BUSINESS_GUIDE.md:304` documents the opposite — **the two specs contradict each other**, and the code follows the guide. | Resolve the spec conflict first; then implement whichever is chosen |
| M29 | BUG | **The downgrade comparison ignores the billing cycle, and its comment is wrong.** `plan.priceEgp < currentPlan.priceEgp` compares monthly price only. | `subscription.service.js:308-312` | The comment claims it "correctly treats a yearly→monthly move on the same tier as a downgrade too." It does not: same tier means the same `Plan` document, so the comparison is false and the call falls through to the 402 guard at `:337`. | Compare the resolved cycle price, not `priceEgp` |

---

### LOW / INFO

| # | Category | Finding | Location |
|---|---|---|---|
| L1 | DOCUMENTATION DRIFT | **`STATUS.md` contradicts itself.** §10 "Explicitly Out of Scope" lists "Coupons · … · Subscription plans" as "not present anywhere, and intentionally so" — while lines 83-140 of the *same file* document the subscription admin-grant endpoints in detail, and both modules are fully built and tested. `AGENTS.md:89-90` carries the corrected list. The file `AGENTS.md:11-12` calls "the live source of truth" is internally inconsistent. | `docs/STATUS.md` §10 vs §83-140 |
| L2 | DOCUMENTATION DRIFT · MISSING REQUIREMENT | **Socket.io is documented in 8 files and does not exist.** Not a dependency in `package.json`; absent from `src/` (one incidental string in `config/database.config.js`); `server.js` creates a bare `http.createServer(app)` with nothing attached. Phase 7's realtime notification delivery is unimplemented. | `AGENTS.md:71-72`; `PHASES_INDEX.md:16,73`; `PHASE_00`, `PHASE_07`, `PHASE_11`, `03_SKELETON_STATUS` |
| L3 | TECH DEBT | **`src/modules/reliability/` is dead code.** `ReliabilityEvent` defines a proper append-only score-delta ledger with indexes and five event types; repo-wide grep finds **zero writers and zero readers**. A reliability score can move and nobody can explain why. Same decision shape as `SAFETY_MODULE_DECISION.md` — build it or delete it. | `reliability-event.model.js` |
| L4 | BUSINESS LOGIC | **Reliability scoring has three real gaps.** (a) No-shows are invisible: `findCompletedAndCancelledByStylistId` filters to `completed\|cancelled`, so `no-show-stylist` never counts — a stylist who no-shows ten times returns to the same score once the penalties settle. (b) Punctuality (20% of the composite) reads `booking.checkInAt`, a **single shared field** either party can write, and re-check-in is allowed so it is last-writer-wins. (c) `completedSessions`/`cancelledSessions` are `$inc`'d by listeners *and* absolutely-set by the recompute on the same event, with non-deterministic ordering. | `booking.repository.js:210-212`; `reliability.service.js:58-65`; `review.listener.js:39-41` |
| L5 | BUSINESS LOGIC | **The no-show anti-fraud gate does not hold.** "The reporter must themselves have turned up" is enforced via `booking.checkInAt` — one field shared by both parties, so **the accused party's check-in satisfies the accuser's gate**. The per-party pattern was available (`clientConfirmedAt`/`stylistConfirmedAt` prove it). | `no-show.service.js:76-83`; `booking.model.js:45` |
| L6 | TECH DEBT | **Dead duplicate refund constants.** `FULL_REFUND_HOURS: 24` and `PARTIAL_REFUND_PERCENTAGE: 80` are a second source of truth that no code reads. Editing them changes nothing. | `statuses.constant.js:87-88` |
| L7 | MISSING REQUIREMENT | **Losing stylists are never notified.** `findSiblingPendingOffers` is called, used only as a truthiness check, and discarded; `OPEN_BROADCAST_REQUESTS_DESIGN.md:299-302` explicitly requires an `OFFER_REJECTED` emit per closed offer. The query is pure waste — `updateMany` already returns `modifiedCount`. | `booking.service.js:142-149` |
| L8 | MISSING REQUIREMENT | **The late-stylist-cancellation compensation coupon is never issued.** `couponEligible: true` is computed and returned in the cancellation quote, but `booking.service.js` has no `couponService` import and no `issueCoupon` call — only `no-show.service.js` issues coupons. Both `REVISION…md:635` and the product guide state it works. | `booking.service.js:617` |
| L9 | BUG | **`review.tags` is accepted and silently discarded** — the validator accepts it, the service forwards it, and the model has no `tags` path. The API returns 201 on data it throws away. | `review.validator.js:18`; `review.model.js:5-48` |
| L10 | TECH DEBT | **`booking.controller.resolveDispute` has inverted arguments** (`(id, userId, body)` against a `(adminUserId, bookingId, ...)` signature). Dead today — not routed; the live path is `admin.controller.js` and is correct — but a live trap the day someone wires it up. | `booking.controller.js:100` vs `booking.service.js:429` |
| L11 | BUG | **`ScheduleBlock`'s unique index is weaker than advertised, and its day window is UTC.** `date` is stored as a full timestamp, so two bookings on the same calendar day with different time components produce different index keys. Separately `schedule.repository.js:4-6` computes the window with `setUTCHours` while everything else uses `Africa/Cairo` — so `findOverlap` misses genuine overlaps across the 00:00–03:00 Cairo boundary. | `schedule.model.js:16`; `schedule.repository.js:4-6` |
| L12 | PERFORMANCE | **Missing indexes on hot sweep paths.** No index serving `findPendingNoShowReports` (full scan every 15 min); none on `{status, expiresAt}` for the offer-expiry sweep (full scan every 5 min); none on `AuditLog.createdAt` alone, so the default admin listing is a COLLSCAN plus in-memory sort that will hit the 32 MB sort limit; none on `User.verification.status` / `role` / `accountStatus` despite all three being filtered and counted. | `booking.model.js:103-108`; `offer.model.js:36-39`; `audit-log.model.js:23-24`; `user.model.js:116` |
| L13 | BUG | **The moderation scanner's substring fallback defeats its own word-boundary regex.** `wordRegex.test(t) \|\| t.includes(normWord)` — a blocked word `"ass"` matches `"Hassan"`; `blockedDomains` is pure `includes`, so a domain `"me"` blocks every message containing "me". (The normalisation work around it — Arabic-Indic numeral folding, zero-width stripping, tashkeel removal, separator-tolerant phone regex — is genuinely good.) | `moderation.scanner.js:109,132` |
| L14 | TECH DEBT | **No observability.** No correlation ID (`PHASE_13:33` asks for `req.id`; grep returns zero hits), no alerting sink, no log redaction, and no `jest.config.js` — therefore no coverage threshold, despite `PHASE_13:47` requiring 70%+. The one control that detects money moving without a ledger record writes to a log file nobody watches. | `ledger-reconciliation.cron.js:80-82`; `logger.config.js:21-28` |
| L15 | TECH DEBT | **Swallowed failures with no repair path**, at minimum: `booking.service.js:157,346-349,500-504,510-512`; `no-show.service.js:224-230,291-293,301-303,306-310`; `review.service.js:184-186`; `request.service.js:256-258` (bare `console.error`). None has a retry, a dead-letter record, or an alert. The `refundError`/`refundFailedAt` fields written on failure are **never read anywhere in the codebase**. | various |
| L16 | INFO | `blocked-word.model.js:1` begins with a UTF-8 BOM. | `blocked-word.model.js:1` |
---

## 5. Business Logic Audit

| Rule | Status | Note |
|---|---|---|
| One request produces at most one booking | ✅ Correct | Three independent layers: atomic `lockAndAccept` CAS on the Request, unique indexes on `Booking.offerId` and `Booking.requestId`, and the ScheduleBlock unique index. Tested. |
| Offer acceptance is one transaction | ✅ Correct | Plus a retry loop with proper transient-error classification (`offer.service.js:139-145,196-210`) |
| Double-booking overlap guard fails closed | ⚠️ Partially correct | Overlap check is correct, but `ScheduleBlock`'s day window is UTC while everything else is Cairo (L11), so cross-midnight overlaps can be missed |
| Session completion requires **both** confirmations | ✅ Correct | Two-stage CAS; `SESSION_COMPLETED` fires exactly once |
| Booking state transitions are legal | ❌ Incorrect | No central transition table; nine writers with divergent guards. X4 (any→`confirmed`), X9 (terminal overwrite), X10 (`in-progress` cancellable) |
| No-show is filed, contested, then admin-confirmed | ⚠️ Partially correct | Flow exists; the reporter-presence gate is satisfiable by the accused (L5), and dismissal has no guard (X4) |
| Stylist no-show → client made whole | ❌ **Incorrect** | X1 — the refund always fails and is swallowed |
| Client no-show → stylist partially compensated | ✅ Correct | `payoutStatus: 'unpaid'` is set, so the refund proceeds and the payout path works |
| Cancellation is four distinct branches | ✅ Correct in code | 97/3 early, 80/20 late, stylist-any-time, no-show-via-dispute. **Three docs state different numbers** (X24) |
| Platform fee + stylist payout === amount | ✅ Correct | Clamped so the platform can never "owe" more than it kept; verified in the coupon path too |
| Escrow holds once `Payment.status === 'paid'` | ✅ Correct | Chat unlock and check-in both gate on the same flag |
| Escrow fully drains on every terminal outcome | ❌ Incorrect | X20 — cancelled bookings never release the retained platform fee |
| Payout is manual, never automatic | ✅ Correct | Admin-triggered; amounts read strictly from `Payment`, never recomputed |
| Disputed/frozen bookings are never payable | ⚠️ Partially correct | Dispute half works; **safety half cannot work** — `isFrozen` has no writer (X25) |
| Dispute filing window is 48h from completion | ⚠️ Partially correct | Enforced, but re-openable without limit (X7); `in-progress` bookings have no window at all |
| Dispute resolves to exactly one of two outcomes | ✅ Correct | `completed` or `cancelled`, no third state |
| Reviews require a completed booking | ✅ Correct | Plus a 14-day window and role-derived direction — not spoofable |
| One review per booking per direction | ✅ Correct | Enforced by unique index, not just service logic |
| Rating aggregates recomputed from source | ✅ Correct | `$avg` aggregation, not incremental — no float drift |
| Reliability reflects stylist behaviour | ⚠️ Partially correct | Idempotent recomputation, but no-shows are invisible and punctuality reads a shared field (L4) |
| Daily caps (2 requests / 5 offers) are atomic | ✅ Correct | `{used: {$lte: limit - count}}` + unique index; the first-call bypass is explicitly closed |
| Active capacity limits are enforced | ⚠️ Partially correct | TOCTOU (M7); a `0` limit becomes `1` (M6); refunds can go negative (M8) |
| One active subscription per user | ✅ Correct | Now a partial unique index + CAS. **But nothing gates the index at deploy** (M27) |
| Paid plans require real payment | ✅ Correct | The 402 guard is correctly placed after the downgrade branch; only the HMAC-verified webhook sets `paid: true` |
| Admin grants create no ledger entry | ✅ Correct | Deliberate and correctly implemented; provenance on `source`/`grantedBy` |
| Entitlements expire with the period | ❌ Incorrect | X16 — no expiry check; cron-only enforcement |
| Every plan transition is recorded | ❌ Incorrect | X15 — three of six change types never written |
| Coupons are single-use and server-priced | ✅ Correct | Per-coupon CAS; discount recomputed server-side, never trusted from input |
| Coupon + booking is one transaction | ✅ Correct | Redemption, Payment update and ledger pair all share a session |
| One coupon per booking | ⚠️ Partially correct | M26 — two different codes can race |
| Penalties are idempotent | ✅ Correct | Unique `{bookingId, reasonType}`; settlement clamped to `[0, assessed]` |
| Penalty waiver | ❓ Not implementable | Schema supports `WAIVED` with `waivedBy`/`waivedReason`; **no endpoint exists** — only a direct DB write can remove a wrong penalty |
| Moderation blocks contact exchange | ❌ **Incorrect** | X2 — the gate cannot enforce; X11 — human review has no enforcement arm; X12 — one-field bypass |
| KYC gates the marketplace loop | ✅ Correct | Enforced at 4 points (request create, targeted stylist, offer create, search visibility) |
| Audit trail is complete and truthful | ❌ Incorrect | M1 — lossy, non-transactional, `ip` always null, operator actions logged as admin |

---

## 6. Architecture Audit

**Module boundaries — good.** The `Route → Validator → Controller → Service → Repository → Model` layering is real and consistently applied across all 23 modules. The two documented cross-module exceptions (`auth.repository` importing `user.model`; `entitlement.service` importing `request`/`offer`/`wardrobe` models for read-only counts) are genuinely justified — routing those counts through services would be circular, and the alternative (lazy imports or an injected registry) would be more fragile. The payouts module was correctly refactored off foreign models during an earlier pass.

Two violations remain: `request-autopause.cron.js:17` imports `Request` directly and reimplements a query the repository already provides (M9), and `no-show.service.js` reaches across into payments, coupons, reliability, schedule and chat in a single untransacted function.

**Dependency direction — sound, with one cycle risk.** Events flow outward (`eventBus.emit` → listeners), writes flow inward. `event-graph.test.js` statically asserts every listened event has an emitter, which is a genuinely good guard against the drift class that was found in an earlier audit.

**Repository/service pattern — consistent.** Repositories own queries, services own rules. The exception worth flagging: repositories expose predicate-less `updateById` helpers (`payment`, `offer`, `booking`, `subscription`), and services then do read-then-write against them. **That is the single structural cause of most of the concurrency findings in this report** — X4, X9, X18, M4, M9, M26 are all the same shape.

> **This is the one architectural change worth making.** A shared repository primitive — `transition(id, fromStates[], patch, session)` returning `null` on a lost CAS — plus a central `BOOKING_TRANSITIONS` map would eliminate X4, X9 and X10 at once and remove the nine divergent guard implementations. It is a small, contained change, not a rewrite.

**Database design — good, with gaps.** Indexes are generally thoughtful and several carry written rationale. Unique and partial-unique indexes are used correctly as real invariants (coupon idempotency, review direction, penalty assessment, one-active-subscription, booking↔offer↔request). Immutability is enforced with `pre` hooks on `LedgerEntry` and `SubscriptionHistory`. Gaps: missing indexes on three hot sweep paths (L12), and `autoIndex` left enabled in production with no deploy gate (M27).

**Money representation — a deliberate, documented split that mostly holds.** Decimal EGP with `round2()` in operational models; integer piastres strictly in `LedgerEntry`. The conversion boundary is correctly isolated. The residual risk is that float sums are converted once at the end (`egpToPiastres(Σ)`) while the ledger credits are converted per item (`Σ egpToPiastres(each)`), so `Payout.amount` can disagree with its own ledger entries by a piastre. Worth a reconciliation tolerance rather than a redesign. Note `MONEY_AND_LEDGER.md:10` documents `round2` as `Math.round(n*100)/100` while the code adds `Number.EPSILON`.

**Transactions — used in the right places, but inconsistently.** Coupon application, booking cancellation, payout batch creation and the admin subscription grant are all correctly transactional. The webhook→paid→ledger path, `processRefund`, `resolveNoShow` and the subscription webhook grant are not — and those are the four highest-value money paths in the system. The `readyState === 1` guard is the wrong predicate and is copy-pasted four times (M25).

**Queues and Redis — correct where used, under-used elsewhere.** BullMQ config is right (retries, exponential backoff, bounded retention, `maxRetriesPerRequest: null`, clean shutdown). Redis is connected but used for **only** the wardrobe queue: it is not used for rate limiting (X27), not for cron leader election (M11/HARDEN-013), and not for the token-revocation cache (X22) — all three of which currently depend on `instances: 1`. That single PM2 setting is now load-bearing for four separate correctness properties, and the config comment names only one of them.

**External services — properly abstracted for payments and mail** (real provider interfaces, env-switched, mock hard-blocked in production). **Not abstracted for AI:** `gemini.config.js` and `vector.config.js` are concrete modules imported directly by the worker, unlike their payment/mail counterparts. Given Phase 15's "one model for every AI task" decision this is defensible for now, but it is an inconsistency worth a written decision rather than a silent one.

**Error handling — one central handler, correctly last, with async fully covered** via a globalised `asyncHandler`. The classification branches run before the production scrubber (M20), and there is no `MulterError` branch, so an oversized upload returns 500 rather than 413.

**Scalability — bounded by design today.** Horizontal scaling is currently impossible without breaking crons, rate limits and session revocation. That is a *documented* ceiling for crons; it is undocumented for the other two.

**Maintainability — high.** The inline rationale comments are the codebase's strongest asset: most non-obvious decisions record what was tried and why it was rejected. The main drag is duplication of the ownership check (~20 verbatim copies, disagreeing about admin bypass) and of the transaction guard.

---

## 7. Security Audit

| Severity | Finding |
|---|---|
| **CRITICAL** | OTP lockout inoperative — `otpAttempts` missing from the projection (X3) |
| **CRITICAL** | Moderation enforcement unreachable — `MODERATION_MODE` not in the env schema (X2) |
| **CRITICAL** | `NODE_ENV` defaults to development; placeholder JWT secrets on disk (X6) |
| **CRITICAL** | Admin can reset any booking to `confirmed` with no guard (X4) |
| **HIGH** | `QueryBuilder.select()`/`.sort()` bypass `select: false` (X23) |
| **HIGH** | Session revocation lags 30s — `invalidate()` never called (X22) |
| **HIGH** | Chat moderation bypassed via `type: 'image'` (X12) |
| **HIGH** | Chat report endpoint has no participant check (X13) |
| **HIGH** | No per-folder upload authorization (M15 / HARDEN-004) |
| **HIGH** | Rate limiters in-memory and IP-only, fronting the webhooks (X27) |
| **MEDIUM** | Auth fails open during a Mongo outage on Cloudinary/Firebase-only routes (M18) |
| **MEDIUM** | User enumeration via `resend-otp` and `register` (M19) |
| **MEDIUM** | Mongoose error detail and untrusted `statusCode` leak in production (M20) |
| **MEDIUM** | No HTML escaping in transactional email (M21) |
| **MEDIUM** | Sharp failure uploads raw bytes to a trusted-host origin (M17) |
| **MEDIUM** | Precise meeting addresses broadcast pre-acceptance (M13) |
| **MEDIUM** | Audit trail lossy, non-transactional, not tamper-evident; operator actions logged as admin (M1) |

**What is genuinely strong, and should not be disturbed:**

- **Auth core.** Distinct access/refresh secrets, required with no default in production. Per-session refresh rotation with an atomic `$elemMatch` CAS that makes a losing concurrent refresh return `null`, plus reuse detection that revokes only the affected session. A `jti` nonce preventing byte-identical rotations within one second. Refresh tokens stored SHA-256, never plaintext, with a written rationale for not using bcrypt. Full session invalidation (`sessions: []` + `tokenVersion` bump) on both password change and reset. Atomic session cap via `$slice`.
- **Webhook signature verification.** HMAC-SHA512 over Paymob's 21 canonical fields, length pre-check, then `crypto.timingSafeEqual`. The mock provider is hard-blocked in production and its own callback requires a shared secret with a timing-safe compare. There is deliberately no `verify()` stub, with a comment explaining that the previous one would have approved any transaction.
- **No IDOR found.** Ownership is checked on every endpoint in the booking subsystem. Chat authorization fails closed, and admin chat access is narrowly conditioned on a disputed/cancelled booking *and* audited.
- **No mass assignment found.** Every body validator is Zod `.strict()`, which rejects rather than strips. `role` is unreachable from `/register` and `/google`, and no role-mutation endpoint exists anywhere.
- **Multi-tenant isolation is disciplined.** Per-user Upstash namespaces applied on all three vector operations; `userId`-scoped Mongo queries; `notification.repository.js:14` places `userId` *after* the spread so a caller-supplied `?userId=` cannot override it. **No cross-user data leak exists, including in AI retrieval.**
- **SSRF is genuinely closed** (`HARDENING_08` #1): hostname allowlist plus a bounded fetch with a 10s `AbortController` and a 10 MB cap checked on both `content-length` and actual byte length.
- **DTO layer is real.** No Mongoose document reaches an HTTP response on any traced path. `toPublicStylistDto` is allowlist-shaped, so `payoutAccount` bank details stay out of the fully public `GET /stylists/:id` — a genuine near-miss avoided by the right pattern.

---

## 8. Concurrency / Data Integrity Audit

**The dominant pattern: `findById` → check → `updateById` with no predicate.** Fifteen such sites exist in the booking subsystem alone. No schema enables `optimisticConcurrency`, and no document carries a version guard. Where these sites are protected, it is incidental — WiredTiger raising a `WriteConflict` inside a transaction — and only `acceptOffer` has a retry loop to handle that; `cancelBooking` does not, so a genuine concurrent cancel surfaces as an unhandled 500.

| Scenario | Protected? | Mechanism / gap |
|---|---|---|
| Double-accept (same offer) | ✅ | Request CAS + `offerId` unique index |
| Double-accept (two offers, one request) | ✅ | Request CAS + `requestId` unique index |
| Double-complete | ✅ | Two-stage CAS — the one race-free path |
| Double-review | ✅ | Unique `{bookingId, direction}` index (raw E11000 leaks as a 409 message) |
| Coupon double-redeem (same coupon) | ✅ | Per-coupon CAS on `{_id, status:'ISSUED'}` |
| Penalty double-assess | ✅ | Unique `{bookingId, reasonType}`; settlement clamped |
| Duplicate ledger entry | ✅ | Unique `idempotencyKey`, E11000 → return existing |
| Duplicate subscription row | ✅ | Partial unique index + findOrCreate (but see M27) |
| Daily quota over-consumption | ✅ | Range predicate + unique index; first-call bypass explicitly closed |
| **Double-cancel** | ⚠️ | Transaction only; no CAS, **no retry loop** → 500 |
| **Double-dispute / double-resolve** | ❌ | Read-then-write; resolution moves money |
| **Double-file / double-respond no-show** | ❌ | Read-then-write; the second write replaces the whole `noShowDetails` subdocument, including `reportedAgainst` — which decides who pays |
| **Payment status transitions** | ❌ | X18 — no CAS on webhook or refund |
| **Cron no-show sweep vs. completion** | ❌ | X9 |
| **Cron renewal sweep vs. paid webhook** | ❌ | X8 — user loses a plan they just paid for |
| **Cron auto-pause vs. client action** | ❌ | M9 — lost update revives a cancelled request |
| **Subscription webhook redelivery** | ⚠️ | Check-then-act (M4); money safe via ledger keys, events and history duplicated |
| **Payout batch double-creation** | ❌ | HARDEN-001 — no CAS on `payoutStatus`, and the eligibility read is outside the session |
| **Payout mark-processing / mark-paid** | ❌ | Read-then-write; `MONEY_AND_LEDGER.md:94` claims these are "state-guarded in Mongoose transactions" — `markProcessing` opens no transaction at all |
| **Capacity limits** | ❌ | M7 — TOCTOU on the monetized limits |
| **Quota refund** | ❌ | M8 — no floor, can go negative |
| **Coupon-per-booking** | ❌ | M26 — two different codes race |

**Cron re-entrancy.** All seven crons use a module-level `let registered = false` — a process-local flag, not a distributed lock. Under PM2 cluster mode the offer-expiry `updateMany` and the session-reminder sweep (guarded by a non-atomic `find`→`updateOne` on `reminderSentAt`) would both duplicate. BullMQ's own Redis job locking makes the wardrobe worker safe by contrast — the difference is instructive.

**Partial-failure surface.** `resolveNoShow` is the worst case: six independent writes (schedule delete, booking update, refund, penalty, coupon, reliability), four with swallowed errors, no transaction. Any partial failure leaves a booking in a terminal no-show state with only some of its financial consequences applied — and X1 guarantees one of them always fails.

---

## 9. Documentation vs Code

**Implemented correctly and documented accurately:** the ledger design (`MONEY_AND_LEDGER.md` §1–3), the offer/booking race design (`OPEN_BROADCAST_REQUESTS_DESIGN.md` §112-114 on unique indexes), the subscription admin-grant design (`STATUS.md` §83-140 — the newest doc section and the most accurate), the scanner's deliberate scope (`REVISION_MODERATION_CLASSIFIER_GATE.md` §0), and `PHASE_15_AI_SKELETON.md:25-26`'s own admission that the AI module is empty.

**Code contradicts the docs:**

| Doc claim | Reality |
|---|---|
| Cancellation is 100% / 75% (`AGENTS.md:181`, `MONEY_AND_LEDGER.md:42`, `PHASE_06:73,161`) | Code is 97/3 and 80/20 (X24) |
| Constants `CANCELLATION_FULL_REFUND_HOURS`, `CANCELLATION_PARTIAL_REFUND_PERCENTAGE` (`AGENTS.md:114`, `PHASE_05:177`) | Do not exist |
| Socket.io delivers realtime notifications (8 files) | Not a dependency; nothing attached to the HTTP server (L2) |
| "Write plan changes through `replaceActivePlanCAS`, not `updateById`" (`AGENTS.md:69`) | The renewal sweep, cancel and scheduled-downgrade all use `updateById` (X8, X15) |
| "A booking with an open safety report must never appear as payable" (`AGENTS.md:189`) | `isFrozen` has no writer (X25) |
| Payout transitions are "state-guarded in Mongoose transactions" (`MONEY_AND_LEDGER.md:94`) | `markProcessing` opens no transaction and uses no CAS |
| Crons run at "Cairo time" (three cron files) | No `timezone` option anywhere (M11) |
| `round2` is `Math.round(n*100)/100` (`MONEY_AND_LEDGER.md:10`) | Code adds `Number.EPSILON` |
| Coupon issued for late stylist cancellation (`REVISION…md:635`, product guide) | Never issued (L8) |
| Losing stylists get `OFFER_REJECTED` (`OPEN_BROADCAST…md:299-302`) | Never emitted (L7) |
| Rejecting an offer returns the request to `pending` (`PHASE_04:121-125`) | Code explicitly does the opposite |
| Booking has 5 statuses (`PHASE_05:30`) | Seven — both no-show states are missing from the doc |
| Crons have "single-instance guards" (`STATUS.md:73`) | Process-local flags, not locks |
| "Two human sign-offs remain before the moderation cutover" | The cutover is a code change — the flag does nothing (X2) |
| `ecosystem.config.cjs:4-9` justifies `instances: 1` by one cron | Seven crons, a BullMQ worker, the revocation cache and four rate limiters depend on it |

**Docs contradicting each other:**

- **`STATUS.md` contradicts itself** — §10 declares Coupons and Subscription plans "not present anywhere, and intentionally so", while §83-140 of the same file documents the subscription endpoints in detail (L1). This is the file `AGENTS.md` designates as the live source of truth.
- **Proration:** `REVISION…md` §E.5 mandates charging the prorated difference; `MURAFIQ_PRODUCT_AND_BUSINESS_GUIDE.md:304` documents charging the full price and resetting the period. The code follows the guide (M28).
- **Renewal:** `REVISION…md` item 19 specifies `past_due` plus a 3-day grace period; the product guide says "no auto-renewal". The `past_due` enum value exists and is never set.
- **Ledger entry-type names:** `REVISION…md` §G.1 specifies `COUPON_CREDIT` / `SUBSCRIPTION_CHARGE` / `STYLIST_PENALTY`; the code uses `COUPON_DISCOUNT` / `SUBSCRIPTION_PAYMENT` / `PENALTY_ASSESSMENT`, and §G.4's stated invariant is not what the reconciliation job actually checks.

**Documentation that is better than the code:** `HARDENING_08_WARDROBE_AI_READINESS.md` marks itself "⛔ Not started" while two of its five items are in fact done — it is *pessimistic*, which is the safe direction and worth preserving as a habit. `docs/hardening/*` are uniformly honest about being unfixed.

**Ambiguous requirements needing a decision, not a fix:** the safety module (`SAFETY_MODULE_DECISION.md` — still undecided), `ReliabilityEvent` (L3 — same shape, not even documented as a question), and proration (M28).

---

## 10. Over-Engineering Review

Very little. This codebase errs toward under-abstraction, not over-abstraction — most of the duplication findings are the *opposite* problem. Three genuine items:

**1. The `readyState === 1` transaction guard and its dead fallback.**
- *Current complexity:* Four copies of a branch choosing between a transactional and a non-transactional path.
- *Why it is unnecessary:* The condition tests connectedness, not replica-set support, so the non-transactional branch only runs when the database is unreachable — a state in which the fallback cannot succeed either. It is a safety net that catches nothing while making every money path read as if atomicity is optional.
- *Simpler alternative:* One `withOptionalTransaction(fn)` helper, or simply always open a transaction and let it fail loudly (`AGENTS.md` already declares a replica set non-negotiable).
- *Worth changing?* **Yes** — it is four sites, it removes a false signal, and it is prerequisite to fixing X5 and X17 cleanly.

**2. `findSiblingPendingOffers` is fetched and discarded.**
- *Current complexity:* An extra query whose result is used only as `.length > 0`.
- *Simpler alternative:* `updateMany` already returns `modifiedCount`.
- *Worth changing?* Only as part of fixing L7 (emitting `OFFER_REJECTED`), which is what the fetched documents were presumably intended for.

**3. `subscriptionSchema.index({userId, currentPeriodStart}, {unique: true})`.**
- *Current complexity:* A second unique index that the new partial index supersedes for its actual purpose.
- *Why it is questionable:* Its own successor's comment states it "did nothing to stop two active rows". It now only forbids two subscription rows starting in the same millisecond — not a business rule anyone stated.
- *Worth changing?* **No, not now.** Dropping an index on a live collection is a migration with no correctness benefit. Record it as intentional debt.

**Explicitly NOT over-engineered — do not simplify:** the four-branch cancellation policy (each branch is a distinct business outcome), the double-entry ledger (the whole point is reconcilability), the provider pattern for payments and mail, the two-stage completion CAS, and the dense rationale comments. Several of those comments are the only reason this audit could distinguish a deliberate decision from an accident.

---

## 11. Refactoring Recommendations

### Must refactor — real correctness risk

1. **Centralise booking state transitions.** One `BOOKING_TRANSITIONS` map plus a repository primitive `transition(id, fromStates[], patch, session)` returning `null` on a lost CAS. Eliminates X4, X9, X10 and the nine divergent guard implementations in one contained change. *This is the highest-leverage change in the report.*
2. **Stop overloading `payoutStatus`.** Introduce a distinct "nothing owed" state so X1 cannot recur, then reorder `resolveNoShow` to refund before writing status.
3. **Make the four money paths transactional:** webhook→paid→ledger, `processRefund`, `resolveNoShow` (HARDEN-003), and the subscription webhook grant (X5). Use `postDoubleEntry` with a session instead of two loose `postEntry` calls (M2).
4. **Add CAS predicates to the repository `updateById` helpers used on money and lifecycle transitions** — `payment`, `payout`, `offer`, `booking`, `subscription`.
5. **Extract one `assertBookingParticipant(user, booking, {allowAdmin})` helper.** ~20 verbatim copies currently disagree about admin bypass, and four compare against the string literal `'admin'` instead of `ROLES.ADMIN`.

### Should refactor — maintainability and scalability

6. Wire the existing Redis client into rate limiting, cron leader election and the token-revocation cache — this is what unblocks horizontal scaling, and all three currently hide behind `instances: 1`.
7. One `withOptionalTransaction` helper replacing four copies of the `readyState` guard.
8. Add `fields`/`sort` allowlists to `QueryBuilder` (X23), matching the pattern `stylist-search.service.js` already uses.
9. Add a validation layer over AI model output before it reaches the schema (M23) — prerequisite for Phase 15's ID-validation invariant.
10. Decide and act on the two dead modules: `safety/` (X25) and `reliability/` (L3).

### Do NOT refactor — working code that may look imperfect

- **The offer-acceptance path.** Three overlapping guards look redundant; they are defence in depth across different failure modes, and it is the best-tested concurrency code in the repository.
- **The four-branch cancellation policy and its constants.** Correct as written — fix the *documentation* (X24), not the code.
- **The decimal-EGP / integer-piastre split.** Deliberate, documented, and the boundary is properly isolated. Migrating operational models to minor units would be a large, risky change for a 1-piastre reconciliation nuance better handled with a tolerance.
- **`entitlement.service`'s cross-module model imports.** The documented exception is genuinely the lesser evil; the alternative is a real cycle.
- **The two-stage completion CAS.** It looks like it could be one operation. It cannot — the comments explain why.
- **The dense rationale comments.** Keep writing them.

---

## 12. Phase 15 Readiness

### Can we safely continue Phase 15 from the current codebase?

**⚠️ Yes, with prerequisites — but not on today's `main`.**

Phase 15 is 0% implemented: `src/modules/ai/` contains only `.gitkeep`, there is no `/api/v1/ai` route, and the commits labelled "AI Phase 15" and "AI Specification" added **documents, not code**. So this is a question about foundations, not about existing AI code.

**The foundations that Phase 15 actually depends on are in good shape:**
- Per-user vector namespaces are correctly applied on write, update and delete — **no cross-user retrieval leak exists**, which is the failure mode that would be hardest to notice later.
- `@google/genai` and `@upstash/vector` are proven in production use by the Phase 14 worker.
- The entitlement engine already defines `ai.messages.daily` per plan, and `consume()` is genuinely atomic — so AI quota enforcement has a correct primitive waiting for it.
- `HARDENING_08` #1 (SSRF) and #2 (wardrobe quota) are genuinely closed.

**Blockers — must be fixed first:**

1. **X2 (moderation gate cannot enforce).** This is the most important one for Phase 15 specifically. 15B's scope guard is the *same shape of control* as the moderation gate: a flag-driven check that either blocks or observes. Building a second control of that shape on a codebase where the first silently never fires — and where the tests appear to cover it — repeats the mistake at higher cost.
2. **X1, X3, X4, X6.** Not AI-specific, but they are live defects in money, auth and admin. Building on top of them widens the blast radius of every subsequent change.
3. **`HARDENING_08` #3 and #5** (enum constraints, sub-category). `PHASES_INDEX.md:24` declares `HARDENING_08` a hard blocker on all of Phase 15, and #3 is the silent-data-corruption class that Phase 15 would amplify — wardrobe retrieval is a Mongo slot query, so an unconstrained `formality` value removes an item from every filtered query with no error.
4. **M15 / HARDEN-004 (upload authorization)** — a hard prerequisite for `PHASE_15F` by that phase's own amendment, since 15F adds a `shape-models` folder of full-body client photographs to a bucket any authenticated user can currently write to.

**Risks to manage during Phase 15:**

- **M23 (unvalidated model output).** `PHASE_15_AI_SKELETON.md:143-149` makes "the model returns item IDs, never descriptions, validated against the candidate set" a load-bearing invariant. That invariant does not exist in code today, and the Phase 14 classifier is a working counter-example. Build the validation layer *before* the pipeline, not after.
- **M24 (silent mock-mode fallback).** A production deploy with a copy-pasted `.env` fabricates AI output with no warning. With Phase 15 this becomes fabricated *styling advice*, not just metadata.
- **No cost accounting.** No `modelId`, `promptVersion`, token counts or confidence is persisted anywhere, so a prompt change means re-running everything at full cost with no way to target stale rows (`HARDENING_08` #4).
- **PII.** Raw client photographs already go to Google with no consent record or retention policy; 15C (image input) and 15F (body images) widen this substantially. This needs a decision before 15C, not after.

**Safe to defer:** X23/HARDEN-009 is explicitly *not* on 15F's critical path — 15F was deliberately designed to store the Shape Model in its own collection rather than as a `select: false` field on `User`. **That design choice must be preserved:** if anyone later moves the Shape Model onto `User` for convenience, HARDEN-009 immediately becomes a body-image disclosure and a hard blocker.

---

## 13. Priority Fix Plan

Ordered by real impact, not code cleanliness.

### P0 — fix immediately
| # | Fix | Why now |
|---|---|---|
| 1 | **X1** — stylist no-show refund | Loses customer money on every occurrence, silently |
| 2 | **X2** — add `MODERATION_MODE` to the env schema | One line; the whole trust-and-safety subsystem is currently inert |
| 3 | **X3** — add `+otpAttempts` to the auth projections | Account-takeover path behind a dead lockout |
| 4 | **X4** — guard `adminResolveNoShow` | One mistyped id un-finalizes a paid-out booking |
| 5 | **X5** — subscription paid-but-not-granted | Takes money without delivering, and the retry path is closed |
| 6 | **X6** — make `NODE_ENV` required; reject placeholder secrets | Forgeable admin tokens on any misconfigured deploy |

> Each of 1–4 should land **with the test that would have caught it** — specifically the stylist-branch no-show integration test, a moderation test that drives the real config, an OTP test that goes through the repository, and an admin-dismissal test against a `completed` booking.

### P1 — fix before resuming Phase 15
X7 (dispute reopen) · X8 (renewal sweep race) · X9 (terminal overwrite) · X10 (`in-progress` cancel) · X11 (moderation review no-op) · X12 (chat image bypass) · X13 (report authorization) · X16 (entitlement expiry) · X21 (admin refund zeroes stylist) · X22 (`invalidate()` never called) · X23 (QueryBuilder projection) · X24 (cancellation-percentage docs) · X25 (safety decision) · X27 (webhook rate-limit exemption) · `HARDENING_08` #3 and #5 · M15 (upload authorization)

### P2 — fix during Phase 15
X14, X15, X17, X18, X19, X20, X26 · M1–M14, M16–M22, M25–M29 · the state-machine centralisation (Refactor #1) · Redis-backed rate limiting and cron locking

### P3 — technical debt / later
All LOW/INFO items · dead-module decisions (`reliability/`, `safety/`) · doc cleanup (L1, L2) · index additions (L12) · the redundant subscription index

---

## 14. Final Verdict

### ⚠️ Continue with fixes — do not deploy, and do not start Phase 15 code, until P0 is closed.

This is a genuinely well-built system. The architecture is sound and does not need rework; the layering, the DTO discipline, the ledger design, the auth core, the offer-acceptance concurrency and the multi-tenant scoping are all done properly, and in several places better than typical. There is no evidence of the failure mode this audit was most alert to — no IDOR, no mass assignment, no cross-user data leak, no architectural dead end that Phase 15 would have to work around.

What the audit found instead is narrower and more dangerous: **a small number of controls that everyone believes are working and that are not.** The moderation gate cannot enforce. The OTP lockout never triggers. A stylist no-show never refunds the client. In all three cases the code reads correctly, the documentation describes the intended behaviour, and the test suite passes — because each failure lives in the seam *between* two correct units, and the suite's heavy use of module mocks is precisely what hides seams.

That pattern is the real finding, and it has a specific implication for how the P0 fixes should land: **each one needs the integration test that would have caught it**, exercising real collaborators rather than mocks. Fixing the five defects without changing the testing posture leaves the next three undiscovered.

The second theme is a structural one worth acting on deliberately: repositories expose predicate-less `updateById` helpers, and services do read-then-write against them. That single pattern is the root of most of the concurrency findings here. Centralising booking transitions behind a CAS primitive is the highest-leverage change available, and it is contained — not a rewrite.

On Phase 15: the prerequisites are closer than the backlog suggests (two of five `HARDENING_08` blockers are actually done, and the vector isolation that would be hardest to retrofit is already correct). The reason to fix first is not that Phase 15's design is wrong — it is sound — but that 15B's scope guard is the same shape of control as the moderation gate that currently cannot fire. Shipping a second flag-driven guard onto a codebase where the first silently fails, with green tests, would repeat the mistake at higher cost.

**Recommended sequence:** close P0 with tests (a few days of focused work) → fix the P1 set, including the cancellation-percentage documentation, which is cheap and prevents a future money bug → then start Phase 15A.
---

## Appendix A — Test Suite Assessment

102 test files (41 integration, 61 unit) running against a real `MongoMemoryReplSet`, so **transactions are genuinely exercised** rather than silently skipped. That is an important strength and it is easy to get wrong.

### Well covered

- **The offer/booking race.** `booking.broadcast-race.test.js`, `offer.lifecycle-multibid.test.js`, `offer.active-limit.test.js`, `offer.long-stop-expiry.test.js` — this is the best-tested area in the codebase, and it is the right area to have invested in.
- **Booking completion race** — `booking.completion-race.test.js`.
- **Ledger correctness** — dual-write, reconciliation, user statements, cancellation ledger.
- **Entitlements and quota** — including the first-call-of-period upsert bypass.
- **Event-graph drift** — `event-graph.test.js` statically asserts every listened event has an emitter. This is a genuinely good structural guard and should be extended, not just kept.
- **Subscription persistence, checkout, downgrade, and the new one-active invariant.**

### The central weakness: mocks hide the seams

**Every CRITICAL finding in this report lives in a seam between two units that are each individually tested and passing.** This is not a coincidence — it is a direct consequence of how the suite is structured.

| Defect | Why the suite misses it |
|---|---|
| X1 (no-show refund) | `no-show.service.test.js:42-44` mocks `processRefund` entirely, and `:106` is the **only** `reportedAgainst` in the whole suite — set to `'client'`, the working branch. `hardening-followup.test.js:199-215` tests the `payoutStatus` guard in isolation and passes. |
| X2 (moderation gate) | `moderation.service.test.js:85` and `reviews-reliability.test.js:140` reach the ENFORCE branch by **mutating the imported config object at runtime** — a path that cannot occur in production. |
| X3 (OTP lockout) | `auth.service.test.js:14` hand-builds a plain object with `otpAttempts: 4`, bypassing the projection that is the actual bug. `admin.users.test.js:114` **asserts the broken behaviour** (`expect(user.otpAttempts).toBeUndefined()`). |
| M12 (dispute evidence) | `dispute-evidence.test.js` mocks `booking.repository` wholesale, so the `[String]`-vs-object schema mismatch is never exercised. |

### Specific tests that should exist (not "more tests")

1. `resolveNoShow` with `reportedAgainst: 'stylist'`, against a **real** Payment and Booking, asserting `payment.status === 'refunded'` and `refundAmount === payment.amount`. *(Catches X1.)*
2. A moderation test that sets `process.env.MODERATION_MODE` and re-imports the config, asserting a flagged message returns 422. *(Catches X2.)*
3. An OTP test that loads the user **through `auth.repository`** and asserts the 6th consecutive wrong OTP is rejected and the code burned. *(Catches X3.)*
4. `adminResolveNoShow({upheld:false})` against a `completed` booking, asserting it is refused. *(Catches X4.)*
5. A webhook test where `subscribe()` throws after the order is marked `paid`, asserting a retry still grants the plan. *(Catches X5.)*
6. Concurrent duplicate delivery of the same payment webhook, asserting `PAYMENT_SUCCEEDED` is emitted exactly once. *(Catches X18.)*
7. The renewal sweep racing a grant: expire a subscription, start the sweep, grant a new period mid-flight, assert the paid period survives. *(Catches X8.)*
8. `cancelBooking` on an `in-progress` booking, asserting refusal. *(Catches X10.)*
9. A dispute resolved then re-filed, asserting the second filing is refused. *(Catches X7.)*
10. An admin partial refund, asserting `stylistPayoutAmount` is the policy share and not `0`. *(Catches X21.)*
11. `addDisputeEvidence` against a **real** repository, asserting the evidence round-trips. *(Catches M12.)*
12. `refundQuota` called twice for one `consume`, asserting `used` never goes below zero. *(Catches M8.)*

### Untested invariants worth naming

- No test covers **any** stylist-no-show path.
- No test covers the **cancelled-booking escrow drain** (X20) — and because debits still equal credits, the reconciliation test cannot catch it either.
- No test covers `markProcessing` / `markPaid` concurrency, despite `MONEY_AND_LEDGER.md` claiming those transitions are transaction-guarded.
- **Rate limiting is never tested** — all four limiters have `skip: () => NODE_ENV === 'test'`.
- No coverage threshold exists (there is no `jest.config.js`), despite `PHASE_13:47` requiring 70%+.

### Misleading tests

- `admin.users.test.js:114` pins a bug as expected behaviour (X3).
- `moderation.service.test.js:85` tests a branch unreachable in production (X2).
- `auth.service.test.js:14` tests a data shape the repository cannot produce (X3).

These three should be corrected as part of the P0 fixes — otherwise the fixes will make them fail and the failures will look like regressions.

### Phase 15 testability

The current design is testable: services are injectable enough, the vector and Gemini configs already have mock modes, and the replica-set harness supports the transactional paths Phase 15 would need. The one change to make first is **keying mock mode on `NODE_ENV` rather than on a placeholder-string comparison** (M24), so AI tests cannot accidentally pass against fabricated data in a production-shaped config.
---

## Appendix B — Verification Run

`npm run verify` was executed as part of this audit on 2026-09-11. Output verbatim.

### 1. `npm run lint` — eslint src tests

```
> murafiq@1.0.0 lint
> eslint src tests

```
**Clean.** No errors, no warnings.

### 2. `npm run validate:openapi`

```
OpenAPI          : 3.0.0
Documented ops   : 137
Actual routes    : 137
Security schemes : bearerAuth, cookieAuth

UNDOCUMENTED (0):
  (none)

GHOSTS — documented but absent (0):
  (none)

BROKEN $refs (0):
  (none)

STRUCTURAL PROBLEMS (0):
  (none)
```
**Clean.** Swagger coverage is genuinely complete — 137 documented operations against 137 actual routes, with no ghosts and no broken references. The Definition-of-Done requirement that every route carry a `@swagger` block is being met, and `scripts/validate-openapi.js` is a real gate rather than a formality. This is one of the better-maintained parts of the project.

### 3. `npm test` — 102 suites

```
Test Suites: 102 passed, 102 total
Tests:       635 passed, 635 total
Snapshots:   0 total
Time:        834.466 s, estimated 839 s
```
**Exit code 0. Everything passes.**

### Why this result is the most important line in the audit

**The suite is 100% green while X1, X2, X3 and X4 are live defects in production code.**

- A stylist no-show never refunds the client — 635 passing tests.
- The moderation enforcement gate can never fire — 635 passing tests.
- The OTP brute-force lockout never triggers — 635 passing tests, one of which *asserts the broken behaviour*.
- An admin can un-finalize any booking from any state — 635 passing tests.

This is not an argument that the suite is bad. 635 tests, 41 of them integration tests running against a real replica set, is a serious investment and it demonstrably catches regressions — the offer-acceptance race, the completion race and the ledger paths are all genuinely protected by it.

It is an argument about **where** the suite is blind. Every one of the four defects above lives in the seam between two components that are each individually correct and individually tested. The suite's heavy reliance on module-level mocks (`jest.mock` of `payment.service`, `booking.repository`, and runtime mutation of the `env` config object) means the collaborators are replaced at exactly the boundary where these bugs live.

**Practical consequence for the P0 work:** a green suite must not be treated as evidence that a P0 fix is complete. Each fix in §13 should land together with the integration test named in Appendix A that fails before it and passes after — otherwise the same class of defect will recur undetected.

### Documentation drift confirmed by this run

`docs/STATUS.md` states **"`npm test` → 75 suites / 373 tests pass"**. The actual current figures are **102 suites / 635 tests**. The claim is stale by 27 suites and 262 tests — a minor drift on its own, but it is the same file that §10 uses to declare Coupons and Subscriptions out of scope while documenting them elsewhere in its own body (L1). That file needs a refresh pass, not a one-line correction.
