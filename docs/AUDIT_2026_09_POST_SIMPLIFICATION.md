# Murafiq — Post-Simplification Full-System Audit

> **Verification Date:** 2026-09-12
> **Target Branch:** `remediation/audit-2026-09-p0-p3`
> **Evaluation Basis:** Working tree post-Stages S1–S7 remediation, verified against actual codebase inspection and full verification test run (`npm run verify`).
> **Status:** 0 CRITICAL · 0 HIGH · All S1–S7 remediation goals achieved.

---

## 1. Executive Summary

Following the September 2026 Full System Audit (`docs/AUDIT_2026_09_FULL_SYSTEM.md`), the codebase underwent a comprehensive, 7-stage remediation and simplification program (`SIMPLIFICATION_IMPLEMENTATION_PLAN_2026_09.md`):

1. **Authorization & Ownership Hardening (S1):** Replaced repetitive ownership checks with a unified `assertBookingParticipant` helper (S1.2), centralized role checks to `ROLES.ADMIN` enum constants, built a pure `computeSettlement` engine (S1.4), and eliminated unauthorized traversal vulnerabilities.
2. **Booking Lifecycle Consolidation (S2):** Migrated all nine booking-status writers onto the `BOOKING_TRANSITIONS` matrix and `bookingRepository.transitionStatus` CAS, and migrated ~20 ad-hoc ownership checks onto `assertBookingParticipant` with an explicit `allowAdmin` policy at every call site. `cancelBooking`'s overloaded signature was normalised. No business rule changed; one commit per writer.
3. **Adopt Settlement in Business Logic (S3):** Plumbed `computeSettlement` into cancellation, no-show, and dispute paths (S3.1–S3.2), added `PAYOUT_STATUS.NOT_OWED` for zero-disbursement bookings (S3.3), added per-party check-in timestamps (S3.4), and issued compensation coupons (S3.5).
4. **Transaction Rigor & Scaffolding Pruning (S4):** Restored unconditional multi-document Mongoose transactions via `withTransaction(...)` (S4.1–S4.2) without test mock leakages or null-session bypasses; made ledger writes fail-closed (S4.1); executed Product Decisions P1 (deleted safety scaffolding and `isFrozen`) and P2 (deleted `ReliabilityEvent`) (S4.3).
5. **Subscription Integrity & Webhook Hardening (S5):** Enforced webhook payload verification (`amountCents`) prior to CAS state transitions (S5.1), and added subscription reconciliation (S5.2).
6. **Background Sweeps & Deployment Hardening (S6):** Implemented atomic CAS on 48h request autopause (S6.1); removed unsafe OTP TTL index (S6.2); pinned Africa/Cairo timezone across all 6 crons (S6.3); added sweep indexes and deploy check script (S6.4); documented PM2 single-instance invariants (S6.5).
7. **Paymob Idempotency (S3):** Piped `idempotencyKey` from no-show settlement through `processRefund` to the `Idempotency-Key` header at the Paymob gateway.
8. **Documentation Truth & Consolidation (S7):** Reconciled all documentation discrepancies, closed all rows of the Audit §9 table, formalized Product Decisions P1–P7, and eliminated obsolete Socket.IO claims.

---

## 2. Closure of Audit Section 9: "Code Contradicts the Docs"

Every discrepancy flagged in Audit §9 has been systematically reconciled:

| # | Discrepancy Flagged in Audit §9 | Which Side Changed | Authoritative Resolution |
|---|---|---|---|
| 1 | **Cancellation Split 100/75 vs 97/3 & 80/20** (`AGENTS.md`, `MONEY_AND_LEDGER.md`, `PHASE_06`) | **Docs Updated** | The code's 97/3 (early) and 80/20 (late) splits are authoritative per Revision Stage R6. `AGENTS.md`, `MONEY_AND_LEDGER.md`, and `PHASE_05_BOOKINGS_SCHEDULING.md` were corrected. |
| 2 | **Nonexistent Constants** `CANCELLATION_FULL_REFUND_HOURS`, `CANCELLATION_PARTIAL_REFUND_PERCENTAGE` | **Docs Updated** | Removed nonexistent constant references. Docs now cite `CANCELLATION_POLICY.EARLY_HOURS`, `CANCELLATION_POLICY.EARLY_CLIENT_REFUND_PERCENTAGE`, and `CANCELLATION_POLICY.LATE_CLIENT_REFUND_PERCENTAGE`. |
| 3 | **Socket.IO Realtime Delivery in 8 Files** (`AGENTS.md`, `PHASE_00`, `PHASE_07`, etc.) | **Docs Updated (Product Decision P7)** | Removed all claims of Socket.IO. Formalized Firebase Firestore for realtime chat and FCM + MongoDB for push notifications across all 8 documents. |
| 4 | **Active Plan Changes via CAS vs `updateById`** (`AGENTS.md:69`) | **Code Updated** | In Revision Stage R3, `SubscriptionRepository.replaceActivePlanCAS` was built at [`subscription.repository.js:69`](../src/modules/subscriptions/subscription.repository.js#L69) to update active subscription states under concurrency guards. |
| 5 | **Safety Scaffolding & `isFrozen`** (`AGENTS.md:189`) | **Code & Docs Updated (Product Decision P1)** | Completely deleted dead safety scaffolding: removed `Booking.isFrozen`, `frozenReason`, `frozenAt`, `{isFrozen, payoutStatus}` index, `NOTIFICATION_TYPES.'safety'`, and the `AGENTS.md` invariant claim. `src/modules/safety/` intentionally unbuilt. |
| 6 | **Payout Transitions "State-Guarded in Mongoose Transactions"** (`MONEY_AND_LEDGER.md:94`) | **Docs Updated** | Clarified in `MONEY_AND_LEDGER.md` that `markProcessing` is state-guarded at the service layer on a single document, while `markPaid` runs within an atomic multi-collection transaction. |
| 7 | **Crons Lack Cairo Timezone** | **Code Updated (S6.3)** | Pass `{ timezone: BUSINESS_TIMEZONE }` ('Africa/Cairo') across all 6 cron jobs in `src/jobs/*.cron.js`. |
| 8 | **`round2` Definition** (`MONEY_AND_LEDGER.md:10`) | **Docs Updated** | Updated `MONEY_AND_LEDGER.md` to reflect `Math.round((Number(num) + Number.EPSILON) * 100) / 100`. |
| 9 | **Coupon Issuance for Late Stylist Cancellation** | **Docs Updated** | Documented goodwill coupon eligibility via `src/modules/coupons/` rather than hardcoded inline mutations. |
| 10 | **Losing Stylists `OFFER_REJECTED`** | **Docs Updated** | Clarified in Stage R5 that competing broadcast offers remain available or rejected without side-effect cascades. |
| 11 | **Rejecting Offer Returns Request to Pending** | **Docs Updated** | Clarified in Stage R5 that request remains active (`OPEN`) without resetting sibling offers. |
| 12 | **Booking 5 vs 7 Statuses** (`PHASE_05:30`) | **Docs Updated** | Updated `PHASE_05_BOOKINGS_SCHEDULING.md` to list all 7 enum statuses: `confirmed`, `in-progress`, `completed`, `cancelled`, `disputed`, `no-show-stylist`, `no-show-client`. |
| 13 | **Cron Single-Instance Guards** (`03_SKELETON_STATUS.md:73`) | **Docs Updated** | Documented that module-level boolean guards protect single-instance node processes; multi-instance cluster PM2 deployments require a Redis distributed lock (tracked in deferred backlog). |
| 14 | **Two Human Sign-offs for Moderation Cutover** | **Docs Updated** | Documented that `MODERATION_PROVIDER` remains `none` per Product Owner decision. |
| 15 | **`ecosystem.config.cjs` Justification** | **Docs Updated** | Updated `docs/OPS.md` to articulate the four architectural invariants requiring `instances: 1` in v1. |
| 16 | **Skeleton Status §10 Contradiction (L1)** | **Docs Updated** | Updated `03_SKELETON_STATUS.md` §10 to remove Coupons and Subscriptions from "Out of Scope", noting their full completion in Revision Stages R2/R3/R6. |
| 17 | **Proration on Plan Change (M28)** | **Docs Updated (Product Decision P3)** | Spec Revision §E.5 amended to match code and Product Guide: no proration on plan upgrade; period resets immediately with full charge. |
| 18 | **Ledger Entry Type Enum Names (D.13)** | **Docs Updated** | Recorded code's authoritative enum values in Revision §G.1 matching `src/modules/ledger/ledger-entry.model.js`. |

---

## 3. Global Invariants Verification Matrix (Stages S1–S6)

All constraints were inspected and verified against the working tree. Task IDs match the commit log.

### S1.2: Participant Ownership Helper
- **Function Definition:** [`assertBookingParticipant`](../src/common/authz/assertParticipant.js#L29) at `assertParticipant.js:29`.
- **Call Sites (booking.service.js):** Lines [188](../src/modules/bookings/booking.service.js#L188) (getById), [199](../src/modules/bookings/booking.service.js#L199) (checkIn), [245](../src/modules/bookings/booking.service.js#L245) (confirmCompletion), [297](../src/modules/bookings/booking.service.js#L297) (dispute), [386](../src/modules/bookings/booking.service.js#L386), [416](../src/modules/bookings/booking.service.js#L416), [589](../src/modules/bookings/booking.service.js#L589), [616](../src/modules/bookings/booking.service.js#L616) (cancellation).
- **Call Sites (no-show.service.js):** Lines [53](../src/modules/bookings/no-show.service.js#L53), [139](../src/modules/bookings/no-show.service.js#L139).
- **Role Constant Usage:** Uses `ROLES.ADMIN` instead of literal string `'admin'`:
  - [`payment.service.js:55`](../src/modules/payments/payment.service.js#L55), [`:355`](../src/modules/payments/payment.service.js#L355)
  - `git grep -n "role === 'admin'" src/` yields 0 matches.

### S1.4: Pure Settlement Arithmetic
- **Function Definition:** [`computeSettlement`](../src/common/settlement.js#L40) at `settlement.js:40`.
- **Invariance Properties:** Pure, side-effect free arithmetic guaranteeing:
  - $\text{Client Refund} + \text{Platform Fee} = \text{Gross Amount}$
  - Stylist cancellations accrue independent penalties without deducting from the client's 100% refund.
  - Verified by differential test [`tests/unit/settlement.differential.test.js`](../tests/unit/settlement.differential.test.js), integration test [`tests/integration/settlement.differential.integration.test.js`](../tests/integration/settlement.differential.integration.test.js), and unit tests [`tests/unit/settlement.test.js`](../tests/unit/settlement.test.js).

### S3: No-Show Settlement & Recovery Lifecycle
- **Atomic CAS on Settlement Resume (S3.2):** [`claimSettlementResume`](../src/modules/bookings/booking.repository.js#L303) at `booking.repository.js:303`.
- **Payout Status `not_owed` (S3.3):** Declared in [`statuses.constant.js:86`](../src/common/constants/statuses.constant.js#L86). Excluded from payout batches by the `PAYOUT_ELIGIBILITY` filter at [`booking.repository.js:224`](../src/modules/bookings/booking.repository.js#L224) which matches only `payoutStatus: 'unpaid'`.
- **Safe Migration Script:** [`scripts/migrate-s3-payout-status.js`](../scripts/migrate-s3-payout-status.js) defaults to `--dry-run`, operates idempotently, and aborts if candidate bookings are linked to active Payout batches.
- **Paymob Idempotency Header:** Plumbed from [`no-show.service.js:295`](../src/modules/bookings/no-show.service.js#L295) through [`payment.service.js:382`](../src/modules/payments/payment.service.js#L382) (`idempotencyKey` parameter) to `Idempotency-Key` header at [`paymob.provider.js:233`](../src/modules/payments/providers/paymob.provider.js#L233).

### S4: Transaction Rigor & Scaffolding Pruning
- **Unconditional Session Management (S4.1):** Centralized helper [`withTransaction`](../src/common/transaction.util.js#L23) at `transaction.util.js:23` opens a genuine Mongoose transaction without `readyState` conditional fallbacks or Jest mock reliance.
- **Fail-Closed Ledger Operations (S4.1):** Swallow-and-log try/catch wrappers eliminated. Duplicate keys return existing records on E11000; unexpected database faults throw directly.
- **Scaffolding Deletion (S4.3, Product Decisions P1 & P2):**
  - `Booking.isFrozen`, `frozenReason`, `frozenAt`, `{ isFrozen, payoutStatus }` removed from [`booking.model.js`](../src/modules/bookings/booking.model.js).
  - `ReliabilityEvent` model and imports completely removed. `git grep -rn "ReliabilityEvent" src/` yields 0 matches.

### S5: Subscription Integrity
- **Webhook Amount Verification (S5.1):** Paymob webhook compares `Number(result.amountCents)` against `ledgerService.egpToPiastres(order.amountEgp)` — the order stores EGP, not minor units — and rejects a mismatch with `400` prior to the plan activation CAS in [`subscription.service.js:619`](../src/modules/subscriptions/subscription.service.js#L619).
- **Partial Unique Index:** Enforced at database level in [`subscription.model.js:116`](../src/modules/subscriptions/subscription.model.js#L116):
  `uniq_active_subscription_per_user: { userId: 1 } where { status: 'active' }`.
- **Atomic Plan Replacement (Stage R3):** CAS transition [`replaceActivePlanCAS`](../src/modules/subscriptions/subscription.repository.js#L69) at `subscription.repository.js:69`.

### S6: Background Jobs, Sweeps & Deployment Safety
- **Autopause Lost-Update Guard (S6.1):** [`casAutoPause`](../src/modules/requests/request.repository.js#L117) at `request.repository.js:117` atomically executes `findOneAndUpdate({ _id, status: REQUEST_STATUS.OPEN }, ...)`.
- **OTP Cleanup Cron Removal (S6.2):** Removed unsafe `otp-cleanup.cron.js`. OTP expiry enforced at point of use only.
- **Timezone Pinning (S6.3):** All 6 cron jobs declare `{ timezone: BUSINESS_TIMEZONE }`:
  - [`ledger-reconciliation.cron.js:169`](../src/jobs/ledger-reconciliation.cron.js#L169)
  - [`no-show-resolution.cron.js:59`](../src/jobs/no-show-resolution.cron.js#L59)
  - [`offer-expiry.cron.js:37`](../src/jobs/offer-expiry.cron.js#L37)
  - [`request-autopause.cron.js:60`](../src/jobs/request-autopause.cron.js#L60)
  - [`session-reminder.cron.js:90`](../src/jobs/session-reminder.cron.js#L90)
  - [`subscription-renewal.cron.js:190`](../src/jobs/subscription-renewal.cron.js#L190)
- **Sweep Indexes (S6.4):** Added background indexes for no-show and offer sweep queries. Pre-flight check script [`scripts/check-duplicate-active-subscriptions.js`](../scripts/check-duplicate-active-subscriptions.js) is wired to:
  - `"prestart:prod"` at [`package.json:17`](../package.json#L17) — fires automatically **only** when launched via `npm run start:prod`.
  - `"predeploy"` — a **manual** check script (`npm run predeploy`). No `deploy` script exists in `package.json`, so this never fires automatically via npm lifecycle hooks.

### Production Launch Path

The documented production launch command is `npm run start:prod` ([`PHASE_16_DEPLOYMENT_READINESS.md:86`](PHASE_16_DEPLOYMENT_READINESS.md#L86)), which invokes `pm2 start ecosystem.config.cjs --env production` ([`package.json:18`](../package.json#L18)). The `prestart:prod` lifecycle hook fires before this command, running the duplicate-subscription check.

**However**, the same PHASE_16 doc (lines 89–90) instructs running `pm2 save` followed by `pm2 startup` to persist the PM2 process list across server reboots. When systemd resurrects PM2 after a reboot, it invokes PM2 directly — not `npm run start:prod` — so `prestart:prod` does **not** fire on subsequent reboots. The CI pipeline (`.github/workflows/ci.yml`) runs lint and tests only, with no deploy step.

**Consequence:** The duplicate-subscription check is guaranteed to run on initial deployment via `npm run start:prod`, but not on server reboots or PM2 restarts. I cannot determine from the repo alone whether operators will always launch via `npm run start:prod` or will sometimes invoke `pm2 start` directly. If the latter is possible, the check should be moved to CI or a systemd `ExecStartPre` directive to guarantee it fires on every process start.

---

## 4. Consolidation Audit Grep Results

All consolidation audit commands were executed directly against the working tree:

| Command | Expected | Actual Result | Status |
|---|---|---|---|
| `git grep -n "readyState === 1" src/` | Exactly 1 executable hit (`routes/index.js`) | 1 executable hit (`routes/index.js:49`) + 1 JSDoc comment (`transaction.util.js:6`) | ✅ PASS |
| `git grep -n "console.error" src/` | 0 in business logic | 0 in business modules (only 2 in `src/config/env.config.js:89,108` for pre-logger fatal bootstrap exit) | ✅ PASS |
| `git grep -n "role === 'admin'" src/` | 0 | 0 matches (all route through `ROLES.ADMIN`) | ✅ PASS |
| `git grep -n "userIdStr !== clientIdStr" src/` | 0 | 0 matches — every ownership check now routes through `assertBookingParticipant` | ✅ PASS |
| `git grep -n "ReliabilityEvent" src/` | 0 | 0 matches | ✅ PASS |
| `git grep -n "isFrozen" src/` | 0 active fields | 0 active fields (1 explanatory comment in `booking.repository.js:215`) | ✅ PASS |
| `git grep -n "FULL_REFUND_HOURS\|PARTIAL_REFUND_PERCENTAGE" src/` | 0 | 0 matches | ✅ PASS |
| `git grep -n "timezone" src/jobs/*.cron.js` | All 6 declare timezone | All 6 declare `{ timezone: BUSINESS_TIMEZONE }` | ✅ PASS |
| `Count of src/jobs/*.cron.js` | 6 | Exactly 6 | ✅ PASS |

---

## 5. Explicit Deferred-Work Backlog

The following items were identified during the audit and remediation as desirable enhancements but deliberately deferred to avoid out-of-scope risks during consolidation:

1. **Request Autopause `pauseCount` Gap (Finding M9):**
   *Context:* When a request is manually paused by a client (`request.service.js:379`) or expired by a background sweep, `status` is set to `PAUSED` without incrementing `pauseCount`. The auto-close threshold is a **3-reactivation limit**: [`request-autopause.cron.js:24`](../src/jobs/request-autopause.cron.js#L24) checks `(pauseCount || 0) >= 3`, and [`request.service.js:185`](../src/modules/requests/request.service.js#L185) checks `pauseCount >= 3`.
   *Rationale for Deferral:* Autopause cron correctly enforces this limit using atomic CAS. Manual client pause limits require a dedicated product UX specification for unpause quotas before modifying the client-facing pause route.
2. **Paymob Webhook `amountCents` Strictness (Finding X19):**
   *Context:* Webhook amount checks in `payment.service.js:243` and `subscription.service.js:619` verify `amountCents` when present in the callback payload (`if (result.amountCents !== undefined && result.amountCents !== null)`).
   *Rationale for Deferral:* In production Paymob callbacks, `amount_cents` is included in HMAC verification. Tightening both endpoints to throw `400` if `amountCents` is completely omitted should be done in conjunction with live Paymob staging end-to-end sandbox verification.
3. **Multi-Instance PM2 Cluster Mode (Finding M11 / Architecture D.17):**
   *Context:* Running PM2 with `instances > 1` would cause uncoordinated cron executions, duplicated session reminders, and desynchronized in-memory token version caches (`tokenVersionCache`).
   *Rationale for Deferral:* Single VPS deployment (`instances: 1`) in `ecosystem.config.cjs` satisfies v1 scale. Transitioning to horizontal clustering requires introducing Redis-backed distributed locks (`redlock` / BullMQ) and Redis cache stores.
4. **KYC Document Upload Direct-to-Cloudinary Signing:**
   *Context:* KYC identity verification documents currently stream through Multer memory storage and Sharp before reaching Cloudinary.
   *Rationale for Deferral:* Memory buffering with strict file-size limits (5MB) works reliably in v1. Migrating to client-side direct uploads via signed Cloudinary upload presets requires coordination with the mobile client application upload flow.

---

## 6. Residual Risks — Items Not Personally Signed Off On

The following behavioral changes introduced during remediation carry real operational risk. None are bugs — each was a deliberate improvement — but each changes observable behavior in a way that could surface in production as a regression if the preconditions are not met.

### 6.1 Fail-Closed Ledger (S4.1)

**Change:** Ledger writes previously used swallow-and-log try/catch wrappers. S4.1 removed all of them: a ledger write failure now propagates up through `withTransaction`, aborting the parent operation (cancellation, no-show settlement, dispute resolution).

**Risk:** A cancellation that previously "succeeded" with a silently lost ledger entry will now fail with an error, returning a 500 to the client. The cancellation itself is rolled back (which is the intended safety improvement), but the user experience degrades from "silent accounting gap" to "visible operation failure". If MongoDB has transient write issues (e.g., replica set election during a cancellation), the failure rate on money paths increases compared to pre-S4.1 behavior.

**What would make me comfortable:** Monitoring the error rate on cancellation, no-show, and dispute endpoints for the first 72 hours post-deploy. If ledger write errors appear, they indicate a real infrastructure problem (not a code bug), but the operator must be aware that these endpoints are now stricter. A runbook entry in `docs/OPS.md` for "ledger write failure on cancellation" would close the gap.

### 6.2 Moderation Substring Matching Removed (S4.3, finding S-12)

**Change:** `moderation.scanner.js` previously flagged a blocked word if the normalised text merely
*contained* it (`|| lowerText.includes(normWord)`), and matched blocked domains by bare
`String.includes`. S4.3 removed both: a blocked word now matches only on a Unicode word boundary
(`(?:^|[^\p{L}\p{N}])word(?:$|[^\p{L}\p{N}])`, [`moderation.scanner.js:139-141`](../src/modules/moderation/moderation.scanner.js#L139)),
and domains match via a boundary-aware regex ([`:109-118`](../src/modules/moderation/moderation.scanner.js#L109)).
A frozen corpus ([`tests/unit/moderation.corpus.test.js`](../tests/unit/moderation.corpus.test.js))
pins both directions.

**Risk:** This is a genuine two-sided behavioural change on live traffic, not a no-op. It removes a
large class of false positives — the motivating case was the name "Hassan" being flagged because it
contains "ass", and the domain "me" matching the word "message". But it necessarily also removes
true positives that only ever matched as substrings: a blocked term concatenated into a larger token
(`badwordbadword`, `xxbadwordxx`) or glued to adjacent characters without a separator is no longer
flagged. Deliberate evasion by inserting separators was never caught by either implementation, so
the loss is confined to *incidental* embedding.

**Note on scope:** this change is independent of `MODERATION_PROVIDER`. The blocked-word scan is a
local word-list pass that runs regardless of provider, so setting `MODERATION_PROVIDER=none` does
not disable it and does not neutralise this change. It is also unrelated to Product Decision P2,
which deleted the unwired `ReliabilityEvent` model; the two only share a commit.

**What would make me comfortable:** a one-off replay of the last 30 days of `ModerationEvent`
records (or chat/request text) through both the old and new scanner, confirming the set of newly
*unflagged* items contains no genuine violations. Until that replay is run, this is a knowingly
accepted reduction in recall bought in exchange for a large reduction in false positives.

### 6.3 H.1 Migration Script Not Run Against Production Data

**Change:** [`scripts/migrate-s3-payout-status.js`](../scripts/migrate-s3-payout-status.js) backfills `payoutStatus: 'paid'` -> `'not_owed'`. Its filter is deliberately narrow: `{ status: 'no-show-stylist', payoutStatus: 'paid', payoutId: null | absent }` — a stylist no-show that never reached a real `Payout` batch, where `'paid'` meant "nothing owed" rather than "disbursed". It is dry-run unless `--apply` is passed, is idempotent (the filter no longer matches after it runs), and hard-aborts if any candidate appears in a `Payout` batch.

**Risk:** The script has been tested against test data only. Running it against production data with real booking history and edge cases (partially refunded bookings, bookings with disputed payouts, bookings created before the `payoutStatus` field existed) could surface data shape assumptions that the test suite does not cover. A `--dry-run` that reports 0 candidates masks a query bug as easily as it reports a clean state.

**What would make me comfortable:** Running `node scripts/migrate-s3-payout-status.js --dry-run` against a recent production database snapshot (not the live database) and verifying that the candidate count and selected documents match manual spot-checks. Only after that should the script be run without `--dry-run` on the live database during a maintenance window.

---

## 7. Conclusion & Production Readiness

The Murafiq codebase has been successfully consolidated. All architectural contradictions between documentation and code have been closed. Concurrency controls (CAS, unique indexes, replica-set transactions) are fully active, the full suite passes at 129/129 suites and 1018/1018 tests (a pass rate, not a statement about line or branch coverage, which this project does not measure), and OpenAPI documentation matches all 137 live endpoints.

The residual risks in §6 are operational, not architectural. Each has a clear mitigation path that does not require code changes — only monitoring, confirmation, and a dry-run against production data. The codebase is ready for production deployment once those mitigations are executed.
