# Murafiq — Targeted Simplification & Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse ~45 sites where one rule is written many times down to ~6 shared
primitives, make the no-show settlement path atomic, and delete or decide every piece of
proven-dead code — without changing a single business rule, state name, API contract or
financial safeguard.

**Architecture:** Unchanged. Modular monolith, `Route → Validator → Controller → Service →
Repository → Model`. The only new structures are four pure/low-level helpers in `src/common/`
and one transition table plus one CAS repository primitive inside `src/modules/bookings/`.
No new dependencies, no new infrastructure, no new failure domains.

**Tech Stack:** Node 20 ESM · Express 5 · Mongoose 9 (Atlas replica set) · Zod 4 · Jest 30 +
mongodb-memory-server · node-cron · BullMQ/ioredis · Paymob · Firestore · Cloudinary · Winston.

**Spec / source of truth, in precedence order:**
1. `docs/REVISION_BUSINESS_RULES_AND_ARCHITECTURE.md` (R0–R12, §E–§I)
2. `docs/REVISION_MODERATION_CLASSIFIER_GATE.md`, `docs/AUDIT_2026_09_FULL_SYSTEM.md`,
   `docs/REMEDIATION_2026_09_FULL_SYSTEM.md`
3. Current implementation (re-read at `file:line` for every claim below)
4. Current tests (113 files / 696 tests)
5. Older phase docs

**Companion assessment:** `docs/SIMPLIFICATION_ASSESSMENT_2026_09.md`. This plan **supersedes**
that document wherever the two disagree; §0.1 below lists every disagreement and why.

**Baseline:** branch `remediation/audit-2026-09-p0-p3` @ `e894088`.
**Source files modified by this planning phase: 0.**

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from
the code and the Revision.

- **Verification gate.** Every task ends green on `npm run verify`
  (= `npm run lint && npm run validate:openapi && npm test`). `validate:openapi` must keep
  reporting **137/137** documented endpoints.
- **No business-rule change.** Refund percentages `97/3`, `80/20`, `100/0`; stylist penalties
  `3%` / `20%` / `10%`; no-show stylist `100/0/0 + 10% penalty + coupon`; no-show client
  `60/20/20 + no penalty + no coupon`; coupon `10%`, cap `150 EGP`, expiry `14 days`;
  grace `30 min`; response window `2 h`; dispute window `48 h`; early/late boundary
  `>= 24 h` is client-favourable. These numbers appear in exactly one place today
  (`src/common/constants/statuses.constant.js:73-140`) and must still appear in exactly one
  place afterwards.
- **No state added or removed** except where this plan names it explicitly and a phase gate
  authorises it. Booking stays at **7** statuses.
- **No API change.** No route added, removed, renamed or re-shaped. No response field removed.
- **Money representation is frozen.** Decimal EGP in operational models via `round2`;
  integer piastres **only** in `LedgerEntry`, converted at the single `egpToPiastres`
  boundary (`src/modules/ledger/ledger.service.js:9`).
- **Never remove a CAS, a transaction, a unique index, an idempotency key, or an
  immutability hook.** Every change in this plan either adds one or leaves it identical.
- **Rationale comments are an asset.** When code moves, its explanatory comment moves with
  it. Do not summarise, shorten or drop the `// See docs/AUDIT_2026_09_FULL_SYSTEM.md
  finding X…` notes — they are the only record of why a guard exists.
- **`ApiError`, `ApiResponse` and `asyncHandler` are globals** installed by
  `src/common/globals.js` via `globalThis`. They are intentionally not imported in service
  files. Do not "fix" this; tests that need them import `src/common/globals.js` directly.
- **Commit granularity.** One writer / one call site per commit. Never migrate two writers
  in one commit.
- **Phase 15 (AI) is out of scope.** Do not create `src/modules/ai/` content, embeddings,
  RAG, agents or vector search.

---

## 0. Executive summary of the delta from the assessment

### 0.1 Corrections to `SIMPLIFICATION_ASSESSMENT_2026_09.md`

Each of these was re-verified in code during this planning pass. They materially change what
should be built.

| # | Assessment claim | Verified reality | Consequence |
|---|---|---|---|
| C1 | "`otp-cleanup.cron` → **REMOVE**, a Mongo TTL index on `otpExpiresAt` does this natively" | **Dangerous and wrong.** A TTL index deletes the **whole document**. `otpExpiresAt` lives on `User` (`src/modules/users/user.model.js`), so a TTL index there would **delete user accounts 10 minutes after an OTP is issued.** | Do **not** add a TTL index. The cron is pure hygiene — expiry is already enforced at point of use (`auth.service.js:132`, `:403`) and `otpAttempts` is reset on every issue (`:106`, `:168`, `:391`). **Delete the cron with no replacement.** |
| C2 | "the subscription path gains the CAS the booking path already has (M4 still open)" | **M4 is already fixed.** `subscription.service.js` CAS-claims `pending → processing` via `subscriptionOrderRepository.transitionStatus` before granting, reverts to `pending` on grant failure, and only writes `paid` after the grant succeeds. | The `SubscriptionOrder → Payment` merge's headline justification is gone. The **real** asymmetry is that the subscription webhook performs **no amount verification** (the booking webhook does, `payment.service.js:249-262`). Fix that directly — it is 10 lines — instead of merging two models. |
| C3 | "route every pair through `postDoubleEntry` → +atomicity" | `postDoubleEntry` (`ledger.service.js:101-110`) is **two sequential `postEntry` calls**. It is atomic only if a session is threaded *and* the caller holds a transaction. Its own JSDoc overstates this. Both existing `postDoubleEntry` call sites (`booking.service.js:835`, `no-show.service.js:286`) pass **no session** and are therefore *still* non-atomic today. | The fix is `postDoubleEntry(debit, credit, session)` **inside a caller transaction**, plus correcting the JSDoc. Routing calls through the helper alone buys nothing. |
| C4 | "`request-autopause` … add an index (full scan every 5 minutes)" | `request.model.js:67` already declares `{ status: 1, autoPauseAt: 1 }`. The sweep is indexed. | Drop the index item for autopause. The **lost-update** defect (M9) is real and stays. The missing indexes are on `findPendingNoShowReports` (`booking.repository.js:242-249`) and the offer-expiry sweep, per L12. |
| C5 | "`REQUEST_STATUS.DECLINED` → merge into `CLOSED`" | `REVISION…md:502,512,878` documents `DECLINED` as a **terminal state with a legacy backfill mapping** (`rejected → DECLINED`). `tests/unit/status.migration.test.js` asserts the enum. | This is a **PRODUCT DECISION**, not a free simplification. Excluded from the implementation scope. |
| C6 | no-show: "Nothing financial has happened yet, so there is nothing to unwind" (code comment at `no-show.service.js:220-224`) | **False.** `scheduleRepository.deleteByBookingId(bookingId)` runs at `no-show.service.js:211` — *before* the CAS claim at `:213`. When the CAS loses (the booking actually completed), the stylist's calendar block is **already deleted** and is never restored. | Real correctness defect, not previously reported. Move the schedule delete **after** a successful claim. |
| C7 | no-show refund failure handling | The refund error is swallowed at `no-show.service.js:245-250`, and `payoutStatus` is then written **unconditionally** at `:259`. A booking whose refund failed is still marked settled. | Real correctness defect, not previously reported. Folded into the S3 transaction work. |
| C8 | "`SubscriptionOrder` merge is the single highest-value structural merge" | With C2 applied, the merge buys: one fewer model, one fewer webhook entry point, and reconcilable subscription entries. The last of those is achievable **without** the merge (add `paymentId`/a correlation field the cron walks). | Demoted to **OPTIONAL FUTURE REFACTOR — recommended NOT to implement now.** See §L. |

### 0.1b Corrections from the 2026-09-11 adversarial re-review (round 2)

Six concerns were raised against the first draft of this plan and each was re-verified against
the code. Five were correct and changed the plan; one was based on a misreading, and the plan's
wording — not its intent — was the defect.

| # | Concern | Verdict | Change |
|---|---|---|---|
| **C9** | S3.2's crash window (provider refunds, process dies before the settlement transaction) is unrecoverable | **CONFIRMED** — `resolveNoShow` early-returns on a terminal status (`no-show.service.js:184-190`), `findPendingNoShowReports` cannot see a claimed booking (`booking.repository.js:242-249`), no `REFUNDING` sweep exists, and reconciliation stays silent because neither half of the penalty pair was written | **New mandatory Task S3.2a**: `settlementCompletedAt` marker, resume-aware refund step that fail-stops on `REFUNDING`, bounded retry via a second pass in the *existing* no-show cron |
| **C10** | S3.4 should not populate both per-party check-in fields | **PARTIALLY CONFIRMED** — the plan said "set both the per-party field **and** `checkInAt`", i.e. one per-party field plus the legacy one, which is correct. But the sentence reads as "set both per-party fields", and in a plan written for an engineer with no context that ambiguity is a defect | S3.4 rewritten to be unambiguous, with an explicit DO-NOT box and a permanent regression test asserting the two fields are never co-written |
| **C11** | H.2's backfill into both fields fabricates attendance evidence | **CONFIRMED** — that is exactly what the draft said to do, and it would write the L5 hole permanently into the data | **H.2 now writes zero documents.** Replaced with a time-boxed, code-side legacy fallback keyed on `createdAt < CHECKIN_SPLIT_AT` |
| **C12** | `allowAdmin = true` is a fail-open authorization default | **CONFIRMED** | Default changed to **`false`**; the six admin-admitting sites pass `{allowAdmin: true}` explicitly; a fail-closed test and a `system-coherence` explicitness assertion added |
| **C13** | Recording `postSettlementErrors` is not a recovery path | **CONFIRMED** — a blocked `ScheduleBlock` and an unissued coupon would stay broken forever | Step D is now **retried** by the same S3.2a marker + sweep. All four steps verified idempotent (`deleteMany`, partial-unique coupon index, `isLocked: true`, absolute reliability recompute). No queue, no DLQ, no new job |
| **C14** | S0's product decisions should not gate unrelated phases | **CONFIRMED** — no product decision blocks S1–S3, S4.1/4.2/4.4, S5, S6 or S7; P3 blocks nothing at all | Gate scope narrowed to a per-item table in S0. Only a green baseline is a global gate |
| **C15** | Paymob duplicate refund risk on S3.2/S3.2a crash retry | **CONFIRMED** — if Step B succeeds at Paymob but crashes before Step C commits, a re-invocation could double-refund | Added Paymob refund idempotency guard: re-check `payment.status` before calling `processRefund` (skip if already `refunded` / `partially_refunded`); pass deterministic `idempotencyKey: 'refund-noshow-' + bookingId` |
| **C16** | S3.2a sweep cutoff (`since`) creates an orphan window on long outages / clock drift | **CONFIRMED** — bookings confirmed prior to rolling `since` cutoff would be permanently dropped from recovery | Removed `since` time cutoff in `findUnfinishedNoShowSettlements`. Query is strictly state-driven on `settlementCompletedAt: null`, sorted by `confirmedAt: 1`, with bounded batching (`limit: 50`) |
| **C17** | Cluster-mode concurrency race in S3.2a resume sweep | **CONFIRMED** — multiple PM2/cluster workers could simultaneously sweep and trigger Step B on the same booking | Added atomic claim `claimSettlementResume` (`findOneAndUpdate` with `isResuming` guard) and `releaseSettlementResumeClaim` error unwind |
| **C18** | Single-line regex / grep in S2 Step 7 misses Prettier-wrapped multiline `assertBookingParticipant` calls | **CONFIRMED** — single-line regexes truncate on Prettier-formatted multiline arguments | Replaced with multiline-safe AST/regex test and Node verification script checking that every call site states `allowAdmin` explicitly |

---

### 0.2 Two source-grepping test files constrain every refactor

`tests/unit/system-coherence.test.js` and `tests/unit/status.migration.test.js` assert on
**source text**, not behaviour. Any task that moves code must check them:

- `system-coherence.test.js:114` — greps `booking.service.js` for `BOOKING_TERMINAL_STATUSES`.
- `system-coherence.test.js:125-135` — greps `booking.repository.js` for
  `isFrozen: { $ne: true }` and for a single shared `PAYOUT_ELIGIBILITY` predicate.
- `system-coherence.test.js:161-179` — asserts at least one scheduled job, that **every**
  `src/jobs/*.cron.js` contains `if (registered) return`, and that `ecosystem.config.cjs`
  still pins `instances: 1` / `exec_mode: 'fork'`.
- `status.migration.test.js:67` — asserts `BOOKING_STATUS` matches the model enum exactly.

These are load-bearing guards. **Update them deliberately, in the same commit as the code
they describe, never as an afterthought.**

---

## A. EXECUTIVE DECISION

# PROCEED WITH RESTRICTIONS

**Why proceed.** The complexity in Murafiq is accidental, not essential, and it is
concentrated in places where the duplicated copies *already disagree with each other* —
which is the bug class the 2026-09 audit kept re-finding (X4 admin resurrects any booking,
X9 terminal overwrite, X10 `in-progress` cancellable, and the ~20 ownership checks that
disagree about admin bypass). Consolidating those does not trade safety for tidiness; it
removes the mechanism by which the tenth writer gets it wrong. Every change below either
adds a CAS/transaction or leaves the existing one byte-identical. None removes one.

**Why with restrictions.** Three restrictions, and they are not negotiable:

1. **The business-rule surface is frozen.** 7 booking states, 2 no-show states, the
   4-branch cancellation matrix, the double-entry ledger, the penalty-debt model and the
   preventive moderation gate all stay exactly as they are. Each was tested against the
   Revision and each encodes a distinct financial outcome with nowhere else to live. The
   headline "reduce to `PENDING → ACCEPTED → COMPLETED + CANCELLED`" idea **fails** on
   inspection (see §E.1) and is rejected.
2. **`SubscriptionOrder → Payment` is excluded.** With M4 verified already fixed (§0.1 C2),
   the merge's main safety argument evaporates and what remains is a data migration on the
   money path in exchange for one fewer model. That is a bad trade right now. The two
   genuine defects it was going to fix — no amount verification on the subscription webhook,
   and unreconcilable subscription ledger entries — are fixed directly and cheaply in S5.
3. **Nothing starts until S0's product decisions are signed off.** Four items
   (`safety/`, `reliability/`, `isFrozen`, proration) are *undecided scope*, not complexity.
   Refactoring around an undecided capability is how undecided capabilities become
   permanent.

**Expected outcome.** ~45 duplicated rule sites → ~6 primitives · 1 dead module and 3 dead
constants/states deleted · 7 crons → 6 · the worst partial-failure surface in the repository
(`resolveNoShow`) made atomic · 2 broken user-facing capabilities restored (KYC document
viewing, the late-stylist-cancellation coupon) · **0 business rules changed** · **0 API
changes** · **0 new dependencies**.

---

## B. SCOPE SUMMARY

### MUST DO

| ID | Item | Category | Phase |
|---|---|---|---|
| **B1** | `BOOKING_TRANSITIONS` table + `bookingRepository.transitionStatus()` CAS primitive | SIMPLIFICATION + CONCURRENCY FIX | S1, S2 |
| **B2** | One pure `computeSettlement()`; cancellation, no-show and dispute all call it | SIMPLIFICATION | S1, S3 |
| **B3** | `resolveNoShow` money writes inside one transaction; schedule-delete moved after the claim; refund failure no longer leaves the booking marked settled | CORRECTNESS FIX + CONCURRENCY FIX | S3 |
| **B3a** | `resolveNoShow` made **resumable**: a `settlementCompletedAt` marker, a resume-aware refund step, and a second pass in the existing no-show cron. Closes the crash window where the provider refunds and nothing ever finishes the settlement | CORRECTNESS FIX | S3 |
| **B4** | `withTransaction()` helper replaces the 8 duplicated `readyState === 1` guards | SIMPLIFICATION | S1, S4 |
| **B5** | `assertBookingParticipant()` replaces the ~20 divergent ownership checks | SECURITY FIX + SIMPLIFICATION | S1, S2 |
| **B6** | Ledger pairs go through `postDoubleEntry(debit, credit, session)` inside the caller's transaction; Winston instead of `console.error` | CORRECTNESS FIX | S4 |
| **B7** | Wire the KYC signed-URL path so reviewers can actually see documents (M16) | CORRECTNESS FIX | S5 |
| **B8** | Per-folder upload authorization (M15) | SECURITY FIX | S5 |
| **B9** | `request-autopause` through the repository with a CAS; drop the dead `'pending'` branch (M9) | CONCURRENCY FIX | S6 |

### SHOULD DO

| ID | Item | Category | Phase |
|---|---|---|---|
| **S-1** | `payoutStatus: 'not_owed'` replaces the `'paid'` overload that caused X1 | CORRECTNESS FIX | S3 |
| **S-2** | Per-party check-in (`clientCheckInAt` / `stylistCheckInAt`) closes the L5 fraud gate | SECURITY FIX | S3 |
| **S-3** | Issue the late-stylist-cancellation coupon that is computed and never issued (L8) | CORRECTNESS FIX | S3 |
| **S-4** | Subscription webhook amount verification (parity with `payment.service.js:249-262`) | SECURITY FIX | S5 |
| **S-5** | Subscription ledger entries carry a field the reconciliation cron walks (M3) | CORRECTNESS FIX | S5 |
| **S-6** | Delete `src/modules/reliability/` **or** wire it — per the S0 decision | DEAD CODE CLEANUP | S4 |
| **S-7** | Delete `CANCELLATION_POLICY.FULL_REFUND_HOURS` / `PARTIAL_REFUND_PERCENTAGE` (L6) | DEAD CODE CLEANUP | S4 |
| **S-8** | Delete `PAYMENT_STATUS.CANCELLED` (0 references) | DEAD CODE CLEANUP | S4 |
| **S-9** | Delete `otp-cleanup.cron.js` — **no TTL index** (see §0.1 C1) | DEAD CODE CLEANUP | S6 |
| **S-10** | `{ timezone: 'Africa/Cairo' }` on all remaining crons (M11) | CORRECTNESS FIX | S6 |
| **S-11** | Indexes for `findPendingNoShowReports` and the offer-expiry sweep (L12) | PERFORMANCE | S6 |
| **S-12** | Drop the moderation scanner's substring fallback (L13) | CORRECTNESS FIX | S4 |
| **S-13** | Fix `booking.controller.resolveDispute` inverted arguments (L10) | CORRECTNESS FIX | S4 |
| **S-14** | Document `instances: 1` as load-bearing for **all four** properties in `ecosystem.config.cjs` | DOCUMENTATION FIX | S6 |

### OPTIONAL (not scheduled; do only if time remains after S7)

| ID | Item | Category |
|---|---|---|
| **O-1** | `BlockedWord` + `BlockedDomain` → `BlockedTerm` | OPTIONAL FUTURE REFACTOR |
| **O-2** | `notification.listener.js` 455-line switch → declarative `EVENT → {…}` map | OPTIONAL FUTURE REFACTOR |
| **O-3** | Move 5,710 Swagger annotation lines out of `src/` into `docs/openapi/` | OPTIONAL FUTURE REFACTOR |
| **O-4** | Trim `ModerationEvent.actionTaken: 'ALLOW'` (never written) | DEAD CODE CLEANUP |

### DEFER

| ID | Item | Why |
|---|---|---|
| **D-1** | `SubscriptionOrder → Payment` merge | §0.1 C2 removed its safety argument; money path + data migration for one fewer model is a bad trade now. Revisit when a second non-booking payment purpose appears. |
| **D-2** | Redis `SET NX PX` cron leader election | Only needed when `instances > 1`. Document the dependency instead (S-14). |
| **D-3** | Redis-backing `tokenVersionCache` | Not a bottleneck at current scale. |
| **D-4** | Entitlement `capacity()` TOCTOU fix (M7) | A correct fix needs a unique/partial index or an atomic counter per metric — a real design task, not a consolidation. Track as its own work item. |
| **D-5** | Correlation IDs / alerting sink / coverage threshold (L14) | Observability programme, orthogonal to simplification. |

### DO NOT TOUCH

Authentication core (JWT pair with distinct secrets, per-device `sessions[]`, `$elemMatch`
CAS refresh rotation, reuse detection, SHA-256 session hashes, `tokenVersion`, `$slice`
session cap, OTP lockout, account-keyed OTP rate limiting, Google Sign-In) · `restrictTo` on
every mutating route and the `operator` role scoped to 3 verification routes · Zod `.strict()`
on every body · Paymob HMAC-SHA512 verification over the 21 canonical fields with
`timingSafeEqual` and the length pre-check · webhook **amount** verification · the mock
provider's production hard-block · every `idempotencyKey` and every unique / partial-unique
index · `round2`, the `platformFee + stylistPayout === amount` identity, the retained-amount
clamp, the decimal-EGP ⟂ integer-piastre boundary · `LedgerEntry` immutability hooks ·
`SubscriptionHistory` immutability · the `Penalty` accrual model · the three-layer
offer-acceptance guard and its retry loop · the two-stage completion CAS
(`setCompletionConfirmation` → `promoteToCompleted`) · the in-transaction `ScheduleBlock`
overlap check · `uniq_active_subscription_per_user` · atomic `UsageCounter.consume()` ·
the `REFUNDING` pre-provider CAS claim · the 4-branch cancellation matrix · both no-show
statuses and their distinct money · the preventive moderation gate, normalisation and
3-strike ladder · `NODE_ENV` with no default and the production placeholder-secret boot
refusal · the nightly reconciliation sweep · Firestore-based chat (no Socket.IO, no
WebSockets, no Mongo message storage).

### PRODUCT DECISION REQUIRED (gates only the S4.3 deletion items; see S0)

| ID | Decision | Blocking |
|---|---|---|
| **P1** | `src/modules/safety/` — build it, or delete `Booking.isFrozen` / `frozenReason` / `frozenAt`, the `{isFrozen, payoutStatus}` index, `NOTIFICATION_TYPES.'safety'`, and the `AGENTS.md` invariant claim | S4 (dead-code), S3 (payout eligibility touches it) |
| **P2** | `src/modules/reliability/` — wire `ReliabilityEvent`, or delete the module | S4 |
| **P3** | Proration (M28) — Revision §E.5 mandates it, the product guide documents the opposite, the code follows the guide. A yearly subscriber who upgrades at month 1 loses ~11 months | S5 (subscription work) |
| **P4** | `Subscription.status: 'past_due'` — declared, never written. Implement the 3-day grace or delete the enum value | S4 |
| **P5** | `REQUEST_STATUS.DECLINED` — keep (documented terminal state, §0.1 C5) or merge into `CLOSED` + `closedReason` | Nothing; excluded from this plan either way |
| **P6** | `ACCOUNT_STATUS.blocked` vs `suspended` — distinct or merged | Nothing; excluded |
| **P7** | Socket.IO — build Phase 7 realtime, or delete the claim from 8 documents (L2) | S7 (docs) |

**P5 and P6 are listed for completeness only. This plan does not implement either outcome.**

---

## C. CURRENT VS TARGET ARCHITECTURE

Only justified changes are shown. Everything absent from this table is unchanged.

```text
src/
  common/
    transaction.util.js          ← NEW   withTransaction(fn) — replaces 8 readyState guards
    settlement.js                ← NEW   computeSettlement(...) — pure, replaces 3 sites
    authz/assertParticipant.js   ← NEW   assertBookingParticipant(user, booking, opts)
    constants/statuses.constant.js       − FULL_REFUND_HOURS, − PARTIAL_REFUND_PERCENTAGE,
                                          − PAYMENT_STATUS.CANCELLED, + PAYOUT_STATUS.NOT_OWED
  jobs/                          7 crons → 6 (otp-cleanup deleted), all with { timezone }
  modules/
    bookings/
      booking.transitions.js     ← NEW   BOOKING_TRANSITIONS map + assertLegalTransition()
      booking.repository.js      + transitionStatus(id, fromStates[], patch, session)
      booking.service.js         9 read→guard→updateById sites → transitionStatus calls
      no-show.service.js         resolveNoShow money writes inside ONE transaction
    payments/                    ledger pairs via postDoubleEntry(…, session) in-transaction
    subscriptions/               + webhook amount verification, + reconcilable ledger field
    uploads/                     + per-folder role authorization, + signed KYC URL wired
    users/                       + signed KYC URL surfaced to reviewers
    moderation/                  − substring fallback in the scanner
    reliability/                 ← DELETED or WIRED (S0 P2)
    safety/                      ← DELETED or BUILT   (S0 P1)
```

**Counts.** Modules 24 → 23 (or 24 if `safety/` is built). Models 25 → 24 (or 25).
Mongoose enum states: net **−2** (`PAYMENT_STATUS.CANCELLED`, `Subscription.past_due` if P4
says delete) **+1** (`payoutStatus: 'not_owed'`). Crons 7 → 6. Dependencies **31 → 31**.
Booking states **7 → 7**. Endpoints **137 → 137**.

**What does not change:** the layering, the module list beyond the two dead directories, the
event bus, the Firestore chat design, the Paymob provider interface, the double-entry ledger
schema, the subscription entity set, and every route.

---

## D. DOMAIN-BY-DOMAIN FINDINGS

Every row carries exactly one primary category. Evidence is a verified `file:line`.

### D.1 Auth — **DO NOT CHANGE**

**Verified.** Distinct access/refresh secrets · per-device `sessions[]` with SHA-256 refresh
hashes and an atomic `$elemMatch` CAS rotation · reuse detection revoking only the affected
session · `jti` nonce · global `tokenVersion` with a 30 s in-process cache · `$slice` session
cap · dual transport by `X-Client-Type` · 6-digit OTP, 10-minute TTL, 5-attempt lockout
(`auth.service.js:129-150`, `:400-415`) · Google ID-token verification with verified-email
auto-linking · account-keyed OTP rate limiting, Redis-backed in production.

**Finding.** OTP expiry is enforced at point of use (`auth.service.js:132`, `:403`) and
`otpAttempts` is reset on every issue (`:106`, `:168`, `:391`). Therefore
`src/jobs/otp-cleanup.cron.js` has **zero correctness value**. → **S-9, DEAD CODE CLEANUP.**

**Explicitly rejected.** A TTL index on `User.otpExpiresAt` (§0.1 C1) — it would delete user
accounts. The enumeration-oracle fix (M19) is a real SECURITY FIX but belongs to the security
backlog, not to a simplification plan; it changes response shapes and therefore touches the
API contract this plan freezes. **Excluded.**

### D.2 Users / KYC — **CORRECTNESS FIX only, no structural change**

**Verified.** 4 verification states is the floor for a human-review workflow. Required
document sets differ by role and are enforced in the service (`user.service.js:66-84`), not
the schema — deliberate and fine.

**Finding K1 (M16) — CORRECTNESS FIX, MUST DO (B7).** `upload.service.js:52-58` stores KYC
assets as Cloudinary `type: 'authenticated'`, `access_mode: 'authenticated'`, then returns
`url: result.secure_url` (`:70`) — which for an authenticated asset is **not fetchable**.
`user.service.js:87-91` then writes `doc.documentRef || doc.url` into a field literally named
`verification.documents[].url`, and `user.dto.js:20` hands that public_id straight to the
reviewer. `getSignedKycUrl` (`upload.service.js:80-86`) exists, is exported, has a unit test
(`tests/unit/upload.service.test.js:18`) and is **called from nowhere in `src/`**. Net effect:
**a reviewer is asked to approve documents the API gives them no way to view.** The entire
verification capability is inert.

**Finding K2 (M15) — SECURITY FIX, MUST DO (B8).**
`upload.routes.js:8` is `router.post('/:folder', authMiddleware, uploadSingle, …)` — no
`restrictTo`. `upload.service.js:33` receives `user` and never reads it. Folder allowlisting
(`:6-12`, `:34`) prevents traversal but **not cross-role writes**: any authenticated client
can write into `kyc-documents` or `portfolio`.

### D.3 Requests — **CONCURRENCY FIX (autopause) only**

**Finding R1 (M9) — CONCURRENCY FIX, MUST DO (B9).** `src/jobs/request-autopause.cron.js:17-40`
imports `Request` directly, queries `status: { $in: ['pending', 'OPEN'] }` — `'pending'` is
**not a member of `REQUEST_STATUS`** (`statuses.constant.js:32-39`), so that branch is dead —
and writes with `req.save()` and no precondition. A request `CANCELLED` between the `find` and
the `save` is silently written back to `PAUSED`, and `PAUSED` is reactivatable, so **a
cancelled request comes back to life and can receive offers again.** The correct
`requestRepository.findAutoPausableRequests` (`request.repository.js:102-108`) exists and is
called from nowhere.

**Not a finding (§0.1 C4).** `request.model.js:67` already indexes `{status: 1, autoPauseAt: 1}`.
The sweep is not a collection scan.

**Excluded.** `REQUEST_STATUS.DECLINED` (P5 — PRODUCT DECISION). M10 (`expireOldRequests` run
on every list read) is real but is a performance/design change, not a consolidation. **DEFER.**

### D.4 Offers — **DO NOT CHANGE**

Offer acceptance is one transaction with a retry loop and three independent guards (Request
CAS, unique `Booking.offerId`, unique `Booking.requestId`) plus the in-transaction
`ScheduleBlock` overlap check. This is the best-tested concurrency code in the repository.
`OFFER_STATUS.CLOSED` vs `REJECTED` is a deliberate, documented product signal
(`statuses.constant.js:41-44`) — **keep both**. The only touch is S-11's `{status, expiresAt}`
index for the 5-minute expiry sweep.

### D.5 Bookings — **the centre of gravity**

**Finding BK1 — SIMPLIFICATION + CONCURRENCY FIX, MUST DO (B1).** There are **nine**
booking-status writers and they do not agree. Verified call sites:

| # | Writer | Site | Guard style | CAS? |
|---|---|---|---|---|
| 1 | `checkIn` → `in-progress` | `booking.service.js:230` | `status !== 'confirmed' && !== 'in-progress'` | **no** |
| 2 | `confirmCompletion` → confirmation stamp | `booking.service.js:266` | repository filter `{status:'in-progress'}` | **yes** |
| 3 | `confirmCompletion` → `completed` | `booking.service.js:280` | repository filter `{status:'in-progress'}` | **yes** |
| 4 | `fileDispute` → `disputed` | `booking.service.js:347` | 4 separate `if` checks | **no** |
| 5 | `resolveDispute` → `completed`/`cancelled` | `booking.service.js:501` | `status !== 'disputed'` | **no** |
| 6 | `cancelBooking` → `cancelled` | `booking.service.js:759` | terminal-list + `disputed` + `in-progress`, re-read inside the txn | txn only |
| 7 | `respondToNoShow` (contest) → `disputed` | `no-show.service.js:132` | `noShowDetails` presence checks | **no** |
| 8 | `resolveNoShow` → `no-show-*` | `no-show.service.js:213` | repository filter `{status: $in ['confirmed','in-progress']}` | **yes** |
| 9 | `adminResolveNoShow` (dismiss) → restore | `no-show.service.js:391` | `status === 'disputed'` + `noShowDetails` | **no** |

Five of nine have no CAS. Three of the four historical booking findings (X4, X9, X10) are
each one of these nine getting its guard wrong independently. The **tenth** writer has nine
places to copy from.

**Finding BK2 — SECURITY FIX, MUST DO (B5).** The participant/ownership check is copied
verbatim ~20 times. Verified divergence: `checkIn` (`booking.service.js:207-209`) and
`confirmCompletion` (`:249-251`) **exclude** admins; `getById` (`:190`), `fileDispute`
(`:310`), `addDisputeEvidence` (`:395`) and `getDisputeDetails` (`:424`) **include** them;
`getCancellationQuote` (`:655`) and `cancelBooking` (`:691`) compare against the **string
literal `'admin'`** rather than `ROLES.ADMIN`. Same decision, four spellings.

**Finding BK3 — SIMPLIFICATION, MUST DO (B2).** Settlement arithmetic exists in three places
that must agree:
1. `calculateCancellationOutcome` (`booking.service.js:~570-638`) — the 4-branch matrix.
2. `resolveNoShow` (`no-show.service.js:243`) — `round2(payment.amount * policy.STYLIST_PERCENTAGE / 100)`.
3. `resolveDispute` (`booking.service.js:485-491`) — `retainedAmount`, then
   `retainedAmount * (1 - platformFeePercentage/100)`.

All three then hand an EGP figure to `processRefund`, which **re-derives** `retainedAmount`,
clamps the stylist override and computes `platformFeeAmount`
(`payment.service.js:405-415`). Four `round2` sites for one identity.

**Finding BK4 — SIMPLIFICATION, MUST DO (B4).** `mongoose.connection?.readyState === 1`
appears **8 times** in services (`booking.service.js:741`, `offer.service.js:171`,
`payment.service.js:163`, `payout.service.js:166,372,437`,
`subscription.service.js:373,781`) plus once legitimately as a health probe
(`routes/index.js:49`). It tests *connectedness*, not replica-set support: on a standalone
mongod the guard passes and `withTransaction` throws; the non-transactional `else` branch
only runs when the DB is unreachable, where it cannot succeed either. It is dead by
construction and it makes every money path read as though atomicity were optional.

**Finding BK5 — CORRECTNESS FIX, SHOULD DO (S-3).** `calculateCancellationOutcome` returns
`couponEligible: true` for the late-stylist-cancel tier (`booking.service.js:637`).
`booking.service.js` has **no `couponService` import** and no `issueCoupon` call anywhere.
`REVISION…md:635` and the product guide both state the coupon is issued. It is not.

**Finding BK6 — SIMPLIFICATION, folded into B1.** `cancelBooking(param1, param2, cancelData)`
(`booking.service.js:668-676`) runtime-sniffs whether argument 1 is a user or an ID. Residue
of an unfinished call-site migration.

**Finding BK7 — CORRECTNESS FIX, SHOULD DO (S-13, L10).**
`booking.controller.js:100` calls `resolveDispute(id, userId, body)` against the
`(adminUserId, bookingId, …)` signature at `booking.service.js:442`. Dead today (not routed;
the live path is `admin.controller.js`) but a live trap.

**Finding BK8 — CORRECTNESS FIX, SHOULD DO (S-2, L5).** `booking.model.js:45` has **one**
shared `checkInAt` written by either party (`booking.service.js:222`). The no-show gate at
`no-show.service.js:76-83` reads that single field, so **the accused party's check-in
satisfies the accuser's gate**. The correct per-party pattern exists three fields away
(`clientConfirmedAt` / `stylistConfirmedAt`).

**Do not touch.** The two-stage completion CAS, `settleNoShow`'s CAS, `PAYOUT_ELIGIBILITY`'s
shared predicate, `BOOKING_TERMINAL_STATUSES`, and the `in-progress`-blocks-cancellation guard
(X10) — that guard is the only thing preventing a client from letting a stylist finish the job
and then cancelling for an 80% refund.

### D.6 Payments — **PROTECT; consolidate call style only**

**Verified MUST-KEEP.** HMAC-SHA512 over 21 canonical fields with length pre-check and
`timingSafeEqual` · webhook **amount** verification against `egpToPiastres(payment.amount)`
(`payment.service.js:249-262`) · `transitionStatus` CAS on every status write
(`:265-272`, `:317`, `:430-436`, `:449`, `:459`) · `REFUNDING` claimed **before** the provider
call and reverted to `paid` on provider failure (`:430-466`) · the refund refusal when
`booking.payoutStatus !== 'unpaid'` (`:396-403`) · the retained-amount clamp (`:413-415`) ·
provider interface with the mock hard-blocked in production.

**Finding P1 (M2) — CORRECTNESS FIX, MUST DO (B6).** Ledger pairs are hand-rolled as
independent `postEntry` calls with **no session**, inside `try { … } catch { console.error(…) }`:
`payment.service.js:287-305` (payment paid: CLIENT DEBIT / ESCROW CREDIT),
`payment.service.js:477-535` (refund: three pairs),
`subscription.service.js:403-422` (subscription charge). `console.error` is not Winston, so
these never reach aggregation. If the DEBIT commits and the CREDIT throws, the book is
permanently unbalanced while the payment reads `paid`.

**Note (§0.1 C3):** `postDoubleEntry` is itself two sequential `postEntry` calls
(`ledger.service.js:101-110`) — it is atomic only with a session inside a caller transaction.
The two sites that already use it (`booking.service.js:835`, `no-show.service.js:286`) pass
**no session** and are therefore also non-atomic today. Fix all of them the same way.

**Finding P2 — DEAD CODE CLEANUP, SHOULD DO (S-8).** `PAYMENT_STATUS.CANCELLED`
(`statuses.constant.js:60`) has **zero** references outside its own declaration.

**Excluded.** M26 (coupon burn race in `initializePayment`) is a genuine CONCURRENCY FIX but
is an independent bug, not a consolidation — track separately. Escrow stays as
`Payment.status === 'paid'` plus ledger entries; **do not** create an `Escrow` entity.

### D.7 Cancellation — **rules frozen; arithmetic consolidated**

`calculateCancellationOutcome` is already a pure function over
`(price, hoursUntilSession, whoCancelled)` returning a settlement object, with every number a
named constant. **There is nothing to compress in the rules.** The four branches are four
distinct financial outcomes (Revision §H).

**Finding CX1 — DEAD CODE CLEANUP, SHOULD DO (S-7, L6).**
`CANCELLATION_POLICY.FULL_REFUND_HOURS: 24` and `PARTIAL_REFUND_PERCENTAGE: 80`
(`statuses.constant.js:96-98`) are a second source of truth that no code reads. Editing them
changes nothing — which is exactly how a future reader gets it wrong.
`PARTIAL_PLATFORM_FEE_PERCENTAGE` (`:99`) must be checked with the same grep before removal.

**Finding CX2 — CONCURRENCY (accepted risk, no separate work item).** `cancelBooking` has no
retry loop, unlike `acceptOffer`. Inside a transaction, a concurrent cancel surfaces as a
`WriteConflict` → unhandled 500. After B1 the write becomes a CAS that returns `null`, which
the caller turns into a clean `409`. **Fixed as a side effect of B1.**

### D.8 No-show — **worst partial-failure surface; rules frozen**

The *flow* is correct and every gate answers a named fraud primitive (Revision §H). **Do not
remove the grace period, the response window, the contest path, admin arbitration, or the two
distinct outcomes.**

`resolveNoShow` (`no-show.service.js:179-345`) performs **eight** writes with **no transaction**
and five swallowed errors, in this order:

| Step | Site | Failure handling |
|---|---|---|
| 1. Delete the `ScheduleBlock` | `:211` | unguarded — **runs before the CAS** |
| 2. CAS-claim `status` → `no-show-*` | `:213` | correct; returns `null` on loss |
| 3. `processRefund` | `:237` | **swallowed** → `refundError` written, `logger.error` |
| 4. Write `payoutStatus` | `:259` | **unconditional**, even after step 3 failed |
| 5. Create `Penalty` | `:266` | E11000 tolerated (correct), others rethrown |
| 6. Ledger penalty pair | `:286` | **swallowed**, and **no session** |
| 7. Issue coupon | `:307` | **swallowed** |
| 8. Reliability recompute + chat lock | `:330`, `:337` | **swallowed** (acceptable — post-hoc) |

**Finding NS1 — CORRECTNESS FIX, MUST DO (B3a).** Step 1 before step 2 is wrong. The code
comment at `:220-224` claims "nothing financial has happened yet, so there is nothing to
unwind" — but the calendar block is **already deleted** when the CAS loses, and it is never
restored. A booking that genuinely completed loses its schedule block, so the stylist's slot
is freed and double-booking becomes possible for that window.

**Finding NS2 — CORRECTNESS FIX, MUST DO (B3b).** Step 4 runs unconditionally after a
swallowed step 3. A booking whose refund failed is written to a settled `payoutStatus`
anyway, and the `refundError` / `refundFailedAt` fields written on failure are **read
nowhere in the codebase** (L15). The failure is invisible and unrecoverable.

**Finding NS3 — CONCURRENCY FIX, MUST DO (B3c).** Steps 2, 4, 5 and 6 must be one atomic
unit. Steps 1, 7 and 8 are genuinely post-hoc and can stay outside — but need a durable
record rather than `logger.error`.

**Finding NS4 — CORRECTNESS FIX, SHOULD DO (S-1).** `:259` writes
`payoutStatus: policy.STYLIST_PERCENTAGE > 0 ? 'unpaid' : 'paid'` with the inline comment
`// 'paid' == nothing owed`. Overloading `'paid'` is precisely what caused X1 (a stylist
no-show silently never refunded the client, because `processRefund`'s guard reads the same
`'paid'` as "already disbursed"). The ordering fix closed the instance; a distinct
`'not_owed'` value closes the **class**.

**Do not change.** `REPORTABLE_STATUSES`, the 30-minute grace, the 2-hour window, the
contest → `disputed` escalation, `adminResolveNoShow`'s `contestedFromStatus` restore (that is
the X4 fix), `autoResolveExpiredNoShows`, or either no-show status.

### D.9 Subscriptions — **two targeted fixes; no schema merge**

**Entity verdicts (re-verified).** `Plan` KEEP (one row, both prices — the comment explains the
drift bug that motivated it) · `Subscription` KEEP (the partial unique index **is** the
invariant) · `SubscriptionHistory` KEEP (immutable, answers billing disputes, cheap) ·
`UsageCounter` KEEP (`consume()` is the only correct atomic quota primitive in the codebase) ·
`SubscriptionOrder` **KEEP for now** (see D-1).

**Finding SB1 — §0.1 C2, NOT A FINDING.** The subscription webhook **does** CAS
(`subscription.service.js:~561-577`: `transitionStatus(order._id, 'pending', {status:'processing'})`,
revert to `'pending'` on grant failure, `'paid'` only after the grant succeeds). Audit finding
M4 is **stale**. Do not "add" a CAS that is already there.

**Finding SB2 — SECURITY FIX, SHOULD DO (S-4).** The subscription webhook performs **no
amount verification**. The booking webhook does (`payment.service.js:249-262`). An intention
created before a price change, or a partial capture, grants the plan regardless. This is the
genuine asymmetry between the two handlers.

**Finding SB3 — CORRECTNESS FIX, SHOULD DO (S-5, M3).** Subscription ledger entries
(`subscription.service.js:403-422`) carry **no `bookingId` and no `paymentId`**.
`ledger-reconciliation.cron.js:51-54` walks `LedgerEntry.distinct('bookingId', {bookingId: {$ne: null}})`,
and its orphan pass (`:28-42`) starts from `Payment` and matches on `paymentId`. A
half-written subscription pair — exactly what P1 produces — is **invisible to both passes of
the job built to catch it.**

**Excluded / deferred.** M7 capacity TOCTOU (D-4) · M6 `|| 1` limit bug · M8 `refundQuota`
floor · M28 proration (P3, product decision) · M29 downgrade cycle comparison. All real; all
independent bugs rather than consolidations. Track them in the audit backlog.

### D.10 Moderation — **gate protected; one fallback removed**

**Do not simplify away:** the synchronous write-path gate, Arabic-Indic numeral folding,
zero-width stripping, tashkeel removal, the separator-tolerant phone regex, `MODERATION_MODE`
enforcement gating, the 3-strike WARN → RESTRICT → SUSPEND ladder, user reports, or admin
confirmation. Disintermediation is a revenue-existential risk for a commission marketplace;
a report-and-review loop fires after the phone number has already been exchanged.

**Finding MD1 — CORRECTNESS FIX, SHOULD DO (S-12, L13).**
`moderation.scanner.js:132` is `wordRegex.test(lowerText) || lowerText.includes(normWord)` —
the `||` branch defeats the word-boundary regex immediately before it, so a blocked word
`"ass"` matches `"Hassan"`. `:109` is pure `includes` for domains, so a blocked domain `"me"`
blocks **every message containing the word "me"**. Removing the fallback removes **false
positives only**; the detection corpus must prove zero lost detections.

**Excluded.** The `BlockedWord` + `BlockedDomain` → `BlockedTerm` merge (O-1) is a
two-collection data migration for one concept. Worth doing eventually; not worth doing
alongside the money path. `ModerationEvent` and `PolicyViolation` stay separate — an Event is
"this content matched a rule" (reviewable, may be a false positive); a Violation is "this user
has a confirmed strike" (drives enforcement, expires after 30 days). Merging them makes the
strike count unreliable, which is the one thing that must not be.

### D.11 Chat — **DO NOT CHANGE**

Firestore, `conversationId === bookingId`, created closed, opened by the `PaymentSucceeded`
listener, locked read-only on completion/cancellation/no-show settlement. Realtime delivery is
client-side via Firestore Security Rules; there is no server socket, and that is *why* it is
simple. Admin read-only access is narrowly conditioned on a disputed/cancelled booking and
audited. **Do not introduce Socket.IO, WebSockets, another realtime architecture, or Mongo
message storage.**

The only chat-adjacent item is documentation: Socket.IO is referenced in 8 documents, is not a
dependency, and nothing is attached to the HTTP server (L2). That is **P7**, resolved in S7.

### D.12 Notifications — **LOW PRIORITY, deliberately excluded**

The persist-then-push design with stale-FCM-token pruning is correct and appropriately sized.
`notification.listener.js` is 455 lines of essentially a 20-branch switch with copy inline, and
a declarative `EVENT → {type, titleKey, bodyKey, audience}` table (mirroring the working
`AUDIT_EVENT_MAP`) would shrink it ~40% and make Arabic i18n tractable later. That is **O-2**:
real, but it touches user-visible copy for zero correctness gain while the money path is being
consolidated. **Do not turn this into an i18n or event-system rewrite.**
`NOTIFICATION_TYPES.'safety'` is trimmed only if P1 says delete.

### D.13 Ledger — **schema frozen; call sites fixed**

**GENUINELY REQUIRED. Do not remove, do not shrink.** `Payment` holds *current* state and is
mutated (a refund overwrites `platformFeeAmount` / `stylistPayoutAmount`). The ledger holds
*what happened*, immutably, in order. The second question cannot be reconstructed from the
first after a refund. Penalty accrual, coupon merchant-funding, escrow hold/release and
platform revenue recognition on cancellation (X20) have **no other record**.

The primitives are not overbuilt. The **usage** is: see P1 (D.6) and SB3 (D.9).
Additionally, `postDoubleEntry`'s JSDoc at `ledger.service.js:94` claims it "posts a balanced
pair … atomically within a session" — it does so only when a session is actually passed.
**DOCUMENTATION FIX:** correct the JSDoc in the same commit as B6.

**Entry-type naming drift** (`COUPON_DISCOUNT` in code vs `COUPON_CREDIT` in the Revision):
keep the code's names, amend the spec. Renaming a live enum has no correctness benefit and
`system-coherence.test.js:31` validates every literal against the enum.

### D.14 Payouts — **one CAS, no redesign**

4 payout states are minimal for a manual disbursement with a failure path; all four are
written. Penalty netting and the 48-hour hold are correct.

M5 (`createBatchPayouts` re-pushes `createdPayouts` on `withTransaction` retry, and the
eligibility/profile reads take no session — `payout.service.js:82,86,91,169`) is a genuine
CONCURRENCY FIX producing phantom rows and duplicate `PAYOUT_CREATED` notifications. It is
**not a consolidation**, and it sits in the one module this plan otherwise leaves alone.
**Recommendation: fix it as its own commit inside S4** (it is ~5 lines: move the accumulator
into `work()`, thread the session) but do not let it grow into a payout refactor.

### D.15 Reliability — **DEAD CODE, blocked on P2**

`src/modules/reliability/` contains exactly one file, `reliability-event.model.js` (a complete
append-only score-delta model with indexes and five event types). Repository-wide grep:
**zero writers, zero readers.** The live scorer is a **different** file —
`src/modules/stylists/reliability.service.js` — which *is* called
(`booking.service.js:529`, `no-show.service.js:330`). Do not confuse the two.
A reliability score can move and nobody can explain why. **Build it or delete it (P2).**

L4's three scoring gaps (no-shows invisible to `findCompletedAndCancelledByStylistId`;
punctuality reading the shared `checkInAt`; `completedSessions` both `$inc`'d and
absolutely-set) are real BUSINESS LOGIC bugs. S-2 partially addresses the second. The rest is
**DEFER** — it is scoring design, not simplification.

### D.16 Safety — **EMPTY MODULE, blocked on P1**

`src/modules/safety/` is `.gitkeep` only. But `Booking.isFrozen` / `frozenReason` / `frozenAt`
(`booking.model.js:42-44`), the `{isFrozen, payoutStatus}` index (`:113`), the
`isFrozen: {$ne: true}` clause in `PAYOUT_ELIGIBILITY` (`booking.repository.js:180`), a
`NOTIFICATION_TYPES` value, and a `system-coherence.test.js:125` assertion all reference it.
**`isFrozen` has no writer anywhere in `src/`.** `AGENTS.md` asserts the invariant "a booking
with an open dispute or open safety report must never appear as payable" — the code cannot
enforce the second half. This is a claimed-but-absent capability. **Build it or delete it (P1).**

### D.17 Background jobs

| Job | Schedule | Load-bearing? | Verdict |
|---|---|---|---|
| `offer-expiry.cron` | `*/5 * * * *` | Complements lazy read-time expiry | **KEEP** + `{status, expiresAt}` index (S-11) + timezone (S-10) |
| `no-show-resolution.cron` | `*/15 * * * *` | **Yes** — silence must not stall settlement | **KEEP** + index for `findPendingNoShowReports` (S-11) + timezone |
| `request-autopause.cron` | `*/5 * * * *` | Yes | **FIX** (B9) + timezone |
| `session-reminder.cron` | hourly | No (courtesy) | **KEEP** + timezone. Its `reminderSentAt` guard is a non-atomic `find` → `updateOne`; with `instances: 1` it cannot duplicate today. Document, do not fix |
| `otp-cleanup.cron` | `0 4 * * *` | **No** — expiry enforced at use, attempts reset on issue | **DELETE, no replacement** (S-9). **Never a TTL index** (§0.1 C1) |
| `subscription-renewal.cron` | `0 2 * * *` | Partly — `entitlement.service` already does lazy expiry on read (X16), so the cron is load-bearing only for writing the `SubscriptionHistory` transition | **KEEP** + timezone |
| `ledger-reconciliation.cron` | `0 3 * * *` | **Yes** — the only money-integrity detector | **KEEP** + timezone + SB3's reconcilable field |

**Timezone (M11) — CORRECTNESS FIX, S-10.** `grep -L timezone src/jobs/*.cron.js` returns
**all seven files**. Three carry a `// Cairo time` comment. On a UTC host the 02:00/03:00/04:00
sweeps run at 04:00/05:00/06:00 Cairo, misaligned with the `Africa/Cairo` business-day
boundaries `businessDay.util.js` computes everywhere else.

**Leader election — DEFER (D-2).** All crons use a process-local `let registered = false`,
which is not a lock. Correctness depends on PM2 `instances: 1`. `ecosystem.config.cjs` today
justifies that pin by naming **one** cron (`offer-expiry`). It is actually load-bearing for
**four** properties: all six crons' re-entrancy, the `tokenVersionCache` 30 s in-process
revocation cache, the `session-reminder` `reminderSentAt` guard, and the moderation
blocked-word in-memory cache. **S-14: document all four.** A Redis `SET NX PX` lock is ~10
lines the day `instances > 1` is needed.

### D.18 Documentation

**DOCUMENTATION FIX, S7.** Every row in the audit's §9 "code contradicts the docs" table must
be closed by fixing one side and noting which. Confirmed live contradictions:
`03_SKELETON_STATUS.md` contradicts itself (L1) while `AGENTS.md:11-12` calls it the live
source of truth · Socket.IO in 8 documents (L2, P7) · `PHASE_05` documents 5 booking statuses
where the code has 7 · `MONEY_AND_LEDGER.md`'s `markProcessing` transaction claim ·
`AGENTS.md`'s `isFrozen` invariant (P1) · `postDoubleEntry`'s JSDoc (D.13).

**Swagger (O-3).** 5,710 of 25,754 source lines (**22.2%**) are `*.swagger.js` inside `src/`;
`admin/` alone has 826 annotation lines against 688 lines of code. Relocating them to
`docs/openapi/` is safe *because* `npm run validate:openapi` proves 137/137 before and after.
It is explicitly **not a prerequisite** for anything in this plan and the objective is not to
reduce source-line counts artificially. **OPTIONAL.**

---

## E. STATE MACHINE ANALYSIS

### E.1 Booking — 7 states — **KEEP ALL 7; CENTRALISE TRANSITIONS**

| State | Writers | Readers | Load-bearing? |
|---|---|---|---|
| `confirmed` | `createBookingFromOffer` (`booking.service.js:84`) | check-in gate, cancellation pricing, no-show `REPORTABLE_STATUSES`, `settleNoShow` CAS filter, `session-reminder.cron.js:43` | **Yes** |
| `in-progress` | `checkIn` (`:230`), `adminResolveNoShow` restore (`no-show.service.js:391`) | completion CAS filter (both stages), dispute eligibility, **the X10 cancellation block**, `settleNoShow` filter | **Yes — it is the fraud gate.** Merging it into `confirmed` reopens "let the stylist finish, then cancel for 80%" |
| `completed` | `promoteToCompleted` (`booking.repository.js:132`), `resolveDispute` (`booking.service.js:501`) | `PAYOUT_ELIGIBILITY` (anchored on `completedAt`), the 48 h dispute window, reviews | **Yes** |
| `cancelled` | `cancelBooking` (`:759`), `resolveDispute` (`:501`) | terminal list, admin chat access | **Yes** |
| `disputed` | `fileDispute` (`:347`), `respondToNoShow` contest (`no-show.service.js:132`) | cancellation block, payout exclusion, `adminResolveNoShow` precondition, admin chat access | **Yes.** As a boolean flag every one of those guards becomes a compound predicate — more conditions, not fewer |
| `no-show-stylist` | `resolveNoShow` (`no-show.service.js:213`) | terminal list, reliability | **Yes.** 100/0/0 + 10 % penalty + coupon |
| `no-show-client` | `resolveNoShow` (`:213`) | terminal list, **`PAYOUT_ELIGIBILITY` matches it specifically** (`booking.repository.js:184`) | **Yes.** 60/20/**20** + no penalty + no coupon. It is the one non-completed booking a stylist is still paid for, and its payout clock anchors on `noShowDetails.confirmedAt`, not `completedAt` |

**Verdict: 7 is the correct number.** The proposed reduction to
`PENDING → ACCEPTED → COMPLETED + CANCELLED` fails on four independent counts — the X10 fraud
gate, the unqueryability of `no-show-client` for payout eligibility, the two distinct payout
clocks, and the dispute guards. Encoding no-shows as `cancelled + reason` was explicitly
considered and rejected in Revision §F.3. **NOT SAFE TO SIMPLIFY.**

**Transitions: CENTRALISE.** The legal-transition map derived from the nine writers, to be
encoded verbatim in `booking.transitions.js`:

```text
confirmed    → in-progress | cancelled | disputed | no-show-stylist | no-show-client
in-progress  → completed | disputed | no-show-stylist | no-show-client
               (NOT cancelled — X10)
disputed     → completed | cancelled          (resolveDispute)
             → confirmed | in-progress        (adminResolveNoShow dismissal, restoring
                                               noShowDetails.contestedFromStatus only)
completed    → disputed                       (within 48 h, once — X7)
cancelled    → (terminal)
no-show-*    → (terminal)
```

### E.2 `Booking.payoutStatus` — 3 states → **4 (ADD `not_owed`)**

`unpaid` | `processing` | `paid`. `'paid'` is overloaded to mean both "disbursed" and
"nothing owed" (`no-show.service.js:259`), which is the X1 mechanism. Adding `not_owed` makes
the confusion structurally impossible. This is the **only** state this plan adds.
`PAYOUT_ELIGIBILITY` matches `payoutStatus: 'unpaid'` and is unaffected;
`processRefund`'s guard (`payment.service.js:397`) is `!== 'unpaid'` and is likewise
unaffected by the new value. **Verify both explicitly in S3.**

### E.3 Payment — 7 states → **6**

`pending` `paid` `failed` `refunding` `refunded` `partially_refunded` are all written and read.
`cancelled` has **0 references** → delete (S-8). `REFUNDING` is a MUST-KEEP: it is the durable
pre-provider claim that closes X17/X18. **Do not extract a separate Refund entity.**

### E.4 Request — 6 states — **NO CHANGE IN THIS PLAN**

All six are written. `DECLINED` is documented as terminal with a legacy backfill mapping
(`REVISION…md:502,512,878`) and is asserted by `status.migration.test.js`. Merging it into
`CLOSED + closedReason` is **P5, a product decision**, and is out of scope either way.
Separately: the literal `'pending'` in `request-autopause.cron.js:18` is **not a state** — it
is a dead legacy string, deleted by B9.

### E.5 Offer — 6 states — **NO CHANGE**

`CLOSED` ("a sibling won") vs `REJECTED` ("this client declined this bid") is a deliberate,
documented distinction feeding a stylist's acceptance-rate metric
(`statuses.constant.js:41-44`). **Keep both.**

### E.6 Remaining machines

| Machine | States | Verdict |
|---|---|---|
| Verification (KYC) | `unverified` `pending` `verified` `rejected` | **4 is the floor** for a human-review workflow. No change |
| Payout | `pending` `processing` `paid` `failed` | All written. No change |
| Penalty | `OUTSTANDING` `PARTIALLY_SETTLED` `SETTLED` `WAIVED` | Partial settlement is real; `WAIVED` is an admin capability. No change |
| Coupon | `ISSUED` `REDEEMED` `EXPIRED` `VOIDED` | All read. No change |
| Subscription | `active` `past_due` `cancelled` `expired` | `past_due` is declared (`subscription.model.js:32`) and **never written**. Specs conflict. **P4 — decide, then implement or delete** |
| SubscriptionOrder | `pending` `processing` `paid` `failed` | All written, all CAS-guarded. **No change** (D-1) |
| Account | `active` `suspended` `deleted` `restricted` `blocked` | `blocked` vs `suspended` differ by who set them (moderation ladder vs admin ban) — a real distinction. **P6, excluded** |
| ModerationEvent | `actionTaken` ×5 incl. `ALLOW` | `ALLOW` is never written (a non-flagged scan returns early). Trim → **O-4** |
| PolicyViolation | `status` ×3, `enforcementAction` ×4, `violationType` ×5, `severity` ×4 | Drives the strike ladder; all used. **No change** |
| No-show | Not a separate machine — an axis of Booking + `noShowDetails` | Correct as modelled. The **code path** needs a transaction, not fewer states |

**Net enumerated-state change: −2, +1.** (`PAYMENT_STATUS.CANCELLED` out;
`Subscription.past_due` out if P4 says so; `payoutStatus.not_owed` in.)
**The state surface is not where the complexity lives — which is the point.**

---

## F. COMPLEXITY HOTSPOTS, RANKED

Ranked by (business impact × correctness impact) ÷ risk-to-fix. **E** = essential,
**A** = accidental.

| # | Hotspot | Business impact | Correctness impact | Maintenance impact | Risk to fix | E/A |
|---|---|---|---|---|---|---|
| **1** | 9 booking-status writers, 5 without CAS, guards diverge (D.5 BK1) | HIGH — every money outcome | **HIGH** — direct cause of X4, X9, X10 | HIGH | MEDIUM | **A** |
| **2** | `resolveNoShow`: 8 writes, no transaction, 5 swallowed, schedule-delete before the CAS (D.8) | HIGH | **VERY HIGH** — partial financial settlement is durable and invisible | MEDIUM | MEDIUM | **A** |
| **3** | Settlement arithmetic in 3 sites + re-derived in `processRefund` (D.5 BK3) | HIGH | MEDIUM — they agree *today* | HIGH | LOW | **A** |
| **4** | ~20 ownership checks, 4 spellings, disagreeing on admin bypass (D.5 BK2) | MEDIUM | **HIGH** — authorization bug class | HIGH | LOW | **A** |
| **5** | Hand-rolled un-sessioned ledger pairs ×4+, swallowed to `console.error` (D.6 P1) | HIGH | **HIGH** — permanently unbalanced books, never aggregated | MEDIUM | MEDIUM | **A** |
| **6** | `readyState === 1` ×8 with a dead fallback branch (D.5 BK4) | LOW | MEDIUM — a false safety signal on every money path | HIGH | **VERY LOW** | **A** |
| **7** | KYC documents unviewable; uploads unauthorized by folder (D.2) | **HIGH** — the capability is inert | HIGH | LOW | LOW | **A** |
| **8** | `request-autopause` lost update revives cancelled requests (D.3 R1) | MEDIUM | HIGH | LOW | **VERY LOW** | **A** |
| **9** | Dead/undecided code: `reliability/`, `safety/`, `isFrozen`, 3 dead constants (D.15, D.16) | MEDIUM | MEDIUM — `AGENTS.md` asserts an unenforceable invariant | HIGH | LOW *(after P1/P2)* | **A** |
| **10** | 7 crons, zero timezones, no distributed lock, `instances: 1` under-documented (D.17) | LOW | MEDIUM — 2 h off Cairo boundaries on a UTC host | MEDIUM | **VERY LOW** | partly **E** |
| **11** | Moderation substring fallback (D.10 MD1) | MEDIUM — user-visible false positives | MEDIUM | LOW | LOW | **A** |
| **12** | 5,710 Swagger lines inside `src/` (D.18) | NONE | NONE | **HIGH** — every route edit is a two-file edit | LOW | **A** |

**Essential complexity, named so nobody tries to remove it:** escrow + dispute arbitration ·
the 4-branch cancellation matrix · two distinct no-show outcomes · double-entry accounting ·
the penalty-debt model (Murafiq holds no stylist payment instrument, so the debt has nowhere
else to live) · the preventive moderation gate · per-device sessions with two revocation axes ·
daily quota **and** persistent capacity as two separate entitlement mechanisms.

---

## G. DETAILED PHASED PLAN

Eight phases. Ordering differs from the suggested S0–S8 in two places, both justified by
repository evidence:

- **Dead-code cleanup (S4) moves before concurrency hardening (S5)** — not after. The dead
  `readyState` fallback branches and the dead constants are *in the files S2/S3 just touched*,
  and removing them while the code is fresh avoids a second pass over the same money paths.
- **There is no separate "settlement" phase.** `computeSettlement` is built in S1 (pure,
  additive, differential-tested) and adopted inside S2/S3, because adopting it *is* the
  no-show/cancellation work. A separate phase would mean touching `no-show.service.js` twice.

Every phase ends green on `npm run verify` and is independently revertable.

---

### Phase S0 — Baseline, freeze and product decisions (**no code**)

**Objective.** Remove every ambiguity that would otherwise force an engineer in S1–S7 to guess.

**Exact scope.** Documentation and sign-off only. Zero source files touched.

**Affected files.** `docs/REVISION_BUSINESS_RULES_AND_ARCHITECTURE.md` (a new dated
amendment section), `docs/SIMPLIFICATION_IMPLEMENTATION_PLAN_2026_09.md` (this file: record
the decisions inline under §B PRODUCT DECISION REQUIRED).

- [ ] **Step 1: Record the baseline**

```bash
git rev-parse HEAD > docs/hardening/S0-baseline.txt
npm run verify 2>&1 | tail -40 >> docs/hardening/S0-baseline.txt
```

Expected: `verify` green — lint clean, `137/137` endpoints, 696 tests passing. If it is not
green at baseline, **stop**; nothing below is measurable against a red baseline.

- [ ] **Step 2: Obtain the four blocking decisions (P1–P4)**

Write each decision, its date and its owner into a new
`## Amendment 2026-09 — Simplification S0 decisions` section of
`REVISION_BUSINESS_RULES_AND_ARCHITECTURE.md`:

| ID | Question | If "build" | If "delete" |
|---|---|---|---|
| P1 | `safety/` module | S4 skips the `isFrozen` cleanup; a separate (out-of-plan) build task is created | S4 deletes `Booking.isFrozen`/`frozenReason`/`frozenAt`, the `{isFrozen, payoutStatus}` index, the `isFrozen: {$ne:true}` clause, `NOTIFICATION_TYPES.'safety'`, `system-coherence.test.js:125-130`, and corrects the `AGENTS.md` invariant |
| P2 | `reliability/` module | S4 skips; out-of-plan build task | S4 deletes `src/modules/reliability/` entirely (1 file, 0 references) |
| P3 | Proration (M28) | Out-of-plan implementation task | `REVISION…md` §E.5 is amended to match the product guide and the code |
| P4 | `Subscription.past_due` | Out-of-plan implementation task (3-day grace) | S4 deletes the enum value from `subscription.model.js:32` |

P5 (`REQUEST_STATUS.DECLINED`), P6 (`blocked` vs `suspended`) and P7 (Socket.IO) are recorded
but **do not gate any phase**; P7's outcome is applied in S7.

**Gate scope — narrowed. Only S0 Step 1 is a global gate.**

An earlier draft of this plan made all four decisions a blanket precondition for every later
phase. That was over-broad: verified against the code, **no product decision blocks the
booking-transition consolidation, the settlement work, the concurrency hardening, the ledger
fixes or the cron work.** Blocking them would stall the entire correctness programme on
questions none of it touches.

| Gate | Blocks | Does **not** block | Evidence |
|---|---|---|---|
| **Baseline green** (Step 1) | **Everything** | — | Nothing below is measurable against a red baseline |
| **P1** `safety/` | **S4.3's `isFrozen` deletion item only** | S1–S3, S4.1, S4.2, S4.4, S5–S7 | `isFrozen` has no writer; S3 only *verifies* `PAYOUT_ELIGIBILITY` (`booking.repository.js:180`) and does not modify the clause |
| **P2** `reliability/` | **S4.3's `src/modules/reliability/` deletion item only** | everything else | Zero writers, zero readers; the live scorer is a different file (`stylists/reliability.service.js`) |
| **P3** proration (M28) | **nothing in this plan** | everything | No phase implements, reads or alters proration. S5 is webhook amount verification + reconciliation, neither of which touches pricing. P3 is recorded for the audit backlog, not as a gate |
| **P4** `past_due` | **S4.3's enum-narrowing item only** | everything else | The value is declared at `subscription.model.js:32` and never written |

**Consequence.** S1, S2 and S3 — where essentially all the correctness value sits — start as
soon as the baseline is green. S4.3's items are individually skippable: an undecided P1 skips
the `isFrozen` item and leaves the rest of S4 intact. **Do not treat an undecided product
question as a reason to delay a concurrency fix it has nothing to do with.**

- [ ] **Step 3: Commit the amendment**

```bash
git add docs/REVISION_BUSINESS_RULES_AND_ARCHITECTURE.md docs/hardening/S0-baseline.txt docs/SIMPLIFICATION_IMPLEMENTATION_PLAN_2026_09.md
git commit -m "docs(s0): record simplification baseline and P1-P4 product decisions

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Dependencies.** None. **Business behaviour impact.** None. **Database impact.** None.
**Migration strategy.** None. **Tests.** None (baseline capture only).
**Rollback.** Revert the commit.
**Acceptance criteria.** P1–P4 written, dated and signed off. `npm run verify` green at
baseline with the output recorded. **No S-phase starts until Step 1 is green and recorded.**
The P1-P4 decisions gate only their individual S4.3 deletion items -- see the gate-scope table
above. S1, S2 and S3 proceed on a green baseline alone.
**Risk: VERY LOW.**

---

### Phase S1 — Shared primitives (pure additions, zero behaviour change)

**Objective.** Create every helper *before* anything is migrated onto it, and prove each one
reproduces existing behaviour exactly.

**Exact scope.** Four new files plus one new repository function. **Nothing calls them yet.**

**Affected files.**
- Create `src/common/transaction.util.js`
- Create `src/common/authz/assertParticipant.js`
- Create `src/common/settlement.js`
- Create `src/modules/bookings/booking.transitions.js`
- Modify `src/modules/bookings/booking.repository.js` (add `transitionStatus`, export it)
- Create `tests/unit/transaction.util.test.js`, `tests/unit/assertParticipant.test.js`,
  `tests/unit/settlement.test.js`, `tests/unit/booking.transitions.test.js`,
  `tests/unit/settlement.differential.test.js`

**Interfaces produced** (later tasks depend on these exact signatures):

```js
// src/common/transaction.util.js
export const withTransaction = async (fn) => { /* fn(session) -> T */ };   // returns T

// src/common/authz/assertParticipant.js
export const assertBookingParticipant = (user, booking, { allowAdmin = false } = {}) => {
  /* returns { userId, clientId, stylistId, isClient, isStylist, isAdmin } or throws 403 */
  /* allowAdmin DEFAULTS TO FALSE — fail closed. Every call site states it explicitly. */
};

// src/common/settlement.js
export const computeSettlement = ({
  price, event, actor, hoursUntilSession, refundPercentage, platformFeePercentage,
}) => ({
  tier, refundPercentage, refundAmount, platformFeeAmount,
  stylistCompensationAmount, penaltyAmount, couponEligible,
  hoursUntilSession, isEarly,
});
// event ∈ 'CANCELLATION' | 'NO_SHOW' | 'DISPUTE'
// actor ∈ 'client' | 'stylist' | 'admin'   (CANCELLATION)
//       ∈ 'stylist' | 'client'             (NO_SHOW: who was reported against)
//       ∈ 'admin'                          (DISPUTE)

// src/modules/bookings/booking.transitions.js
export const BOOKING_TRANSITIONS;                       // { from: [to, …] }
export const legalFromStatesFor = (toStatus) => [/* … */];
export const isLegalTransition = (from, to) => Boolean;

// src/modules/bookings/booking.repository.js
export const transitionStatus = async (bookingId, fromStates, patch, session = null) =>
  /* populated doc, or null when the CAS lost */;
```

#### Task S1.1 — `withTransaction`

**Analysis.** *Current behaviour:* 8 copies of
`if (mongoose.connection?.readyState === 1) { session = await mongoose.startSession(); … }`
with a non-transactional `else` branch. *Current complexity:* the guard tests connectedness,
not replica-set support; the `else` branch only executes when Mongo is unreachable, where it
cannot succeed either — so it is dead by construction while reading as a deliberate fallback.
*Root cause:* copied forward from a pre-replica-set era; `AGENTS.md` now declares an Atlas
replica set non-negotiable. *Proposed target:* one helper that always opens a session and uses
`session.withTransaction` (which brings the retry-on-`WriteConflict` semantics
`payout.service.js` already relies on). *Business-rule preservation:* none touched — this is
plumbing. *Security impact:* none. *Financial impact:* none in S1 (nothing calls it);
strictly positive in S4 (paths that could previously run non-atomically no longer can).
*Concurrency impact:* removes a branch that silently drops atomicity. *Data impact:*
**No migration.** *API impact:* **No API change.** *Test impact:* new
`tests/unit/transaction.util.test.js`; no existing test may change. *Rollback:* delete the
file. *Risk:* **VERY LOW.**

- [ ] **Step 1: Write the failing test**

`tests/unit/transaction.util.test.js`:

```js
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { withTransaction } from '../../src/common/transaction.util.js';

describe('withTransaction', () => {
  it('passes the session to the callback and returns its value', async () => {
    const fakeSession = {
      withTransaction: jest.fn(async (fn) => fn()),
      endSession: jest.fn(async () => {}),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(fakeSession);

    const result = await withTransaction(async (session) => {
      expect(session).toBe(fakeSession);
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(fakeSession.endSession).toHaveBeenCalledTimes(1);
    mongoose.startSession.mockRestore();
  });

  it('ends the session even when the callback throws', async () => {
    const fakeSession = {
      withTransaction: jest.fn(async (fn) => fn()),
      endSession: jest.fn(async () => {}),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(fakeSession);

    await expect(withTransaction(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(fakeSession.endSession).toHaveBeenCalledTimes(1);
    mongoose.startSession.mockRestore();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest tests/unit/transaction.util.test.js`
Expected: FAIL — `Cannot find module '../../src/common/transaction.util.js'`.

- [ ] **Step 3: Implement**

`src/common/transaction.util.js`:

```js
import mongoose from 'mongoose';

/**
 * Runs `fn(session)` inside a MongoDB transaction and returns its value.
 *
 * Replaces eight copies of `if (mongoose.connection?.readyState === 1) { … } else { … }`.
 * That guard tested CONNECTEDNESS, not replica-set support: on a standalone mongod it
 * passed and `withTransaction` threw anyway, and its non-transactional `else` branch could
 * only ever run when the database was unreachable -- where the fallback could not succeed
 * either. It read as a safety net and was dead by construction, while making every money
 * path look as though atomicity were optional. AGENTS.md declares an Atlas replica set
 * non-negotiable, so a transaction is always available in every environment the app
 * supports (tests included: mongodb-memory-server is started as a replica set).
 *
 * `session.withTransaction` -- not a manual start/commit/abort -- because it retries the
 * callback on a transient TransientTransactionError/WriteConflict, which is the behaviour
 * payout.service.js already depends on. The callback MUST therefore be idempotent.
 *
 * @template T
 * @param {(session: import('mongoose').ClientSession) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export const withTransaction = async (fn) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

export default withTransaction;
```

- [ ] **Step 4: Run the test — expect PASS, then run the whole suite**

Run: `npx jest tests/unit/transaction.util.test.js` → PASS
Run: `npm run verify` → green (nothing else changed).

- [ ] **Step 5: Commit**

```bash
git add src/common/transaction.util.js tests/unit/transaction.util.test.js
git commit -m "feat(common): add withTransaction helper (no call sites yet)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

#### Task S1.2 — `assertBookingParticipant`

**Analysis.** *Current behaviour:* ~20 verbatim copies of a three-line id-comparison guard.
*Current complexity:* the copies **disagree** — `checkIn` and `confirmCompletion` exclude
admins, six other sites include them, and four compare against the string `'admin'` rather
than `ROLES.ADMIN`. *Root cause:* copy-paste with no shared helper. *Proposed target:* one
function with an explicit `allowAdmin` flag that **defaults to `false`**, so the admin decision
is stated at each call site instead of implied, and a forgotten option denies rather than
grants. A default of `true` would be a fail-open authorization default: a new booking route
whose author omits the option would silently admit any admin, which is a worse version of the
inconsistency this helper replaces. *Business-rule preservation:* each migrated call site keeps
**its current** `allowAdmin` value — the helper does not standardise the policy, it makes the existing policy
explicit and greppable. Changing any site's admin policy is a separate, product-visible
decision and is **out of scope**. *Security impact:* strictly positive — one implementation,
`ROLES.ADMIN` everywhere, no string literals. *Financial impact:* none. *Concurrency impact:*
none. *Data impact:* **No migration.** *API impact:* **No API change** — same 403, same
message. *Test impact:* new unit test; existing authorization tests must pass unchanged.
*Rollback:* delete the file. *Risk:* **VERY LOW** in S1, **LOW** at adoption.

- [ ] **Step 1: Write the failing test**

`tests/unit/assertParticipant.test.js`:

```js
import '../../src/common/globals.js';
import { assertBookingParticipant } from '../../src/common/authz/assertParticipant.js';
import { ROLES } from '../../src/common/constants/roles.constant.js';

const booking = { clientId: 'c1', stylistId: 's1' };

describe('assertBookingParticipant', () => {
  it('accepts the client and reports which party they are', () => {
    const r = assertBookingParticipant({ _id: 'c1', role: ROLES.CLIENT }, booking);
    expect(r).toMatchObject({ userId: 'c1', isClient: true, isStylist: false, isAdmin: false });
  });

  it('accepts the stylist', () => {
    const r = assertBookingParticipant({ id: 's1', role: ROLES.STYLIST }, booking);
    expect(r).toMatchObject({ isStylist: true, isClient: false });
  });

  it('accepts an admin ONLY when allowAdmin is passed explicitly', () => {
    const r = assertBookingParticipant({ _id: 'a1', role: ROLES.ADMIN }, booking, { allowAdmin: true });
    expect(r.isAdmin).toBe(true);
  });

  it('FAILS CLOSED: rejects an admin when the option is omitted', () => {
    // The security property of this helper. If this test ever needs changing, stop.
    expect(() => assertBookingParticipant({ _id: 'a1', role: ROLES.ADMIN }, booking))
      .toThrow('Forbidden');
  });

  it('rejects an admin when allowAdmin is explicitly false', () => {
    expect(() => assertBookingParticipant({ _id: 'a1', role: ROLES.ADMIN }, booking, { allowAdmin: false }))
      .toThrow('Forbidden');
  });

  it('rejects an unrelated user', () => {
    expect(() => assertBookingParticipant({ _id: 'x9', role: ROLES.CLIENT }, booking))
      .toThrow('Forbidden');
  });

  it('unwraps populated clientId/stylistId documents', () => {
    const populated = { clientId: { _id: 'c1' }, stylistId: { _id: 's1' } };
    expect(assertBookingParticipant({ _id: 'c1', role: ROLES.CLIENT }, populated).isClient).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest tests/unit/assertParticipant.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/common/authz/assertParticipant.js`:

```js
import { ROLES } from '../constants/roles.constant.js';

const idOf = (v) => (v && typeof v === 'object' ? (v._id ?? v.id ?? v) : v)?.toString();

/**
 * The single booking participant/ownership check.
 *
 * Replaces ~20 verbatim copies that had drifted apart: two of them (checkIn,
 * confirmCompletion) excluded admins while six others included them, and four compared
 * against the STRING 'admin' rather than ROLES.ADMIN. `allowAdmin` is stated per call site
 * -- the point is not to standardise the policy (that would be a product change), it is to
 * make each site's existing policy greppable instead of implied by a copy-paste.
 *
 * `allowAdmin` DEFAULTS TO FALSE, deliberately. A privilege-granting option must fail
 * closed: a caller who forgets it gets the strictest behaviour (participants only) and a
 * visible 403, not a silent admin bypass on a booking route. The six call sites that DO
 * grant admin access pass `{ allowAdmin: true }` explicitly, which is exactly the audit
 * trail this helper exists to create. Never change this default to true "for convenience" --
 * the whole authorization bug class this replaces came from an implied policy.
 *
 * Throws the same 403 'Forbidden' the copies threw, so no API response changes.
 *
 * @param {{_id?: any, id?: any, role?: string}} user
 * @param {{clientId: any, stylistId: any}} booking  populated or raw ids both work
 * @param {{allowAdmin?: boolean}} [opts]  allowAdmin defaults to FALSE (fail closed)
 * @returns {{userId: string, clientId: string, stylistId: string,
 *            isClient: boolean, isStylist: boolean, isAdmin: boolean}}
 */
export const assertBookingParticipant = (user, booking, { allowAdmin = false } = {}) => {
  const userId = idOf(user?._id ?? user?.id ?? user);
  const clientId = idOf(booking?.clientId);
  const stylistId = idOf(booking?.stylistId);

  const isClient = Boolean(userId) && userId === clientId;
  const isStylist = Boolean(userId) && userId === stylistId;
  const isAdmin = user?.role === ROLES.ADMIN;

  if (!isClient && !isStylist && !(allowAdmin && isAdmin)) {
    throw new ApiError(403, 'Forbidden');
  }

  return { userId, clientId, stylistId, isClient, isStylist, isAdmin };
};

export default assertBookingParticipant;
```

> `ApiError` is a `globalThis` binding installed by `src/common/globals.js` — see Global
> Constraints. Tests importing this file must import `src/common/globals.js` first.

- [ ] **Step 4: Run the test, then the suite**

Run: `npx jest tests/unit/assertParticipant.test.js` → PASS
Run: `npm run verify` → green.

- [ ] **Step 5: Commit**

```bash
git add src/common/authz/assertParticipant.js tests/unit/assertParticipant.test.js
git commit -m "feat(common): add assertBookingParticipant helper (no call sites yet)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

#### Task S1.3 — `BOOKING_TRANSITIONS` + `bookingRepository.transitionStatus`

**Analysis.** *Current behaviour:* nine writers each re-derive their own legal-`from` set;
five of them then write with `updateById`, which has no precondition. *Current complexity:*
the legal-transition rule for a 7-state machine is written nine times and the nine copies
disagree. *Root cause:* no central table and no CAS primitive; the repository offers a generic
`updateById`, so that is what every writer reached for. *Proposed target:* one frozen map plus
one `findOneAndUpdate({_id, status: {$in: fromStates}}, …)` primitive returning `null` on a
lost CAS, mirroring the three CAS functions the repository **already** has
(`setCompletionConfirmation`, `promoteToCompleted`, `settleNoShow`). *Business-rule
preservation:* the map is the **union of what the nine writers do today**, transcribed from
§E.1 — no transition is added and none is removed. *Security impact:* none (authorization
stays at the service layer, via S1.2). *Financial impact:* none in S1. *Concurrency impact:*
adds CAS to five writers that have none; prevents terminal-state overwrite (X9 class) and
admin resurrection (X4 class) structurally rather than per-site. *Data impact:* **No
migration.** *API impact:* **No API change** — a lost CAS returns `null`, and each call site
maps that to the 400/409 it already returns for a stale status. *Test impact:* new
`tests/unit/booking.transitions.test.js` plus a repository integration test; every existing
booking test must pass unchanged. *Rollback:* delete `booking.transitions.js` and the
repository function; nothing calls them until S2. *Risk:* **VERY LOW** in S1.

- [ ] **Step 1: Write the failing transition-table test**

`tests/unit/booking.transitions.test.js`:

```js
import { BOOKING_TRANSITIONS, isLegalTransition, legalFromStatesFor }
  from '../../src/modules/bookings/booking.transitions.js';
import { BOOKING_STATUS } from '../../src/common/constants/statuses.constant.js';

describe('BOOKING_TRANSITIONS', () => {
  it('covers every booking status exactly once as a key', () => {
    expect(Object.keys(BOOKING_TRANSITIONS).sort())
      .toEqual(Object.values(BOOKING_STATUS).sort());
  });

  it('only ever targets a real booking status', () => {
    const valid = new Set(Object.values(BOOKING_STATUS));
    for (const targets of Object.values(BOOKING_TRANSITIONS)) {
      for (const t of targets) expect(valid.has(t)).toBe(true);
    }
  });

  it('keeps the three terminal states terminal', () => {
    expect(BOOKING_TRANSITIONS[BOOKING_STATUS.CANCELLED]).toEqual([]);
    expect(BOOKING_TRANSITIONS[BOOKING_STATUS.NO_SHOW_STYLIST]).toEqual([]);
    expect(BOOKING_TRANSITIONS[BOOKING_STATUS.NO_SHOW_CLIENT]).toEqual([]);
  });

  it('forbids cancelling an in-progress session (audit X10)', () => {
    expect(isLegalTransition(BOOKING_STATUS.IN_PROGRESS, BOOKING_STATUS.CANCELLED)).toBe(false);
  });

  it('allows confirmed -> cancelled', () => {
    expect(isLegalTransition(BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CANCELLED)).toBe(true);
  });

  it('allows completed -> disputed (the 48h window)', () => {
    expect(isLegalTransition(BOOKING_STATUS.COMPLETED, BOOKING_STATUS.DISPUTED)).toBe(true);
  });

  it('allows disputed to be restored only to confirmed or in-progress', () => {
    expect(isLegalTransition(BOOKING_STATUS.DISPUTED, BOOKING_STATUS.CONFIRMED)).toBe(true);
    expect(isLegalTransition(BOOKING_STATUS.DISPUTED, BOOKING_STATUS.IN_PROGRESS)).toBe(true);
    expect(isLegalTransition(BOOKING_STATUS.DISPUTED, BOOKING_STATUS.NO_SHOW_CLIENT)).toBe(false);
  });

  it('legalFromStatesFor inverts the map', () => {
    expect(legalFromStatesFor(BOOKING_STATUS.COMPLETED).sort())
      .toEqual([BOOKING_STATUS.DISPUTED, BOOKING_STATUS.IN_PROGRESS].sort());
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest tests/unit/booking.transitions.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the table**

`src/modules/bookings/booking.transitions.js`:

```js
import { BOOKING_STATUS } from '../../common/constants/statuses.constant.js';

/**
 * The single definition of which booking status transitions are legal.
 *
 * Transcribed from the nine status writers that existed before this file, NOT redesigned:
 * every edge below is one a writer already performed, and no edge a writer performed is
 * missing. See docs/SIMPLIFICATION_IMPLEMENTATION_PLAN_2026_09.md §E.1 for the writer-by-
 * writer derivation, and §D.5 BK1 for why nine divergent copies produced audit findings
 * X4 (admin resurrects any booking), X9 (terminal overwrite) and X10 (in-progress
 * cancellable) independently of one another.
 *
 * Two edges are load-bearing and must not be "tidied":
 *  - IN_PROGRESS deliberately does NOT reach CANCELLED (X10). A client who could cancel a
 *    session already checked into could let the stylist finish the job and then collect an
 *    80% refund, and the stylist's only recourse (fileDispute) does not accept 'cancelled'.
 *  - DISPUTED reaches CONFIRMED/IN_PROGRESS ONLY via adminResolveNoShow dismissal, which
 *    restores noShowDetails.contestedFromStatus -- never a hardcoded value (X4).
 */
export const BOOKING_TRANSITIONS = Object.freeze({
  [BOOKING_STATUS.CONFIRMED]: Object.freeze([
    BOOKING_STATUS.IN_PROGRESS,
    BOOKING_STATUS.CANCELLED,
    BOOKING_STATUS.DISPUTED,
    BOOKING_STATUS.NO_SHOW_STYLIST,
    BOOKING_STATUS.NO_SHOW_CLIENT,
  ]),
  [BOOKING_STATUS.IN_PROGRESS]: Object.freeze([
    BOOKING_STATUS.COMPLETED,
    BOOKING_STATUS.DISPUTED,
    BOOKING_STATUS.NO_SHOW_STYLIST,
    BOOKING_STATUS.NO_SHOW_CLIENT,
  ]),
  [BOOKING_STATUS.COMPLETED]: Object.freeze([BOOKING_STATUS.DISPUTED]),
  [BOOKING_STATUS.DISPUTED]: Object.freeze([
    BOOKING_STATUS.COMPLETED,
    BOOKING_STATUS.CANCELLED,
    BOOKING_STATUS.CONFIRMED,
    BOOKING_STATUS.IN_PROGRESS,
  ]),
  [BOOKING_STATUS.CANCELLED]: Object.freeze([]),
  [BOOKING_STATUS.NO_SHOW_STYLIST]: Object.freeze([]),
  [BOOKING_STATUS.NO_SHOW_CLIENT]: Object.freeze([]),
});

/** Every status a booking may legally be in immediately before reaching `toStatus`. */
export const legalFromStatesFor = (toStatus) =>
  Object.entries(BOOKING_TRANSITIONS)
    .filter(([, targets]) => targets.includes(toStatus))
    .map(([from]) => from);

export const isLegalTransition = (fromStatus, toStatus) =>
  Boolean(BOOKING_TRANSITIONS[fromStatus]?.includes(toStatus));

export default { BOOKING_TRANSITIONS, legalFromStatesFor, isLegalTransition };
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx jest tests/unit/booking.transitions.test.js` → PASS

- [ ] **Step 5: Write the failing repository CAS test**

Append to `tests/integration/bookings-scheduling.test.js` (it already has a real DB and
booking fixtures), or create `tests/integration/booking.transition-cas.test.js` if that file
is already large:

```js
it('transitionStatus writes only from a legal current status', async () => {
  const booking = await Booking.create({ /* …existing fixture shape…, status: 'confirmed' */ });

  const ok = await bookingRepository.transitionStatus(
    booking._id, ['confirmed'], { status: 'in-progress', checkInAt: new Date() }
  );
  expect(ok.status).toBe('in-progress');

  // Losing CAS: the booking is no longer 'confirmed'.
  const lost = await bookingRepository.transitionStatus(
    booking._id, ['confirmed'], { status: 'cancelled' }
  );
  expect(lost).toBeNull();

  const fresh = await Booking.findById(booking._id);
  expect(fresh.status).toBe('in-progress');   // untouched by the lost CAS
});

it('rejects a fromStates list containing a status that cannot reach the target', async () => {
  const booking = await Booking.create({ /* …, status: 'in-progress' */ });
  await expect(
    bookingRepository.transitionStatus(booking._id, ['in-progress'], { status: 'cancelled' })
  ).rejects.toThrow(/illegal booking transition/i);
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `npx jest tests/integration/booking.transition-cas.test.js`
Expected: FAIL — `bookingRepository.transitionStatus is not a function`.

- [ ] **Step 7: Implement the repository primitive**

Insert into `src/modules/bookings/booking.repository.js` immediately after `settleNoShow`
(keep `settleNoShow`, `setCompletionConfirmation` and `promoteToCompleted` — they are
explicitly DO-NOT-TOUCH and their comments document X9/X7):

```js
import { isLegalTransition } from './booking.transitions.js';

/**
 * The one compare-and-set primitive for booking lifecycle writes.
 *
 * Generalises the three hand-written CAS functions above (setCompletionConfirmation,
 * promoteToCompleted, settleNoShow) so the five writers that previously used the
 * precondition-free updateById get the same protection. Returns the updated document, or
 * `null` when the CAS lost -- the booking moved on between the caller's read and this
 * write. Callers MUST treat null as "the booking is no longer in a state this operation
 * applies to" and surface a 400/409, never retry blindly and never fall back to updateById.
 *
 * The legality assertion is a DEVELOPER guard, not a runtime authorization check: it fails
 * loudly if a caller asks for a transition BOOKING_TRANSITIONS does not contain, which is
 * a programming error. Authorization stays in the service layer.
 *
 * @param {string|import('mongoose').Types.ObjectId} bookingId
 * @param {string[]} fromStates  statuses this write is allowed to apply from
 * @param {Object}   patch       $set payload; `patch.status` is the target status
 * @param {import('mongoose').ClientSession|null} [session]
 * @returns {Promise<Object|null>}
 */
export const transitionStatus = async (bookingId, fromStates, patch, session = null) => {
  if (patch.status) {
    for (const from of fromStates) {
      if (!isLegalTransition(from, patch.status)) {
        throw new Error(
          `Illegal booking transition declared: '${from}' -> '${patch.status}'. ` +
            'Update BOOKING_TRANSITIONS deliberately if this is a real new edge.'
        );
      }
    }
  }

  const options = { returnDocument: 'after', runValidators: true };
  if (session) options.session = session;

  return Booking.findOneAndUpdate(
    { _id: bookingId, status: { $in: fromStates } },
    { $set: patch },
    options
  ).populate([
    { path: 'clientId', select: 'name profileImage' },
    { path: 'stylistId', select: 'name profileImage' },
  ]);
};
```

Add `transitionStatus` to the default export object at the bottom of the file.

- [ ] **Step 8: Run the test, then the suite**

Run: `npx jest tests/integration/booking.transition-cas.test.js` → PASS
Run: `npm run verify` → green.

- [ ] **Step 9: Commit**

```bash
git add src/modules/bookings/booking.transitions.js src/modules/bookings/booking.repository.js tests/unit/booking.transitions.test.js tests/integration/booking.transition-cas.test.js
git commit -m "feat(bookings): add BOOKING_TRANSITIONS table and repository CAS primitive

Transcribed from the nine existing status writers; no edge added or removed.
No call sites migrated yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

#### Task S1.4 — `computeSettlement` (pure) + differential proof

**Analysis.** *Current behaviour:* three independent arithmetic sites (D.5 BK3) plus a fourth
re-derivation inside `processRefund`. *Current complexity:* one identity
(`refund + stylist + platform === price`) computed four times with four `round2` calls and two
different clamping conventions. *Root cause:* cancellation was written first as a pure
function; no-show and dispute each needed "the same thing but different percentages" and
inlined it. *Proposed target:* one pure module keyed on `event`, returning the **same object
shape `calculateCancellationOutcome` already returns**, so cancellation call sites change by
one line. *Business-rule preservation:* **every number comes from `CANCELLATION_POLICY` and
`NO_SHOW_POLICY` unchanged.** No percentage, fee, penalty, coupon rule, rounding or clamp is
altered. This is proven mechanically, not asserted — see Step 5's differential test.
*Security impact:* none. *Financial impact:* **zero by construction, and the differential test
is the evidence.** *Concurrency impact:* none — the function is pure. *Data impact:* **No
migration.** *API impact:* **No API change** — `getCancellationQuote`'s response shape is
byte-identical. *Test impact:* new exhaustive table test + differential test; every existing
`cancellation.service.test.js` and `no-show.policy.test.js` case must pass unchanged.
*Rollback:* delete the file. *Risk:* **VERY LOW** in S1.

- [ ] **Step 1: Write the exhaustive table test**

`tests/unit/settlement.test.js`:

```js
import { computeSettlement } from '../../src/common/settlement.js';

// Revision §H, transcribed. price 1000 EGP keeps every expected value exact.
const P = 1000;

describe('computeSettlement — CANCELLATION', () => {
  it('client, >= 24h: 97/3, no penalty, no coupon', () => {
    expect(computeSettlement({ price: P, event: 'CANCELLATION', actor: 'client', hoursUntilSession: 24 }))
      .toMatchObject({ tier: 'EARLY_CLIENT_CANCEL', refundPercentage: 97, refundAmount: 970,
                       platformFeeAmount: 30, stylistCompensationAmount: 0,
                       penaltyAmount: 0, couponEligible: false, isEarly: true });
  });

  it('client, < 24h: 80/20', () => {
    expect(computeSettlement({ price: P, event: 'CANCELLATION', actor: 'client', hoursUntilSession: 23.9 }))
      .toMatchObject({ tier: 'LATE_CLIENT_CANCEL', refundPercentage: 80, refundAmount: 800,
                       platformFeeAmount: 200, stylistCompensationAmount: 0, penaltyAmount: 0,
                       couponEligible: false, isEarly: false });
  });

  it('stylist, >= 24h: client 100%, stylist penalty 3%, no coupon', () => {
    expect(computeSettlement({ price: P, event: 'CANCELLATION', actor: 'stylist', hoursUntilSession: 48 }))
      .toMatchObject({ tier: 'EARLY_STYLIST_CANCEL', refundPercentage: 100, refundAmount: 1000,
                       platformFeeAmount: 0, penaltyAmount: 30, couponEligible: false });
  });

  it('stylist, < 24h: client 100%, stylist penalty 20%, coupon eligible', () => {
    expect(computeSettlement({ price: P, event: 'CANCELLATION', actor: 'stylist', hoursUntilSession: 2 }))
      .toMatchObject({ tier: 'LATE_STYLIST_CANCEL', refundPercentage: 100, refundAmount: 1000,
                       platformFeeAmount: 0, penaltyAmount: 200, couponEligible: true });
  });

  it('admin is priced on the client branch — never assesses a stylist penalty', () => {
    const admin = computeSettlement({ price: P, event: 'CANCELLATION', actor: 'admin', hoursUntilSession: 2 });
    const client = computeSettlement({ price: P, event: 'CANCELLATION', actor: 'client', hoursUntilSession: 2 });
    expect(admin).toEqual(client);
  });

  it('the 24h boundary is client-favourable at exactly 24.0', () => {
    expect(computeSettlement({ price: P, event: 'CANCELLATION', actor: 'client', hoursUntilSession: 24 }).isEarly)
      .toBe(true);
  });
});

describe('computeSettlement — NO_SHOW', () => {
  it('stylist no-show: 100/0/0, penalty 10%, coupon', () => {
    expect(computeSettlement({ price: P, event: 'NO_SHOW', actor: 'stylist' }))
      .toMatchObject({ tier: 'NO_SHOW_STYLIST', refundPercentage: 100, refundAmount: 1000,
                       platformFeeAmount: 0, stylistCompensationAmount: 0,
                       penaltyAmount: 100, couponEligible: true });
  });

  it('client no-show: 60/20/20, no penalty, no coupon', () => {
    expect(computeSettlement({ price: P, event: 'NO_SHOW', actor: 'client' }))
      .toMatchObject({ tier: 'NO_SHOW_CLIENT', refundPercentage: 60, refundAmount: 600,
                       platformFeeAmount: 200, stylistCompensationAmount: 200,
                       penaltyAmount: 0, couponEligible: false });
  });
});

describe('computeSettlement — DISPUTE', () => {
  it('splits the retained amount by the platform fee percentage', () => {
    expect(computeSettlement({ price: P, event: 'DISPUTE', actor: 'admin',
                               refundPercentage: 25, platformFeePercentage: 15 }))
      .toMatchObject({ tier: 'DISPUTE_ARBITRATION', refundPercentage: 25, refundAmount: 250,
                       stylistCompensationAmount: 637.5, platformFeeAmount: 112.5,
                       penaltyAmount: 0, couponEligible: false });
  });

  it('a 100% arbitration refund leaves the stylist nothing', () => {
    expect(computeSettlement({ price: P, event: 'DISPUTE', actor: 'admin',
                               refundPercentage: 100, platformFeePercentage: 15 }))
      .toMatchObject({ refundAmount: 1000, stylistCompensationAmount: 0, platformFeeAmount: 0 });
  });
});

describe('the settlement identity holds for every branch', () => {
  const cases = [
    { price: 333.33, event: 'CANCELLATION', actor: 'client', hoursUntilSession: 30 },
    { price: 333.33, event: 'CANCELLATION', actor: 'client', hoursUntilSession: 1 },
    { price: 777.77, event: 'CANCELLATION', actor: 'stylist', hoursUntilSession: 1 },
    { price: 100.01, event: 'NO_SHOW', actor: 'client' },
    { price: 100.01, event: 'NO_SHOW', actor: 'stylist' },
    { price: 999.99, event: 'DISPUTE', actor: 'admin', refundPercentage: 37, platformFeePercentage: 15 },
  ];

  it.each(cases)('refund + stylist + platform === price (within 1 piastre) for %o', (input) => {
    const s = computeSettlement(input);
    const total = s.refundAmount + s.stylistCompensationAmount + s.platformFeeAmount;
    expect(Math.abs(total - input.price)).toBeLessThanOrEqual(0.01);
  });

  it.each(cases)('never returns a negative component for %o', (input) => {
    const s = computeSettlement(input);
    expect(s.refundAmount).toBeGreaterThanOrEqual(0);
    expect(s.stylistCompensationAmount).toBeGreaterThanOrEqual(0);
    expect(s.platformFeeAmount).toBeGreaterThanOrEqual(0);
    expect(s.penaltyAmount).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest tests/unit/settlement.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/common/settlement.js`:

```js
import { CANCELLATION_POLICY, NO_SHOW_POLICY } from './constants/statuses.constant.js';

/** The repository's single money-rounding rule. Mirrors payment.service.js round2. */
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * The one settlement calculation for every event that ends a booking with money moving.
 *
 * PURE. No I/O, no clock, no database. Consolidates three sites that computed the same
 * identity independently (cancellation's four-branch matrix, resolveNoShow's stylist share,
 * resolveDispute's retained-amount split) -- see the plan §D.5 BK3. Every percentage below
 * is read from CANCELLATION_POLICY / NO_SHOW_POLICY; NOTHING is hardcoded here, so the
 * constants file remains the single source of truth for the business rules and this file is
 * only the arithmetic.
 *
 * The returned shape is identical to the object calculateCancellationOutcome already
 * returned, so getCancellationQuote's API response does not change.
 *
 * Invariant, asserted in tests for every branch:
 *   refundAmount + stylistCompensationAmount + platformFeeAmount === price (±1 piastre)
 * `penaltyAmount` is OUTSIDE that identity on purpose: a stylist penalty is a debt accrued
 * against a future payout, not a share of this booking's price.
 *
 * @param {Object}  input
 * @param {number}  input.price
 * @param {'CANCELLATION'|'NO_SHOW'|'DISPUTE'} input.event
 * @param {'client'|'stylist'|'admin'} input.actor
 *        CANCELLATION: who cancelled ('admin' is priced on the client branch -- an admin
 *        cancellation is no-fault and must never assess a penalty against a stylist).
 *        NO_SHOW: who was reported AGAINST.
 *        DISPUTE: always 'admin'.
 * @param {number} [input.hoursUntilSession]     CANCELLATION only
 * @param {number} [input.refundPercentage]      DISPUTE only, 0-100
 * @param {number} [input.platformFeePercentage] DISPUTE only
 * @returns {{tier: string, refundPercentage: number, refundAmount: number,
 *            platformFeeAmount: number, stylistCompensationAmount: number,
 *            penaltyAmount: number, couponEligible: boolean,
 *            hoursUntilSession: number|null, isEarly: boolean|null}}
 */
export const computeSettlement = ({
  price,
  event,
  actor,
  hoursUntilSession = null,
  refundPercentage = 0,
  platformFeePercentage = 15,
}) => {
  const p = Number(price) || 0;

  if (event === 'NO_SHOW') {
    const policy = actor === 'stylist' ? NO_SHOW_POLICY.STYLIST : NO_SHOW_POLICY.CLIENT;
    const refundAmount = round2(p * (policy.CLIENT_REFUND_PERCENTAGE / 100));
    // Residual technique: mirrors payment.service.js:414-416 exactly (retained = round2(p - refundAmount),
    // Math.min clamp on stylist compensation, platformFeeAmount as retained - stylistCompensationAmount).
    // Guarantees exact zero-drift conservation (refund + stylist + platform === price) on fractional
    // prices like 333.33 and 777.77.
    const retained = round2(Math.max(0, p - refundAmount));
    const stylistCompensationAmount = Math.min(
      round2(p * (policy.STYLIST_PERCENTAGE / 100)),
      retained
    );
    const platformFeeAmount = round2(Math.max(0, retained - stylistCompensationAmount));
    return {
      tier: actor === 'stylist' ? 'NO_SHOW_STYLIST' : 'NO_SHOW_CLIENT',
      refundPercentage: policy.CLIENT_REFUND_PERCENTAGE,
      refundAmount,
      platformFeeAmount,
      stylistCompensationAmount,
      penaltyAmount: round2(p * (policy.STYLIST_PENALTY_PERCENTAGE / 100)),
      couponEligible: policy.ISSUES_COUPON,
      hoursUntilSession: null,
      isEarly: null,
    };
  }

  if (event === 'DISPUTE') {
    // Arbitration prices the refund directly; whatever is retained still splits on the
    // normal fee percentage, so arbitration never silently zeroes a stylist's earnings on
    // the portion the admin decided they keep (MONEY_AND_LEDGER.md §4.2).
    const pct = Math.max(0, Math.min(100, Number(refundPercentage) || 0));
    const refundAmount = round2((p * pct) / 100);
    const retained = round2(Math.max(0, p - refundAmount));
    const stylistCompensationAmount = round2(retained * (1 - platformFeePercentage / 100));
    return {
      tier: 'DISPUTE_ARBITRATION',
      refundPercentage: pct,
      refundAmount,
      platformFeeAmount: round2(Math.max(0, retained - stylistCompensationAmount)),
      stylistCompensationAmount,
      penaltyAmount: 0,
      couponEligible: false,
      hoursUntilSession: null,
      isEarly: null,
    };
  }

  // CANCELLATION. Boundary: exactly 24h00m is CLIENT-FAVOURABLE (>= EARLY_HOURS).
  const isEarly = Number(hoursUntilSession) >= CANCELLATION_POLICY.EARLY_HOURS;

  // 'admin' is deliberately priced on the client branch: an admin cancellation is neither
  // party's fault, and getCancellationQuote already quotes it that way. Pricing it on the
  // stylist branch would assess a penalty debt against an innocent stylist and make the
  // quote disagree with what actually happens.
  if (actor === 'client' || actor === 'admin') {
    const refundPct = isEarly
      ? CANCELLATION_POLICY.EARLY_CLIENT_REFUND_PERCENTAGE
      : CANCELLATION_POLICY.LATE_CLIENT_REFUND_PERCENTAGE;
    const platformPct = isEarly
      ? CANCELLATION_POLICY.EARLY_PLATFORM_FEE_PERCENTAGE
      : CANCELLATION_POLICY.LATE_PLATFORM_FEE_PERCENTAGE;
    return {
      tier: isEarly ? 'EARLY_CLIENT_CANCEL' : 'LATE_CLIENT_CANCEL',
      refundPercentage: refundPct,
      refundAmount: round2(p * (refundPct / 100)),
      platformFeeAmount: round2(p * (platformPct / 100)),
      // The stylist receives NOTHING on a client cancellation -- a stylist who has not
      // travelled has not incurred the loss the no-show policy compensates.
      stylistCompensationAmount: 0,
      penaltyAmount: 0,
      couponEligible: false,
      hoursUntilSession: Number(hoursUntilSession),
      isEarly,
    };
  }

  // Stylist cancelled: the client is always made whole and never bears the cost. The
  // stylist accrues a penalty debt instead, settled against a future payout.
  const penaltyPct = isEarly
    ? CANCELLATION_POLICY.EARLY_STYLIST_PENALTY_PERCENTAGE
    : CANCELLATION_POLICY.LATE_STYLIST_PENALTY_PERCENTAGE;
  return {
    tier: isEarly ? 'EARLY_STYLIST_CANCEL' : 'LATE_STYLIST_CANCEL',
    refundPercentage: 100,
    refundAmount: round2(p),
    platformFeeAmount: 0,
    stylistCompensationAmount: 0,
    penaltyAmount: round2(p * (penaltyPct / 100)),
    couponEligible: !isEarly,
    hoursUntilSession: Number(hoursUntilSession),
    isEarly,
  };
};

export default computeSettlement;
```

- [ ] **Step 4: Run the table test — expect PASS**

Run: `npx jest tests/unit/settlement.test.js` → PASS

- [ ] **Step 5: Write the differential test — the gate for all of S2/S3**

This is the evidence that "same business rules" is true rather than asserted. It runs the
**old** function and the **new** one over a large input grid and requires equality. It must
be written and green **before** `calculateCancellationOutcome` is touched, and it is deleted
only in S7, after the old function is removed.

`tests/unit/settlement.differential.test.js`:

```js
import { calculateCancellationOutcome } from '../../src/modules/bookings/booking.service.js';
import { computeSettlement } from '../../src/common/settlement.js';

const PRICES = [100, 100.01, 250.5, 333.33, 777.77, 1000, 4999.99];
const HOURS  = [0, 0.5, 1, 12, 23.99, 24, 24.01, 48, 720];
const ROLES  = ['client', 'stylist', 'admin'];

describe('computeSettlement reproduces calculateCancellationOutcome exactly', () => {
  for (const price of PRICES) {
    for (const hours of HOURS) {
      for (const role of ROLES) {
        it(`price=${price} hours=${hours} role=${role}`, () => {
          const scheduled = new Date(Date.now() + hours * 3600 * 1000);
          const booking = { price, scheduledDate: scheduled, scheduledStartMinute: 0 };
          // calculateCancellationOutcome prices 'admin' on the client branch at its call
          // sites, so the differential compares like with like.
          const legacyRole = role === 'admin' ? 'client' : role;
          const legacy = calculateCancellationOutcome(booking, legacyRole, new Date());
          const next = computeSettlement({
            price, event: 'CANCELLATION', actor: role,
            hoursUntilSession: legacy.hoursUntilSession,
          });

          expect(next.tier).toBe(legacy.tier);
          expect(next.refundPercentage).toBe(legacy.refundPercentage);
          expect(next.refundAmount).toBeCloseTo(legacy.refundAmount, 2);
          expect(next.platformFeeAmount).toBeCloseTo(legacy.platformFeeAmount, 2);
          expect(next.stylistCompensationAmount).toBeCloseTo(legacy.stylistCompensationAmount, 2);
          expect(next.penaltyAmount).toBeCloseTo(legacy.penaltyAmount, 2);
          expect(next.couponEligible).toBe(legacy.couponEligible);
          expect(next.isEarly).toBe(legacy.isEarly);
        });
      }
    }
  }
});

describe('computeSettlement reproduces the no-show arithmetic in resolveNoShow', () => {
  // no-show.service.js:243 computes the stylist share as
  //   round2(payment.amount * (policy.STYLIST_PERCENTAGE / 100))
  it.each([[100.01], [333.33], [1000]])('price %p', (price) => {
    expect(computeSettlement({ price, event: 'NO_SHOW', actor: 'client' }).stylistCompensationAmount)
      .toBeCloseTo(Math.round(price * 0.20 * 100) / 100, 2);
    expect(computeSettlement({ price, event: 'NO_SHOW', actor: 'stylist' }).stylistCompensationAmount)
      .toBe(0);
  });
});

describe('computeSettlement reproduces the dispute split in resolveDispute', () => {
  // booking.service.js:485-491
  it.each([[1000, 25, 15], [777.77, 50, 15], [333.33, 99, 20]])(
    'price %p refund %p%% fee %p%%', (amount, pct, feePct) => {
      const retained = Math.round(amount * (1 - pct / 100) * 100) / 100;
      const expected = Math.round(retained * (1 - feePct / 100) * 100) / 100;
      expect(computeSettlement({
        price: amount, event: 'DISPUTE', actor: 'admin',
        refundPercentage: pct, platformFeePercentage: feePct,
      }).stylistCompensationAmount).toBeCloseTo(expected, 2);
    });
});
```

- [ ] **Step 6: Run the differential test**

Run: `npx jest tests/unit/settlement.differential.test.js`
Expected: **PASS.** If any case fails, `computeSettlement` is wrong — fix it, do **not** relax
the assertion and do **not** proceed to S2.

> `calculateCancellationOutcome` must be exported from `booking.service.js` for this import.
> Verify with `grep -n "export const calculateCancellationOutcome" src/modules/bookings/booking.service.js`
> and add the `export` keyword (no other change) if it is missing.

- [ ] **Step 7: Run the full suite and commit**

Run: `npm run verify` → green.

```bash
git add src/common/settlement.js tests/unit/settlement.test.js tests/unit/settlement.differential.test.js
git commit -m "feat(common): add pure computeSettlement with a differential proof

Reproduces calculateCancellationOutcome across 189 price/hours/role combinations,
resolveNoShow's stylist share, and resolveDispute's retained split. No call sites yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Phase S1 summary.**
**Dependencies:** S0 Step 1 (green baseline) only. **Business behaviour impact:** **none** — nothing calls the
new code. **Database impact:** none. **Migration strategy:** none.
**Tests:** 4 new unit suites + 1 integration suite; all 696 existing tests unchanged and green.
**Rollback:** `git revert` the four commits; no other file references them.
**Acceptance criteria:** `npm run verify` green · `settlement.differential.test.js` green ·
`grep -rn "settlement.js\|booking.transitions\|assertParticipant\|transaction.util" src/` returns
only the new files themselves plus `booking.repository.js`'s import.
**Risk: VERY LOW.**

---

### Phase S2 — Booking lifecycle consolidation

**Objective.** Every booking-status write goes through `transitionStatus`; every
participant check goes through `assertBookingParticipant`; `cancelBooking` gets one signature.

**Exact scope.** The nine writers in §D.5 BK1 and the ~20 ownership checks in §D.5 BK2.
**No settlement arithmetic changes in this phase** — that is S3. **No new states.**

**Affected files.** `src/modules/bookings/booking.service.js` ·
`src/modules/bookings/no-show.service.js` · `src/modules/bookings/booking.controller.js`
(the `cancelBooking` call site) · `src/modules/admin/admin.service.js` (if it calls
`cancelBooking`; verify with `grep -rn "cancelBooking" src/`) ·
`tests/unit/system-coherence.test.js` (the `:114` source assertion).

**Exact logic changes — the migration recipe.** Apply this identically to each writer:

```js
// BEFORE (the five precondition-free writers)
const booking = await bookingRepository.findById(bookingId);
if (!booking) throw new ApiError(404, 'Booking not found');
const userIdStr = (user._id || user.id).toString();
const clientIdStr = (booking.clientId._id || booking.clientId).toString();
const stylistIdStr = (booking.stylistId._id || booking.stylistId).toString();
if (userIdStr !== clientIdStr && userIdStr !== stylistIdStr) throw new ApiError(403, 'Forbidden');
if (booking.status !== 'confirmed' && booking.status !== 'in-progress') {
  throw new ApiError(400, `Cannot check-in to a booking in '${booking.status}' status`);
}
/* … business preconditions that are NOT about status … */
const updated = await bookingRepository.updateById(bookingId, updateData);

// AFTER
const booking = await bookingRepository.findById(bookingId);
if (!booking) throw new ApiError(404, 'Booking not found');
const { userId, clientId } = assertBookingParticipant(user, booking, { allowAdmin: false });
if (booking.status !== 'confirmed' && booking.status !== 'in-progress') {
  throw new ApiError(400, `Cannot check-in to a booking in '${booking.status}' status`);
}
/* … business preconditions that are NOT about status … unchanged … */
const updated = await bookingRepository.transitionStatus(
  bookingId, ['confirmed', 'in-progress'], updateData
);
if (!updated) {
  // The booking moved on between the read and this write -- a genuine race, surfaced
  // rather than silently no-op'd. Same 400 the pre-read guard above returns.
  throw new ApiError(400, 'Cannot check-in: this booking is no longer in a check-in-able status');
}
```

Three rules that make this mechanical and safe:

1. **Keep the pre-read status guard.** It produces the specific, user-facing message
   (`Cannot check-in to a booking in 'cancelled' status`). The CAS is the race backstop, not
   the primary message. Deleting the pre-read guard would change API error text.
2. **`fromStates` is exactly the set the pre-read guard admits.** Never widen it. Never
   compute it from `legalFromStatesFor` — that would permit statuses this particular writer
   never permitted. `legalFromStatesFor` exists for tests and for the developer assertion.
3. **`allowAdmin` preserves the call site's current behaviour**, per §D.5 BK2. Do not
   normalise it — and **pass it explicitly at every one of the ~20 sites, including the ones
   that want `false`.** The helper fails closed (§S1.2), so an omission is safe rather than a
   bypass, but an explicit value is what makes the policy greppable, which is the point.
   Enforce it in `system-coherence.test.js`:

```js
it('every participant check states its admin policy explicitly', () => {
  for (const f of glob('src/modules/**/*.service.js')) {
    const txt = fs.readFileSync(f, 'utf8');
    // Multiline-safe regex matching call sites across arbitrary line breaks without truncating on nested parens
    const calls = txt.match(/assertBookingParticipant\s*\([\s\S]*?\)/g) || [];
    for (const c of calls) {
      expect(c).toMatch(/allowAdmin:\s*(true|false)/);
    }
  }
});
```

   The six sites that currently admit admins — `getById` (`booking.service.js:190`),
   `fileDispute` (`:310`), `addDisputeEvidence` (`:395`), `getDisputeDetails` (`:424`),
   `getCancellationQuote` (`:655`), `cancelBooking` (`:691`) — pass `{ allowAdmin: true }`.
   Every other site passes `{ allowAdmin: false }`.

**Per-writer table.** One commit each, in this order (least → most financially sensitive):

| # | Function | `fromStates` | `allowAdmin` | Null-CAS response |
|---|---|---|---|---|
| 1 | `addDisputeEvidence` (`booking.service.js:409`) | `['disputed']` | `true` | 400 "booking is not in disputed status" |
| 2 | `checkIn` (`:230`) | `['confirmed','in-progress']` | **`false`** | 400 (text above) |
| 3 | `fileDispute` (`:347`) | `['completed','in-progress']` | `true` | 409 "booking is no longer disputable" |
| 4 | `respondToNoShow` contest (`no-show.service.js:132`) | `['confirmed','in-progress']` | `false` (only the accused may respond) | 409 "this booking is no longer contestable" |
| 5 | `adminResolveNoShow` dismissal (`no-show.service.js:391`) | `['disputed']` | admin-only route, unchanged | 409 "already resolved" |
| 6 | `respondToNoShow` accept-stamp (`no-show.service.js:165`) | `['confirmed','in-progress']` | `false` | 409 |
| 7 | `fileNoShow` details write (`no-show.service.js:87`) | `['confirmed','in-progress']` | `false` | 400 |
| 8 | `resolveDispute` (`booking.service.js:501`) | `['disputed']` | admin-only, unchanged | 409 "no longer disputed" |
| 9 | `cancelBooking` (`booking.service.js:759`) | `['confirmed']` | `true` | 409 "booking is no longer cancellable" |

Writers 2, 3 and 8 in the §D.5 BK1 table (`setCompletionConfirmation`, `promoteToCompleted`,
`settleNoShow`) are **already CAS and are DO-NOT-TOUCH**. They stay as they are; the new
primitive does not replace them.

Notes on specific writers:

- **#7 and #6 do not change `status`.** They write `noShowDetails` sub-fields only. Use
  `transitionStatus` anyway with no `status` in the patch — the legality assertion skips
  when `patch.status` is absent, and the `fromStates` filter still prevents stamping a
  no-show report onto a booking that has since completed.
- **#9 `cancelBooking`** additionally loses its polymorphic signature (BK6). Change to
  `cancelBooking(user, bookingId, cancelData = {})` and update **every** caller found by
  `grep -rn "cancelBooking" src/ tests/`. The in-transaction re-read at `:735-748` is
  replaced by the CAS inside the same transaction; keep the transaction (it covers the
  `ScheduleBlock` delete and the `Penalty` create), and switch it to `withTransaction` in S4,
  not here — one change per commit.
- **`resolveDispute` keeps its `completedAt` preservation logic verbatim** (the X7 fix:
  `...(targetStatus === 'completed' && !booking.completedAt ? { completedAt: new Date() } : {})`).

- [ ] **Step 1 (per writer): Write the failing illegal-transition test**

For writer N, add to the matching existing suite (`tests/unit/dispute.resolution.test.js`,
`tests/unit/no-show.service.test.js`, `tests/integration/bookings-scheduling.test.js`, …):

```js
it('refuses to check in a booking that was cancelled after the read', async () => {
  const booking = await Booking.create({ /* …fixture…, status: 'confirmed' */ });
  // Simulate the race: the status changes between the service's read and its write.
  jest.spyOn(bookingRepository, 'findById').mockImplementation(async (id) => {
    const doc = await Booking.findById(id).populate(['clientId', 'stylistId']);
    await Booking.updateOne({ _id: id }, { $set: { status: 'cancelled' } }); // the racer
    return doc;                                                              // stale read
  });

  await expect(bookingService.checkIn(clientUser, booking._id, {}))
    .rejects.toThrow(/no longer/i);

  const fresh = await Booking.findById(booking._id);
  expect(fresh.status).toBe('cancelled');   // the loser did not overwrite
  bookingRepository.findById.mockRestore();
});
```

- [ ] **Step 2: Run it and confirm it fails against the current code**

Run: `npx jest <that file> -t "cancelled after the read"`
Expected: **FAIL** — today `updateById` has no precondition, so the status is overwritten to
`in-progress` and `fresh.status` is `'in-progress'`. *This failing test is the evidence the
consolidation is worth doing; record its output in the commit body.*

- [ ] **Step 3: Migrate that one writer** using the recipe above.

- [ ] **Step 4: Run the targeted test, then the whole booking surface**

Run: `npx jest tests/unit/dispute.resolution.test.js tests/unit/dispute.arbitration.test.js tests/unit/no-show.service.test.js tests/unit/no-show.admin-resolve.test.js tests/unit/cancellation.service.test.js tests/integration/bookings-scheduling.test.js tests/integration/booking.completion-race.test.js tests/integration/booking.broadcast-race.test.js tests/integration/no-show-refund.test.js tests/integration/dispute-evidence.test.js`
Expected: all PASS, **unchanged** — no existing assertion may be edited to accommodate the
refactor. If one needs editing, the refactor changed behaviour; stop and re-read the recipe.

- [ ] **Step 5: Commit that writer alone**

```bash
git add -p   # only this writer's hunks
git commit -m "refactor(bookings): route checkIn through transitionStatus CAS

Closes the read-then-write window that allowed a cancelled booking to be
resurrected to 'in-progress'. No business rule, status or API response changed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Repeat Steps 1–5 for writers 2 … 9.** Never batch two writers.

- [ ] **Step 7: Migrate the ~20 ownership checks**

One commit per file. Mechanical: replace each three-line comparison block with
`assertBookingParticipant(user, booking, { allowAdmin: <the site's current behaviour> })`.
Verify afterwards using the multiline-safe AST/regex check (ensures Prettier line wrapping never hides call sites):

```bash
# 1. Verify no legacy role checks remain in service files
grep -rn "role === 'admin'" src/modules/ --include=*.js | grep -v swagger   # must return 0
grep -rnc "userIdStr !== clientIdStr" src/modules/bookings/                 # must return 0

# 2. Multiline AST/regex verification ensuring all participant checks explicitly declare allowAdmin
node -e "
  const fs = require('fs');
  const files = [
    'src/modules/bookings/booking.service.js',
    'src/modules/bookings/no-show.service.js'
  ];
  let totalCalls = 0;
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    const matches = code.match(/assertBookingParticipant\s*\([\s\S]*?\)/g) || [];
    for (const call of matches) {
      totalCalls++;
      if (!/allowAdmin:\s*(true|false)/.test(call)) {
        console.error('ERROR: Call site missing explicit allowAdmin in ' + file + ':\n' + call);
        process.exit(1);
      }
    }
  }
  console.log('Verified ' + totalCalls + ' participant check call sites across services; all pass allowAdmin explicitly.');
"
```

- [ ] **Step 8: Update `system-coherence.test.js` deliberately**

`:114` greps `booking.service.js` for `BOOKING_TERMINAL_STATUSES`. That constant is still
used by `cancelBooking`'s pre-read guard, so the assertion should still pass — **confirm, do
not assume.** Add a new assertion in the same suite:

```js
it('no booking status is written outside the repository', () => {
  const files = ['src/modules/bookings/booking.service.js', 'src/modules/bookings/no-show.service.js'];
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    // updateById may still be used for non-status patches; a `status:` inside one is the bug.
    const statusInUpdateById = /updateById\([^)]*\{[^}]*\bstatus\s*:/s.test(txt);
    expect(statusInUpdateById).toBe(false);
  }
});
```

- [ ] **Step 9: Full verification**

Run: `npm run verify` → green, 137/137, 696+ tests.

**Phase S2 summary.**
**Dependencies:** S1 merged.
**Business behaviour impact:** **none intended.** The only observable difference is that a
genuine concurrent race now returns a clean 400/409 instead of silently overwriting or
returning 500. No status, percentage, timestamp, permission or response field changes.
**Database impact:** **No migration.**
**API impact:** **No API change.**
**Migration strategy:** n/a.
**Tests:** every existing booking/no-show/dispute/cancellation suite green **unchanged**, plus
nine new illegal-transition tests each proving a failure against the pre-consolidation code.
**Rollback:** per-commit `git revert`; commits are independent because each writer is separate
and the primitive from S1 stays in place.
**Acceptance criteria:** the nine guard implementations are gone · the two greps in Step 7
return 0 · `system-coherence.test.js`'s new assertion green · `npm run verify` green.
**Risk: MEDIUM** — this is the money path. Mitigated by one writer per commit, no rule
changes, and an existing 696-test suite that must pass verbatim.

---

### Phase S3 — No-show and settlement correctness

**Objective.** Make `resolveNoShow` atomic where it must be; adopt `computeSettlement` at all
three sites; close the four no-show defects (NS1, NS2, NS4/S-1, BK8/S-2) and issue the missing
cancellation coupon (BK5/S-3).

**Exact scope.** `resolveNoShow` ordering + transaction · `computeSettlement` adoption ·
`payoutStatus: 'not_owed'` · per-party check-in · late-stylist-cancellation coupon.
**No no-show business rule, gate, window or percentage changes.**

**Affected files.** `src/modules/bookings/no-show.service.js` ·
`src/modules/bookings/booking.service.js` · `src/modules/bookings/booking.model.js` ·
`src/common/constants/statuses.constant.js` (add `PAYOUT_STATUS.NOT_OWED`) ·
`src/modules/payments/payment.service.js` (the `payoutStatus !== 'unpaid'` guard — **verify
only, do not change**) · `src/modules/bookings/booking.repository.js`
(`PAYOUT_ELIGIBILITY` — **verify only**) · `scripts/migrate-s3-payout-status.js` (new) ·
`scripts/migrate-s3-checkin.js` (new).

#### Task S3.1 — Adopt `computeSettlement` at the three sites

**Analysis.** *Current behaviour:* three independent arithmetic sites. *Current complexity:*
see §D.5 BK3. *Root cause:* cancellation was pure first; the other two inlined "the same thing
with different numbers". *Proposed target:* `calculateCancellationOutcome` becomes a
one-line wrapper over `computeSettlement`; `resolveNoShow` and `resolveDispute` call it
directly. *Business-rule preservation:* **proven by `settlement.differential.test.js`,
which is green before this task starts and must stay green after.** *Security impact:* none.
*Financial impact:* **zero**, by the differential proof. *Concurrency impact:* none (pure).
*Data impact:* **No migration.** *API impact:* **No API change** — `getCancellationQuote`
returns the same shape. *Test impact:* `cancellation.service.test.js`,
`no-show.policy.test.js`, `dispute.resolution.test.js` all green unchanged. *Rollback:* revert;
`computeSettlement` remains unused but harmless. *Risk:* **LOW.**

- [ ] **Step 1:** Confirm the gate is green before touching anything.
  Run: `npx jest tests/unit/settlement.differential.test.js` → PASS. If not, stop.

- [ ] **Step 2:** In `booking.service.js`, make `calculateCancellationOutcome` a wrapper:

```js
import { computeSettlement } from '../../common/settlement.js';

/**
 * Cancellation pricing. The four-branch matrix now lives in ONE place
 * (src/common/settlement.js) shared with the no-show and dispute paths -- see the plan
 * §D.5 BK3. This wrapper survives because it owns the hours-until-session derivation from
 * the booking document, which is booking-specific and not settlement arithmetic.
 */
export const calculateCancellationOutcome = (booking, cancelledByRole, now = new Date()) => {
  const appointment = getAppointmentDateTime(booking);
  const hoursUntilSession = (appointment.getTime() - now.getTime()) / (1000 * 60 * 60);
  return computeSettlement({
    price: booking.price || 0,
    event: 'CANCELLATION',
    actor: cancelledByRole,
    hoursUntilSession,
  });
};
```

  Delete the four inline branches. **Do not change `getAppointmentDateTime`.**

- [ ] **Step 3:** Run `npx jest tests/unit/cancellation.service.test.js tests/unit/settlement.differential.test.js tests/integration/cancellation-ledger.test.js` → PASS unchanged. Commit.

- [ ] **Step 4:** In `no-show.service.js`, replace the inline stylist share at `:243`:

```js
const settlement = computeSettlement({ price, event: 'NO_SHOW', actor: against });
// …
stylistPayoutOverrideAmount: settlement.stylistCompensationAmount,
```

  and replace the inline penalty at `:265`:

```js
const penaltyAmount = settlement.penaltyAmount;
```

  **Keep `policy` for `CLIENT_REFUND_PERCENTAGE`, `ISSUES_COUPON` and the event payload** —
  those are policy lookups, not arithmetic. Run
  `npx jest tests/unit/no-show.policy.test.js tests/unit/no-show.service.test.js tests/integration/no-show-refund.test.js` → PASS unchanged. Commit.

- [ ] **Step 5:** In `booking.service.js` `resolveDispute`, replace `:485-491`:

```js
const settlement = computeSettlement({
  price: payment.amount,
  event: 'DISPUTE',
  actor: 'admin',
  refundPercentage: finalRefundPercentage,
  platformFeePercentage: payment.platformFeePercentage || env.PLATFORM_FEE_PERCENTAGE || 15,
});
stylistPayoutOverrideAmount = settlement.stylistCompensationAmount;
```

  Run `npx jest tests/unit/dispute.resolution.test.js tests/unit/dispute.arbitration.test.js` → PASS unchanged. Commit.

#### Task S3.2 — `resolveNoShow`: correct ordering + one transaction

**Analysis.** *Current behaviour:* eight writes, no transaction, five swallowed errors, with
the schedule delete before the CAS (§D.8). *Current complexity:* the function is idempotent by
key but **nothing retries**, so a mid-flight failure leaves a durable half-settlement.
*Root cause:* written incrementally; each new consequence was appended after the previous one
rather than folded into a unit of work. *Proposed target:* schedule delete moves **after** a
successful claim; steps 2/4/5/6 run inside one `withTransaction`; steps 7/8 stay outside but
write a durable failure record instead of only `logger.error`. *Business-rule preservation:*
the 30-minute grace, the 2-hour window, the check-in gate, the contest path, admin arbitration,
100/0/0+10%+coupon vs 60/20/20+0+none, `REPORTABLE_STATUSES` and both no-show statuses are
**all unchanged**. *Security impact:* none. *Financial impact:* strictly positive — a refund
failure can no longer be followed by a settled `payoutStatus` write. *Concurrency impact:* the
existing `settleNoShow` CAS is preserved and now runs inside the transaction, so the money
writes either all land or none do. *Data impact:* **No migration for this task.** *API impact:*
**No API change.** *Test impact:* new partial-failure rollback tests. *Rollback:* revert the
commit. *Risk:* **MEDIUM.**

**The one hard constraint.** `processRefund` calls an **external payment provider**. A
provider call must not sit inside a MongoDB transaction — a slow provider holds the
transaction open and a transaction abort cannot un-refund money. Therefore:

```text
OUTSIDE txn, step A : CAS-claim status -> no-show-*            (settleNoShow, unchanged)
OUTSIDE txn, step B : processRefund(...)                       (with idempotency guard)
                      - Re-read Payment: if already REFUNDED/PARTIALLY_REFUNDED -> SKIP provider call
                      - Pass idempotencyKey: `refund-noshow-${bookingId}`
                      - on failure -> STOP. Do not write payoutStatus. Record and return.
INSIDE  txn, step C : payoutStatus write + Penalty create + ledger postDoubleEntry(session)
AFTER   txn, step D : schedule delete, coupon, reliability, chat lock  (post-hoc, idempotent)
FINALLY,     step E : stamp noShowDetails.settlementCompletedAt   <-- the resume marker
```

The refund is already crash-safe on its own (`REFUNDING` is claimed before the provider and
reverted on failure — X17), and everything after it is pure database work that can be atomic.
**But crash-safe is not the same as complete** — see the next sub-task, which is mandatory.

#### Task S3.2a — `resolveNoShow` must be RESUMABLE, not merely atomic (**required**)

**This is the correction that makes S3.2 safe.** Without it, the A–E decomposition above
trades a partial-failure surface for a *silent permanent* one.

**Verified crash window.** Steps A and B commit independently of step C. If the process dies
between B and C — provider refunded, `Payment.status = 'refunded'`, refund ledger entries
written — then:

| Evidence | Verified at | Consequence |
|---|---|---|
| `resolveNoShow` early-returns the DTO when `status` is already `no-show-*` | `no-show.service.js:184-190` | **A re-invocation does not resume. It reports success.** |
| `findPendingNoShowReports` filters `status: {$in:['confirmed','in-progress']}` **and** `noShowDetails.confirmedAt: null` | `booking.repository.js:242-249` | Step A set both fields, so **the 15-minute sweep never sees this booking again** |
| No `REFUNDING`/settlement recovery sweep exists anywhere | `grep -rn "REFUNDING\|refunding" src/` → only the enum declaration and `processRefund`'s own usage | **Nothing retries, ever** |
| Debits still equal credits (neither half of the penalty pair was written) | `ledger-reconciliation.cron.js:51-73` | **The nightly integrity job does not alert** |

Durable damage: the stylist penalty is never assessed (revenue the platform is owed,
permanently lost), the compensation coupon is never issued (a user-facing promise silently
broken), `payoutStatus` is never corrected, and the `ScheduleBlock` is never deleted (the
stylist's slot stays blocked forever). **Every one of these is invisible to every existing
alarm.** Note this window exists in the code *today*; S3.2's restructure does not introduce
it, but it must not leave it.

**Smallest safe mechanism — one field, one guard change, one extra pass in an existing cron.
No queue, no DLQ, no new job, no new infrastructure.**

*Why a whole-function resume is safe:* every step is already idempotent, verified —
`scheduleRepository.deleteByBookingId` is `deleteMany` (`schedule.repository.js:4-7`);
`Penalty` has a unique `{bookingId, reasonType}` and the E11000 tolerance is preserved;
every ledger write carries a deterministic `idempotencyKey`; `Coupon` has a partial-unique
`{sourceBookingId, issuedReason}` (`coupon.model.js:69-72`); `lockConversation` sets
`isLocked: true` (`chat.service.js:64-67`); `updateStylistReliability` is an absolute
recompute, not an `$inc`.

- [ ] **Explicit Schema Update in `booking.model.js`:**
  Add the new recovery and tracking fields under `noShowDetails`. Mongoose enforces strict
  schema filtering by default; declaring them explicitly guarantees they are not silently stripped:

```diff
// src/modules/bookings/booking.model.js
     noShowDetails: {
       reportedBy: { type: Schema.Types.ObjectId, ref: 'User' },
       reportedAt: Date,
       reportedAgainst: { type: String, enum: ['client', 'stylist'] },
       respondedAt: Date,
       response: String,
       confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
       confirmedAt: Date,
       evidence: [{ type: String, trim: true }],
       contestedFromStatus: { type: String, enum: ['confirmed', 'in-progress'] },
+      settlementCompletedAt: Date,
+      settlementAttempts: { type: Number, default: 0 },
+      isResuming: { type: Boolean, default: false },
+      resumedAt: Date,
+      settlementExhausted: { type: Boolean, default: false },
+      settlementExhaustedAt: Date,
+      settlementExhaustedReason: String,
+      postSettlementErrors: [{
+        step: String,
+        message: String,
+        at: { type: Date, default: Date.now },
+      }],
     },
```

  And add the supporting indexes:
```js
bookingSchema.index({ status: 1, 'noShowDetails.settlementCompletedAt': 1, 'noShowDetails.settlementAttempts': 1, 'noShowDetails.isResuming': 1 });
bookingSchema.index({ 'noShowDetails.settlementExhausted': 1 }, { sparse: true });
```

- [ ] **Change the early-return guard** at `no-show.service.js:184-190` from "already in a
  terminal no-show status" to "already in a terminal no-show status **and**
  `settlementCompletedAt` is set". A terminal status with no marker means *resume*, not *done*.

- [ ] **Make step B resume-aware & propagate `idempotencyKey` down to providers.**
  Update `processRefund` and provider interfaces:

```diff
// src/modules/payments/payment.service.js
export const processRefund = async ({
  bookingId,
  refundPercentage = 100,
  reason = 'Admin Refund',
  stylistPayoutOverrideAmount = 0,
+ idempotencyKey = null,
} = {}) => {
  ...
  const provider = getProvider();
  let updated;
  try {
    if (payment.providerTransactionId && provider.refund) {
-     await provider.refund(payment.providerTransactionId, refundAmount);
+     await provider.refund(payment.providerTransactionId, refundAmount, { idempotencyKey });
    }
```

```diff
// src/modules/payments/providers/paymob.provider.js
- async refund(transactionId, amount) {
+ async refund(transactionId, amount, { idempotencyKey = null } = {}) {
    const amountInCents = Math.round(amount * 100);
    try {
      const authToken = await this.getAuthToken();
      const response = await fetch(`${this.baseUrl}/api/acceptance/void_refund/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
+         ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: JSON.stringify({
          auth_token: authToken,
          transaction_id: transactionId,
          amount_cents: amountInCents,
        }),
      });
```

```diff
// src/modules/payments/providers/mock.provider.js
- async refund(transactionId, amount) {
+ async refund(transactionId, amount, { idempotencyKey = null } = {}) {
    return {
      status: 'refunded',
      transactionId,
      amount,
      refundId: `mock_ref_${crypto.randomUUID()}`,
+     idempotencyKey,
    };
  }
```

  In `no-show.service.js`, step B checks status before calling `processRefund` and passes `idempotencyKey`:

```js
const payment = await paymentRepository.findByBookingId(bookingId);
if (payment?.status === PAYMENT_STATUS.REFUNDING) {
  // AMBIGUOUS: the provider may or may not have refunded. Auto-retrying could double-refund.
  // Stop, record, and escalate to a human. This is the one branch that must never guess.
  await recordSettlementError(bookingId, 'refund', 'Payment stuck in REFUNDING - manual reconciliation required');
  logger.error(`[No-show] Payment ${payment._id} stuck in REFUNDING; settlement halted for booking ${bookingId}`);
  throw new ApiError(409, 'Refund state is ambiguous; this settlement requires manual reconciliation.');
}
const alreadyRefunded =
  payment?.status === PAYMENT_STATUS.REFUNDED || payment?.status === PAYMENT_STATUS.PARTIALLY_REFUNDED;
if (payment && payment.status === PAYMENT_STATUS.PAID && policy.CLIENT_REFUND_PERCENTAGE > 0) {
  // Idempotency guard: pass deterministic key to provider to prevent duplicate external refunds on retry
  await paymentService.processRefund({
    bookingId,
    refundPercentage: policy.CLIENT_REFUND_PERCENTAGE,
    reason: reason || `No-show by ${against}`,
    stylistPayoutOverrideAmount: round2(payment.amount * (policy.STYLIST_PERCENTAGE / 100)),
    idempotencyKey: `refund-noshow-${bookingId}`,
  });
} else if (alreadyRefunded) {
  // A resume after the crash window: the refund already landed. Skip provider call and continue to C.
  logger.info(`[No-show] Payment ${payment._id} already refunded; skipping provider call on resume.`);
}
```

- [ ] **Failure Unwind & Lock Release:**
  If Step B or any subsequent step throws in `resolveNoShow`, ensure the `isResuming` claim lock is immediately
  released so the booking is not left locked:

```js
// src/modules/bookings/no-show.service.js (inside resolveNoShow)
try {
  // ... Step A, B, C, D, E ...
} catch (err) {
  // CRITICAL: Ensure cluster claim lock is released on error so retry is possible
  await bookingRepository.releaseSettlementResumeClaim(bookingId);
  throw err;
}
```

- [ ] **Add step E.** After D completes, stamp `settlementCompletedAt` and clear `isResuming`:
  `await Booking.updateOne({ _id: bookingId }, { $set: { 'noShowDetails.settlementCompletedAt': new Date() }, $unset: { 'noShowDetails.isResuming': 1 } });`
  Only then is the settlement finished.

- [ ] **Add a second pass to the EXISTING `no-show-resolution.cron.js` with Exhaustion Alerting:**
  New repository functions in `booking.repository.js`:

```js
// booking.repository.js — atomic claim for cluster-mode concurrency safety.
// Guarantees that multiple PM2/cluster workers cannot both sweep and process Step B concurrently.
export const claimSettlementResume = async (bookingId) =>
  Booking.findOneAndUpdate(
    {
      _id: bookingId,
      status: { $in: ['no-show-stylist', 'no-show-client'] },
      'noShowDetails.settlementCompletedAt': null,
      'noShowDetails.isResuming': { $ne: true },
      'noShowDetails.settlementExhausted': { $ne: true },
    },
    {
      $set: { 'noShowDetails.isResuming': true, 'noShowDetails.resumedAt': new Date() },
      $inc: { 'noShowDetails.settlementAttempts': 1 },
    },
    { returnDocument: 'after' }
  );

// Releases the resume claim lock on error so subsequent cron passes can retry (up to maxAttempts)
export const releaseSettlementResumeClaim = async (bookingId) =>
  Booking.updateOne(
    { _id: bookingId },
    { $unset: { 'noShowDetails.isResuming': 1 } }
  );

// Permanently flags exhausted bookings for admin dashboard / manual intervention
export const markSettlementExhausted = async (bookingId, errorReason) =>
  Booking.updateOne(
    { _id: bookingId },
    {
      $set: {
        'noShowDetails.settlementExhausted': true,
        'noShowDetails.settlementExhaustedAt': new Date(),
        'noShowDetails.settlementExhaustedReason': errorReason,
      },
      $unset: { 'noShowDetails.isResuming': 1 },
    }
  );

// Sibling of findPendingNoShowReports.
// A settlement that claimed the booking but never stamped its completion marker.
// Strictly state-driven query (settlementCompletedAt: null) without any temporal 'since' cutoff
// to prevent permanent orphan leaks during prolonged downtime or clock drift.
export const findUnfinishedNoShowSettlements = async (maxAttempts = 5, batchSize = 50) =>
  Booking.find({
    status: { $in: ['no-show-stylist', 'no-show-client'] },
    'noShowDetails.settlementCompletedAt': null,
    'noShowDetails.settlementAttempts': { $lt: maxAttempts },
    'noShowDetails.isResuming': { $ne: true },
    'noShowDetails.settlementExhausted': { $ne: true },
  })
    .sort({ 'noShowDetails.confirmedAt': 1 })
    .limit(batchSize);

// Admin-visible query for manual review queue
export const findExhaustedNoShowSettlements = async () =>
  Booking.find({
    status: { $in: ['no-show-stylist', 'no-show-client'] },
    'noShowDetails.settlementCompletedAt': null,
    'noShowDetails.settlementExhausted': true,
  }).populate(['clientId', 'stylistId']);
```

  In `no-show-resolution.cron.js`, the sweep iterates over `findUnfinishedNoShowSettlements()`. For each booking,
  it attempts `await bookingRepository.claimSettlementResume(b._id)`. If `null` (another worker claimed it
  or it just finished), it skips. Otherwise, it calls `resolveNoShow(b._id)`.
  On error:
  1. Calls `releaseSettlementResumeClaim(b._id)` to clear the lock.
  2. If `b.noShowDetails.settlementAttempts + 1 >= maxAttempts`, calls `markSettlementExhausted(b._id, err.message)`
     and fires `logger.error('[CRITICAL ALERT] No-show settlement permanently exhausted for booking ' + b._id)`.
     This surfaces the booking in the admin manual resolution queue rather than silently vanishing!

- [ ] **Failing test (NS5):**

```js
it('resumes a settlement that crashed after the refund', async () => {
  const booking = await Booking.create({ /* …, status: 'confirmed', reported against stylist */ });
  await Payment.create({ bookingId: booking._id, status: 'paid', amount: 1000, /* … */ });

  // Crash between the provider refund and the settlement transaction.
  jest.spyOn(ledgerService, 'postDoubleEntry').mockRejectedValueOnce(new Error('crash'));
  await expect(noShowService.resolveNoShow(booking._id, { reason: 'test' })).rejects.toThrow();

  const mid = await Booking.findById(booking._id);
  expect(mid.status).toBe('no-show-stylist');                       // A committed
  expect(mid.noShowDetails.settlementCompletedAt).toBeFalsy();      // C/D/E did not
  expect(await Penalty.countDocuments({ bookingId: booking._id })).toBe(0);

  // The sweep finds it (findPendingNoShowReports cannot — assert that too).
  expect(await bookingRepository.findPendingNoShowReports(new Date())).toHaveLength(0);
  const stuck = await bookingRepository.findUnfinishedNoShowSettlements(5, 50);
  expect(stuck.map(String)).toContainEqual(expect.stringContaining(String(booking._id)));

  ledgerService.postDoubleEntry.mockRestore();
  await noShowService.resolveNoShow(booking._id, { reason: 'resume' });

  const done = await Booking.findById(booking._id);
  expect(done.noShowDetails.settlementCompletedAt).toBeTruthy();
  expect(await Penalty.countDocuments({ bookingId: booking._id })).toBe(1);   // not 2
  expect(await Coupon.countDocuments({ sourceBookingId: booking._id })).toBe(1);
  const p = await Payment.findById(/* … */);
  expect(p.refundAmount).toBe(1000);                                          // not double-refunded
});

it('halts instead of guessing when the payment is stuck in REFUNDING', async () => {
  /* seed Payment.status = 'refunding'; expect a 409 and NO provider call */
});
```

- [ ] **Run — expect FAIL** against current code (`resolveNoShow` early-returns and reports
  success; no sweep finds the booking; the penalty and coupon never appear).

*Analysis:* **Business-rule preservation:** none touched — the resume re-runs the *same*
policy. **Security impact:** none. **Financial impact:** strictly positive; closes a silent
permanent loss. The `REFUNDING` branch is deliberately fail-stop rather than fail-retry, and
the Paymob idempotency key + payment status check guarantees no double-refunds occur.
**Concurrency impact:** cluster-safe — `claimSettlementResume` uses an atomic `findOneAndUpdate`
with an `isResuming` guard so multiple cluster workers cannot concurrently execute Step B.
**Data impact:** additive fields (`settlementCompletedAt`, `settlementAttempts`, `isResuming`, `resumedAt`)
+ one index. **API impact:** **No API change**
— `settlementCompletedAt` is internal; confirm it is not projected by `booking.dto.js`.
**Rollback:** revert; the fields become inert. **Risk: LOW**, and it *removes* a
VERY HIGH residual risk.

- [ ] **Step 1: Write the failing ordering test (NS1)**

```js
it('does not delete the schedule block when the status CAS loses', async () => {
  const booking = await Booking.create({ /* …, status: 'confirmed', noShowDetails: {reportedAt: past, reportedAgainst: 'stylist'} */ });
  await ScheduleBlock.create({ bookingId: booking._id, /* … */ });
  // The booking completes between resolveNoShow's read and its claim.
  jest.spyOn(bookingRepository, 'findById').mockImplementationOnce(async (id) => {
    const doc = await Booking.findById(id).populate(['clientId', 'stylistId']);
    await Booking.updateOne({ _id: id }, { $set: { status: 'completed' } });
    return doc;
  });

  await noShowService.resolveNoShow(booking._id, { reason: 'test' });

  expect(await ScheduleBlock.countDocuments({ bookingId: booking._id })).toBe(1);
});
```

- [ ] **Step 2: Run it — expect FAIL** (today the block is deleted at `:211`, before the CAS).

- [ ] **Step 3: Write the failing refund-failure test (NS2)**

```js
it('leaves payoutStatus untouched when the refund fails', async () => {
  const booking = await Booking.create({ /* …, status: 'confirmed', payoutStatus: 'unpaid' */ });
  await Payment.create({ bookingId: booking._id, status: 'paid', amount: 1000, /* … */ });
  jest.spyOn(paymentService, 'processRefund').mockRejectedValue(new Error('provider down'));

  await expect(noShowService.resolveNoShow(booking._id, { reason: 'test' })).rejects.toThrow(/provider down/);

  const fresh = await Booking.findById(booking._id);
  expect(fresh.payoutStatus).toBe('unpaid');          // NOT settled
  const p = await Payment.findOne({ bookingId: booking._id });
  expect(p.refundError).toMatch(/provider down/);      // and the failure is durable
});
```

- [ ] **Step 4: Run it — expect FAIL** (today `:259` writes `payoutStatus` regardless and the
  function returns normally).

- [ ] **Step 5: Write the failing atomicity test (NS3)**

```js
it('rolls back the penalty when the ledger write fails', async () => {
  const booking = await Booking.create({ /* …, status: 'confirmed', reported against stylist */ });
  jest.spyOn(ledgerService, 'postDoubleEntry').mockRejectedValue(new Error('ledger down'));

  await expect(noShowService.resolveNoShow(booking._id, { reason: 'test' })).rejects.toThrow(/ledger down/);

  expect(await Penalty.countDocuments({ bookingId: booking._id })).toBe(0);
  const fresh = await Booking.findById(booking._id);
  expect(fresh.payoutStatus).toBe('unpaid');
});
```

- [ ] **Step 6: Run it — expect FAIL** (today the `Penalty` is committed and the ledger error
  is swallowed, so the penalty exists with no matching ledger pair — permanently unbalanced).

- [ ] **Step 7: Implement the restructure**

Restructure `resolveNoShow` to the A/B/C/D shape above. Specific edits:
- Move `await scheduleRepository.deleteByBookingId(bookingId)` from `:211` into step D, and
  delete the now-false comment "nothing to unwind" at `:220-224`, replacing it with an
  accurate one.
- In step B's `catch`, write `refundError` / `refundFailedAt` as today **and rethrow**.
  Remove the `logger.error`-and-continue.
- Wrap step C in `withTransaction(async (session) => { … })`, threading `session` into
  `bookingRepository.transitionStatus`, `penaltyRepository.create` and
  `ledgerService.postDoubleEntry`. Remove the `try/catch` around the ledger pair — it must
  now fail the transaction.
- Keep the E11000 tolerance on `penaltyRepository.create` (idempotent retry) exactly as it is.
- **Step D (schedule delete, coupon, reliability, chat lock) is retried, not merely recorded.**
  Each keeps its `try/catch` and writes a durable marker
  `noShowDetails.postSettlementErrors: [{step, message, at}]` via
  `bookingRepository.updateById` (a non-status patch, so `updateById` is correct here) — but
  **the marker alone is not the mechanism.** Recording an error nobody reads leaves a
  permanently blocked stylist slot and an unissued coupon, which is the same silent-failure
  class the phase exists to remove.

  The mechanism is S3.2a's completion marker: **`settlementCompletedAt` is stamped only when
  every step D operation has succeeded.** A step D failure therefore leaves the booking
  visible to `findUnfinishedNoShowSettlements`, and the existing 15-minute sweep re-invokes
  `resolveNoShow`, which resumes from the top and re-attempts exactly the steps that failed —
  safe because all four are idempotent (verified in S3.2a). `settlementAttempts` bounds this
  at 5; after that the booking stops being swept and is logged at `error` level with its
  `postSettlementErrors` array for admin follow-up.

  **No new job, no queue, no DLQ.** The retrier is the cron that already exists for this
  domain, and the work item is the booking document itself.

- [ ] **Step 8: Run the three new tests — expect PASS. Then the whole no-show surface**

Run: `npx jest tests/unit/no-show.service.test.js tests/unit/no-show.policy.test.js tests/unit/no-show.admin-resolve.test.js tests/integration/no-show-refund.test.js tests/integration/ledger-dual-write.test.js tests/integration/cancellation-ledger.test.js`
Expected: all PASS, existing assertions unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/modules/bookings/no-show.service.js tests/
git commit -m "fix(no-show): make settlement atomic and stop settling after a failed refund

- schedule block is deleted only after the status CAS is won (it was deleted first,
  so a booking that actually completed lost its calendar slot)
- a failed refund now aborts settlement instead of writing a settled payoutStatus
- payoutStatus + Penalty + ledger pair run in one transaction; the ledger write can
  no longer be swallowed, leaving a penalty with no matching entry
- post-hoc steps (coupon, reliability, chat lock) keep a durable failure record

No no-show rule, gate, window, percentage or status changed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

#### Task S3.3 — `payoutStatus: 'not_owed'` (S-1)

**Analysis.** *Current behaviour:* `no-show.service.js:259` writes `'paid'` to mean "nothing
owed". *Current complexity:* one value with two meanings, read by two different guards.
*Root cause:* the payout axis was added before the no-show policy existed. *Proposed target:*
a fourth value. *Business-rule preservation:* none of the money changes; only the label on a
booking that owes the stylist nothing. *Security impact:* none. *Financial impact:* **positive
and structural** — closes the X1 class. *Concurrency impact:* none. *Data impact:*
**Backfill required** (see §H.1). *API impact:* **No API change** *provided* no response DTO
exposes `payoutStatus` verbatim to a client — **verify with
`grep -rn "payoutStatus" src/modules/*/**.dto.js` before starting.** If a DTO does expose it,
map `not_owed → paid` at the DTO boundary and note it; the enum widening must not leak.
*Test impact:* new tests for both guards. *Rollback:* revert code; the backfill is reversible
(`not_owed → paid`). *Risk:* **MEDIUM** (enum + backfill on the money axis).

- [ ] **Step 1: Write the failing guard tests**

```js
it('PAYOUT_ELIGIBILITY excludes not_owed bookings', async () => {
  await Booking.create({ /* …, status: 'no-show-stylist', payoutStatus: 'not_owed', … */ });
  expect(await bookingRepository.findCompletedUnpaidBefore(new Date())).toHaveLength(0);
});

it('processRefund refuses a not_owed booking, same as paid', async () => {
  /* … */
  await expect(paymentService.processRefund({ bookingId, refundPercentage: 100 }))
    .rejects.toThrow(/payout is already/);
});
```

- [ ] **Step 2: Run — expect FAIL** (`not_owed` is not a valid enum value yet).

- [ ] **Step 3: Implement**
  - `booking.model.js`: add `'not_owed'` to the `payoutStatus` enum.
  - `statuses.constant.js`: add a `PAYOUT_STATUS` export
    (`UNPAID | PROCESSING | PAID | NOT_OWED`) and use it in the model, replacing the inline
    string enum. Add a comment explaining that `not_owed` exists because `'paid'` was
    overloaded and that overload caused X1.
  - `no-show.service.js`: `payoutStatus: settlement.stylistCompensationAmount > 0 ? PAYOUT_STATUS.UNPAID : PAYOUT_STATUS.NOT_OWED`.
  - **Verify, do not change:** `PAYOUT_ELIGIBILITY` matches `payoutStatus: 'unpaid'`
    (`booking.repository.js:179`) and `processRefund`'s guard is `!== 'unpaid'`
    (`payment.service.js:397`). Both already behave correctly for the new value. Add an
    inline comment at each site saying so.

- [ ] **Step 4: Run the new tests + the payout suite**

Run: `npx jest tests/unit/payout.service.test.js tests/unit/payout.repository.test.js tests/unit/payout.netting.test.js tests/integration/payout.authorization.test.js tests/integration/no-show-refund.test.js` → PASS.

- [ ] **Step 5: Write the backfill script** (see §H.1 for the exact query) and its dry-run test.

- [ ] **Step 6: Commit**

#### Task S3.4 — Per-party check-in (S-2 / BK8)

**Analysis.** *Current behaviour:* one `checkInAt` written by either party; the no-show gate
reads it. *Current complexity:* none — the field is simple; it is **wrong**. *Root cause:* the
field predates the no-show flow, which then reused it as an attendance proof.
*Proposed target:* `clientCheckInAt` / `stylistCheckInAt`, mirroring
`clientConfirmedAt` / `stylistConfirmedAt` three fields away. *Business-rule preservation:*
"the reporter must themselves have turned up" is the stated rule; today it is not enforced.
This **restores** the rule rather than changing it. *Security impact:* **positive** — closes a
fraud gate where the accused party's check-in satisfied the accuser's requirement.
*Financial impact:* indirect — a fraudulent no-show moves money. *Concurrency impact:* none.
*Data impact:* **Additive migration + conservative backfill** (§H.2). *API impact:* **No API
change** — `checkInAt` is retained and still written (both fields are set), so any client
reading it is unaffected. *Test impact:* new gate tests. *Rollback:* revert; `checkInAt`
still carries the old semantics. *Risk:* **LOW-MEDIUM.**

- [ ] **Step 1: Write the failing fraud test**

```js
it('refuses a no-show report from a party who never checked in themselves', async () => {
  const booking = await Booking.create({
    /* …, status: 'in-progress', stylistCheckInAt: new Date(), clientCheckInAt: null */
  });
  // The CLIENT reports the stylist, but only the STYLIST checked in.
  await expect(noShowService.fileNoShow(clientUser, booking._id, {}))
    .rejects.toThrow(/must check in/i);
});
```

- [ ] **Step 2: Run — expect FAIL** (today `booking.checkInAt` is set by the stylist and
  satisfies the client's gate).

- [ ] **Step 3: Implement**
  - `booking.model.js`: add `clientCheckInAt: Date`, `stylistCheckInAt: Date`. **Keep
    `checkInAt`** — it is read by `reliability.service.js:58-65` for punctuality (L4 scope,
    deliberately untouched) **and it is projected into the API response at
    `booking.dto.js:41`**, so removing it would be an API change this plan forbids.
  - `booking.service.js` `checkIn` (`:197-237`): the guard admits **either** party
    (`userIdStr !== clientIdStr && userIdStr !== stylistIdStr` → 403), so the function
    already knows which party is calling. Write **exactly one** per-party field — the
    caller's own — plus the legacy `checkInAt`:

```js
const updateData = {
  checkInAt: new Date(),                       // legacy: still read by reliability + the DTO
  [isClient ? 'clientCheckInAt' : 'stylistCheckInAt']: new Date(),
  status: 'in-progress',
};
```

> **DO NOT write both per-party fields.** Writing `clientCheckInAt` and `stylistCheckInAt`
> together on a single check-in would reproduce the exact L5 hole this task exists to close:
> the accused party's check-in would once again satisfy the accuser's gate, and it would do so
> *in the data*, permanently, rather than only in the code. The whole value of splitting the
> field is that each timestamp is evidence about **one** named party.
>
> Keeping the legacy `checkInAt` is safe because nothing reads it as an authorization input
> after this task — the gate below reads the per-party field, and `checkInAt`'s two remaining
> readers (punctuality scoring, the DTO) are not security decisions.

  - `no-show.service.js:76-83`: gate on the **reporter's own** field —
    `const reporterCheckIn = userId === clientId ? booking.clientCheckInAt : booking.stylistCheckInAt;`
    plus the time-boxed legacy fallback defined in §H.2. Never fall back to the bare
    `booking.checkInAt` with no cutoff; that is today's hole.

- [ ] **Step 4: Add a permanent regression test that the fields are never co-written**

```js
it('a check-in stamps only the checking-in party field', async () => {
  await bookingService.checkIn(stylistUser, booking._id, {});
  const b = await Booking.findById(booking._id);
  expect(b.stylistCheckInAt).toBeTruthy();
  expect(b.clientCheckInAt).toBeFalsy();     // the gate's whole value depends on this
});
```

- [ ] **Step 5: Run the no-show suite. Commit.** (There is no backfill to run — see §H.2.)

#### Task S3.5 — Issue the late-stylist-cancellation coupon (S-3 / BK5)

**Analysis.** *Current behaviour:* `couponEligible: true` is computed and nothing issues a
coupon. *Current complexity:* none — a missing call. *Root cause:* the coupon path was built
in `no-show.service.js` and never wired into cancellation. *Proposed target:* mirror
`no-show.service.js:305-313` exactly. *Business-rule preservation:* **restores** a documented
capability (`REVISION…md:635`, product guide). *Security impact:* none. *Financial impact:*
the platform funds a 10 % coupon capped at 150 EGP on late stylist cancellations — this is the
documented rule that was never executing. **Flag it to the PO: it is a real cost that starts
being incurred.** *Concurrency impact:* idempotent on `{sourceBookingId, issuedReason}` (the
existing unique index). *Data impact:* **No migration.** *API impact:* **No API change.**
*Test impact:* new issuance test + an idempotency test. *Rollback:* revert. *Risk:* **LOW.**

- [ ] **Step 1: Write the failing test**

```js
it('issues a compensation coupon when a stylist cancels late', async () => {
  await bookingService.cancelBooking(stylistUser, booking._id, { reason: 'emergency' });
  const coupon = await Coupon.findOne({ sourceBookingId: booking._id });
  expect(coupon).not.toBeNull();
  expect(coupon.recipientId.toString()).toBe(clientUser._id.toString());
});

it('does not issue one when a stylist cancels early', async () => { /* … */ });

it('is idempotent on a retry', async () => {
  await couponService.issueCoupon({ recipientId, sourceBookingId, issuedReason: 'LATE_STYLIST_CANCELLATION' });
  await couponService.issueCoupon({ recipientId, sourceBookingId, issuedReason: 'LATE_STYLIST_CANCELLATION' });
  expect(await Coupon.countDocuments({ sourceBookingId })).toBe(1);
});
```

- [ ] **Step 2: Run — expect FAIL** (no coupon is created).

- [ ] **Step 3: Implement.** Import `couponService` into `booking.service.js`; after the
  cancellation transaction commits, if `outcome.couponEligible`, call
  `couponService.issueCoupon({ recipientId: clientId, sourceBookingId: bookingId, issuedReason: 'LATE_STYLIST_CANCELLATION' })`
  inside a `try/catch` that records a durable marker (same pattern as S3.2 step D).
  **Check `coupon.model.js`'s `issuedReason` enum** — if `LATE_STYLIST_CANCELLATION` is not a
  member, add it; that is an additive enum change with no backfill.

- [ ] **Step 4: Run the coupon + cancellation suites. Commit.**

**Phase S3 summary.**
**Dependencies:** S2 merged; `settlement.differential.test.js` green.
**Business behaviour impact:** three deliberate, itemised changes — (a) a failed no-show refund
no longer settles the booking, (b) the no-show attendance gate actually enforces the stated
rule, (c) the late-stylist-cancellation coupon is finally issued (**a real new platform cost;
PO must acknowledge**). Everything else is invariant.
**Database impact:** one enum widening (`payoutStatus`), two additive fields
(`clientCheckInAt`, `stylistCheckInAt`), one additive enum member (`issuedReason`), two
backfills (§H.1, §H.2).
**Migration strategy:** §H. Additive-only; old fields retained for one full release.
**Rollback:** per-commit revert. Both backfills have an exact inverse and neither drops a field.
**Acceptance criteria:** the six new failing-first tests pass · every existing no-show,
cancellation, dispute, payout and ledger suite green **unchanged** · `npm run verify` green ·
`grep -n "'paid'" src/modules/bookings/no-show.service.js` returns no "nothing owed" overload.
**Risk: MEDIUM-HIGH** — the highest-risk phase in this plan. It is scheduled here, not later,
because S2's CAS primitive and the differential proof must already be in place for it to be
safe at all.

---

### Phase S4 — Ledger call sites, transaction helper adoption, and dead code

**Objective.** Finish the money-path consolidation while the files are fresh, then delete
everything S0 decided is dead.

**Exact scope.** Four tasks, each independently revertable.

#### Task S4.1 — Ledger pairs through `postDoubleEntry(…, session)` (B6 / P1)

**Analysis.** *Current behaviour:* four hand-rolled un-sessioned pairs swallowed to
`console.error` (D.6 P1), plus two existing `postDoubleEntry` calls that also pass no session
(§0.1 C3). *Current complexity:* the correct primitive exists and is bypassed, in the same
files (`ledger.service.js:101` already accepts `session = null` and forwards it; the defect is
strictly at the call sites).
- `booking.service.js:835`: The write must **MOVE** inside the try-block before
  `commitTransaction` (line 787). Currently, the transaction commits at :787 and ends at :799,
  but the penalty dual-write happens at :835 after the session is gone, making session-threading
  impossible without moving the write.
- `no-show.service.js:259-310`: Has **no transaction at all**. The `payoutStatus` update,
  `Penalty.create`, and `postDoubleEntry` are three independent, untransacted writes.
- **Failure-semantics decision (Fail-Closed):** Both sites currently catch ledger errors and
  only log (`[Ledger Dual-Write Warning]`), leaving the penalty recorded in `Penalty` but missing
  from the ledger. In S4.1 / S3.2, moving the write inside the transaction makes the failure
  semantics **fail-closed**: a ledger write failure will now abort the cancellation/no-show transaction
  instead of swallowing.
- **Risk note on fail-closed:** This turns a swallowed ledger failure into a transaction abort.
  This is strictly safe and correct because penalty idempotency keys (`penalty:${tier}:stylist:${bookingId}`)
  are deterministic, allowing user or cron sweep retries to succeed cleanly once transient DB pressure clears,
  while eliminating permanent accrual imbalances in the nightly reconciliation sweep.

*Root cause:* `postDoubleEntry` was added after the call sites and they were never
migrated; its JSDoc overstates its atomicity, which hid the gap. *Proposed target:* every pair
goes through `postDoubleEntry(debit, credit, session)` **inside the caller's transaction**;
failures go to Winston, never `console.error`. *Business-rule preservation:* none touched —
the entry types, amounts, idempotency keys, account types and directions are copied verbatim.
*Security impact:* none. *Financial impact:* **strictly positive** — a DEBIT can no longer
commit while its CREDIT throws, which is the mechanism that permanently unbalances a booking.
*Concurrency impact:* none added; atomicity restored. *Data impact:* **No migration** — the
idempotency keys are unchanged, so existing entries are untouched and a replay still returns
the existing row. *API impact:* **No API change.** *Test impact:*
`tests/integration/ledger-dual-write.test.js` must stay green; add a partial-failure test per
site. *Rollback:* per-commit revert. *Risk:* **MEDIUM** (money path) but bounded — no amount,
key or type changes.

Sites, one commit each:

| Site | File:lines | Enclosing transaction? |
|---|---|---|
| Payment paid (CLIENT DEBIT / ESCROW CREDIT) | `payment.service.js:287-305` | **No** — add one around the CAS + the pair |
| Refund (3 pairs: escrow release, client credit, platform fee) | `payment.service.js:477-535` | **No** — add one around the terminal `transitionStatus` + the pairs. **The provider call stays outside** |
| Subscription charge | `subscription.service.js:403-422` | The grant already has one at `:373` — thread its session |
| Cancellation penalty | `booking.service.js:835` | The cancellation transaction exists at `:735-790` — **move the ledger pair inside it before commitTransaction (:787)** |
| No-show penalty | `no-show.service.js:286` | Has no transaction at all today (`:259-310`); wrapped in atomic txn in S3.2 Step C |
| Coupon pair (already correct) | `payment.service.js:133` | **Verify it threads a session; fix if not** |

- [ ] **Step 1 (per site): Write the failing partial-failure test**

```js
it('does not leave a lone DEBIT when the CREDIT fails', async () => {
  let call = 0;
  jest.spyOn(ledgerRepository, 'create').mockImplementation(async (data, session) => {
    if (++call === 2) throw new Error('credit failed');
    return realCreate(data, session);
  });

  await expect(/* the operation */).rejects.toThrow();

  const entries = await LedgerEntry.find({ bookingId });
  expect(entries).toHaveLength(0);   // all-or-nothing
});
```

- [ ] **Step 2: Run — expect FAIL** (today the DEBIT is committed and the error is swallowed).
- [ ] **Step 3: Migrate that one site.** Replace the two `postEntry` calls with one
  `postDoubleEntry(debit, credit, session)`; delete the `direction` keys from each half
  (`postDoubleEntry` sets them); keep the idempotency keys, notes and correlation ids
  **byte-identical**; replace `console.error` with
  `logger.error('[Ledger] …', { bookingId, idempotencyKey })` and **rethrow** so the
  transaction aborts.
- [ ] **Step 4: Run the ledger suites.**
  `npx jest tests/integration/ledger-dual-write.test.js tests/integration/ledger.reconciliation.test.js tests/integration/cancellation-ledger.test.js tests/unit/ledger.service.test.js tests/unit/system-coherence.test.js` → PASS.
- [ ] **Step 5: Commit.**
- [ ] **Step 6:** Correct `postDoubleEntry`'s JSDoc at `ledger.service.js:94` — "atomically
  within a session" → "atomically **when a session is supplied and the caller holds a
  transaction**; without one these are two independent writes." Commit with the last site.
- [ ] **Step 7:** `grep -rn "console.error" src/ --include=*.js` must return **0**.

#### Task S4.2 — Adopt `withTransaction` (B4 / BK4)

- [ ] **Step 1:** Replace each of the 8 `readyState === 1` blocks with `withTransaction`.
  One file per commit: `booking.service.js:741`, `offer.service.js:171`,
  `payment.service.js:163`, `payout.service.js:166,372,437`,
  `subscription.service.js:373,781`.
  **Do not touch `routes/index.js:49`** — that is a legitimate health probe.
- [ ] **Step 2:** For each, delete the non-transactional `else` branch and the manual
  `startTransaction` / `commitTransaction` / `abortTransaction` / `endSession` scaffolding.
  `session.withTransaction` handles all four and retries on `WriteConflict`.
- [ ] **Step 3:** **`payout.service.js` requires care** — M5 is open there. Fix it in the same
  commit: move the `createdPayouts` accumulator **inside** the `work()` callback (it is
  currently outside, so a retry re-pushes every payout) and thread the session into the
  eligibility (`:91`) and profile (`:86`) reads. Add a test that forces one retry and asserts
  `createdPayouts.length` is correct and `PAYOUT_CREATED` is emitted once per payout.
- [ ] **Step 4:** Run `npx jest tests/unit/payout.service.test.js tests/unit/payout.netting.test.js tests/integration/subscription-grant-transaction.test.js tests/integration/payments.test.js` → PASS.
- [ ] **Step 5:** `grep -rn "readyState === 1" src/ --include=*.js` must return exactly **1**
  (`routes/index.js:49`). Commit.

*Analysis:* **Data impact:** No migration. **API impact:** No API change. **Financial impact:**
positive (paths that could run non-atomically no longer can; M5's phantom payout rows and
duplicate notifications are eliminated). **Risk: LOW** for the 7 simple sites, **MEDIUM** for
`payout.service.js` because M5 is bundled.

#### Task S4.3 — Dead code deletion (S-6, S-7, S-8, S-12, S-13, P1, P2, P4, O-4)

Each item is one commit, and **each must be preceded by a proof grep whose output goes in the
commit body.**

- [ ] `src/modules/reliability/` — **only if P2 = delete.**
  Proof: `grep -rn "ReliabilityEvent\|reliability-event" src/ tests/ scripts/` → 2 hits, both
  inside the file itself. Delete the directory.
  **Do not touch `src/modules/stylists/reliability.service.js` — it is live.**
- [ ] `Booking.isFrozen` / `frozenReason` / `frozenAt` + the `{isFrozen, payoutStatus}` index +
  the `isFrozen: {$ne: true}` clause + `NOTIFICATION_TYPES.'safety'` +
  `system-coherence.test.js:125-130` + the `AGENTS.md` invariant sentence —
  **only if P1 = delete.** Proof: `grep -rn "isFrozen" src/` → no assignment anywhere.
  **Additive migration not required; `$unset` the three fields in a cleanup script (§H.3).**
- [ ] `PAYMENT_STATUS.CANCELLED`. Proof: `grep -rn "PAYMENT_STATUS.CANCELLED\|'cancelled'" src/modules/payments/` → 0 relevant hits.
  Also remove it from `payment.model.js`'s enum. **No backfill needed** (no document holds it —
  verify with a one-off `countDocuments({status:'cancelled'})` on staging first).
- [ ] `CANCELLATION_POLICY.FULL_REFUND_HOURS`, `PARTIAL_REFUND_PERCENTAGE` and
  `PARTIAL_PLATFORM_FEE_PERCENTAGE`. Proof: grep each name across `src/ tests/ scripts/` → only
  the declaration.
- [ ] `Subscription.status: 'past_due'` — **only if P4 = delete.** Proof:
  `grep -rn "past_due" src/ tests/` → only the enum. Verify no document holds it before
  narrowing the enum.
- [ ] `ModerationEvent.actionTaken: 'ALLOW'` (O-4). Proof: no writer.
- [ ] **S-12 — the moderation substring fallback.** This one needs a corpus, not a grep:

  - [ ] Write `tests/unit/moderation.corpus.test.js` with two frozen lists —
    `MUST_DETECT` (every string the current scanner flags: phone numbers in Arabic-Indic and
    Latin digits, with separators, with zero-width characters, with tashkeel; domains; the
    seeded blocked words) and `MUST_NOT_DETECT` (`"Hassan"` against blocked word `"ass"`;
    a message containing `"me"` against blocked domain `"me"`; ordinary Arabic and English
    sentences).
  - [ ] Run it **against the current scanner**: `MUST_DETECT` passes, `MUST_NOT_DETECT`
    **fails**. Record that output.
  - [ ] Delete `|| lowerText.includes(normWord)` at `moderation.scanner.js:132` and replace
    the pure `includes` at `:109` with a boundary-aware domain match.
  - [ ] Re-run: **both** lists must pass. A single lost `MUST_DETECT` entry blocks the commit.
  - [ ] Run `npx jest tests/unit/moderation.scanner.test.js tests/unit/moderation.service.test.js tests/unit/blocked-words.test.js tests/integration/moderation-interceptor.test.js` → PASS.

- [ ] **S-13 — `booking.controller.resolveDispute` inverted args.** Swap to
  `(req.user._id || req.user.id, req.params.id, req.body)`. It is unrouted, so no test covers
  it; add one that calls the controller with a mocked service and asserts the argument order.

#### Task S4.4 — KYC and uploads (B7, B8)

**Analysis (B7 / K1).** *Current behaviour:* KYC assets are stored `authenticated`;
`result.secure_url` (unfetchable) is returned; the raw `documentRef` public_id is stored in a
field named `url`; `getSignedKycUrl` is never called. *Current complexity:* none — a missing
wire. *Root cause:* the signing helper was written and the read path was never connected.
*Proposed target:* the reviewer-facing read path signs on the fly. *Business-rule
preservation:* none touched. *Security impact:* **positive** — signed, 1-hour, per-request
URLs, minted **only** for admin/operator reviewers, never for the document owner's own profile
read and never persisted. *Financial impact:* none. *Concurrency impact:* none. *Data impact:*
**No migration** — the stored public_id is already the correct value; only the read changes.
*API impact:* **No API change to the route set.** The `verification.documents[].url` field's
*value* changes shape for admin/operator readers (public_id → signed URL). Record this in
`docs/04_ROUTES.md`. *Test impact:* new integration test. *Rollback:* revert. *Risk:* **LOW.**

- [ ] **Step 1: Write the failing test**

```js
it('returns a signed, fetchable URL to a reviewer', async () => {
  const res = await request(app).get(`/api/v1/admin/users/${userId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  const doc = res.body.data.verification.documents[0];
  expect(doc.url).toMatch(/^https:\/\/res\.cloudinary\.com\/.*signature=|.*\/s--/);
});

it('does not sign documents for the owner reading their own profile', async () => {
  const res = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${ownerToken}`);
  expect(res.body.data.verification.documents[0].url).not.toMatch(/signature=/);
});
```

- [ ] **Step 2: Run — expect FAIL** (today the owner and the reviewer both get a bare public_id).
- [ ] **Step 3: Implement.** Add a `documentRef` field to the stored subdocument alongside
  `url` (additive), keep writing the public_id to both for one release, and in the
  admin/operator read path map each document through `uploadService.getSignedKycUrl(documentRef)`.
  **Do not** persist the signed URL — it expires.
- [ ] **Step 4:** Run `npx jest tests/integration/users-verification.test.js tests/integration/admin.users.test.js tests/unit/upload.service.test.js` → PASS. Commit.

**Analysis (B8 / K2).** *Current behaviour:* `POST /uploads/:folder` is `authMiddleware` only.
*Proposed target:* a `folder → allowed roles` map enforced before the Cloudinary call.
*Business-rule preservation:* none touched. *Security impact:* **positive** — closes a
cross-role write into `kyc-documents` and `portfolio`. *Financial impact:* none. *Data impact:*
**No migration.** *API impact:* a request that previously succeeded and **should not have**
now returns 403. That is the fix; it is not a contract change to any documented flow, but it
**must** be noted in `docs/04_ROUTES.md` and the Swagger description for the route.
*Test impact:* one test per folder × role. *Risk:* **LOW.**

- [ ] **Step 1: Write the failing matrix test**

```js
const MATRIX = [
  ['avatars',        'client',  201], ['avatars',        'stylist', 201],
  ['kyc-documents',  'client',  201], ['kyc-documents',  'stylist', 201],
  ['portfolio',      'stylist', 201], ['portfolio',      'client',  403],
  ['request-images', 'client',  201], ['request-images', 'stylist', 403],
  ['wardrobe',       'client',  201], ['wardrobe',       'stylist', 403],
];
it.each(MATRIX)('POST /uploads/%s as %s -> %i', async (folder, role, expected) => { /* … */ });
```

> The expected values above are the **proposed** policy. Confirm each row against
> `docs/04_ROUTES.md` and the actual product flows **before** implementing — a wrong row here
> breaks a real user journey. In particular verify whether stylists upload `request-images`.

- [ ] **Step 2: Run — expect FAIL** on every `403` row (all currently return 201).
- [ ] **Step 3: Implement** a `FOLDER_ROLES` map in `upload.service.js` next to
  `ALLOWED_FOLDERS`, checked inside `uploadFile` (which already receives `user` and ignores
  it). Admin bypasses. Throw `ApiError(403, …)`.
- [ ] **Step 4:** Run `npx jest tests/unit/upload.service.test.js tests/unit/upload.compression.test.js tests/unit/upload.pdf-skip-compression.test.js` and the matrix → PASS. Commit.

**Phase S4 summary.** **Dependencies:** S3 merged. P1/P2/P4 gate **only** their own S4.3
deletion items, each individually skippable; S4.1, S4.2 and S4.4 need no product decision.
**Business behaviour impact:** KYC documents become viewable (restored capability) ·
cross-role uploads now 403 · moderation produces fewer false positives · `not_owed`/dead
constants removed. **Database impact:** one optional `$unset` cleanup (§H.3); two enum
narrowings, both verified empty first. **API impact:** No route changes; two documented value
changes (signed KYC URL, upload 403s). **Tests:** the moderation corpus is the gate for S-12;
every existing suite green. **Rollback:** per-commit. **Acceptance criteria:**
`grep -rn "console.error" src/` = 0 · `grep -rn "readyState === 1" src/` = 1 ·
`grep -rn "role === 'admin'" src/` = 0 · moderation corpus 100 % detect / 0 % false positive ·
`npm run verify` green. **Risk: MEDIUM** (S4.1, S4.2's payout site), **LOW** elsewhere.

---

### Phase S5 — Subscription webhook parity and ledger reconcilability

**Objective.** Close the two genuine subscription defects **without** merging
`SubscriptionOrder` into `Payment`.

#### Task S5.1 — Amount verification on the subscription webhook (S-4 / SB2)

- [ ] **Step 1:** Failing test — deliver a webhook whose `amountCents` disagrees with
  `egpToPiastres(order.amountEgp)` and assert a 400 and **no** plan grant.
  Run against current code → **FAIL** (the plan is granted).
- [ ] **Step 2:** Implement, mirroring `payment.service.js:249-262` **exactly** — same
  `logger.error` shape, same 400 message shape, same `result.amountCents !== undefined && !== null`
  pre-check. Place it **before** the `pending → processing` CAS claim.
- [ ] **Step 3:** Run `npx jest tests/integration/subscription-checkout.test.js tests/integration/subscriptions.test.js tests/integration/subscription-grant-transaction.test.js` → PASS. Commit.

*Analysis:* **Business-rule preservation:** none touched. **Security impact:** positive — an
intention created before a price change, or a partial capture, no longer grants a plan.
**Financial impact:** positive. **Concurrency impact:** none (the existing CAS is untouched —
see §0.1 C2). **Data impact:** No migration. **API impact:** No API change (a mismatched
webhook already had no documented success contract). **Risk: LOW.**

#### Task S5.2 — Make subscription ledger entries reconcilable (S-5 / SB3)

- [ ] **Step 1:** Failing test — seed a subscription charge with a **deliberately
  half-written** ledger pair (DEBIT only), run `reconcileLedger()`, assert it reports it.
  Run against current code → **FAIL** (`unbalancedCount` and `missingLedgerCount` are both 0;
  the entries are invisible to both passes).
- [ ] **Step 2:** Implement the minimal fix. Two options — **prefer (a)**:
  - **(a)** Add a third pass to `ledger-reconciliation.cron.js`: walk
    `SubscriptionOrder.find({status:'paid', updatedAt: {$gte: since}})` and assert a balanced
    pair exists per `correlationId` (`sub_<subscriptionId>`, already written at
    `subscription.service.js:409,419`). **No schema change, no backfill.**
  - **(b)** Add `subscriptionOrderId` to `LedgerEntry` and walk it. Requires an additive
    schema field and leaves historical entries unreachable.
- [ ] **Step 3:** Run `npx jest tests/integration/ledger.reconciliation.test.js` → PASS. Commit.
- [ ] **Step 4:** Add `{ timezone: 'Africa/Cairo' }` here too if S6 has not run yet — otherwise
  leave it to S6. Do not do it twice.

*Analysis:* **Business-rule preservation:** none touched. **Financial impact:** positive — the
only money-integrity detector stops being structurally blind to an entire payment class.
**Data impact:** **No migration** with option (a). **API impact:** No API change.
**Risk: VERY LOW.**

**Phase S5 summary.** **Dependencies:** S4 merged. **Rollback:** per-commit revert.
**Acceptance criteria:** a seeded half-written subscription pair is reported by
`reconcileLedger()` · an amount-mismatched subscription webhook grants nothing ·
`npm run verify` green. **Risk: LOW.**

---

### Phase S6 — Jobs and maintenance

**Objective.** 7 crons → 6, correct timezones, two missing indexes, one lost-update fix, and
an honest `ecosystem.config.cjs`.

#### Task S6.1 — `request-autopause` through the repository with a CAS (B9 / R1)

- [ ] **Step 1: Failing test**

```js
it('does not revive a request cancelled mid-sweep', async () => {
  const req = await Request.create({ status: 'OPEN', offerCount: 0, autoPauseAt: past, /* … */ });
  jest.spyOn(requestRepository, 'findAutoPausableRequests').mockImplementation(async (now) => {
    const docs = await Request.find({ status: 'OPEN', offerCount: {$lte: 0}, autoPauseAt: {$lte: now, $ne: null} });
    await Request.updateOne({ _id: req._id }, { $set: { status: 'CANCELLED' } });  // the racer
    return docs;
  });

  await sweepAutoPauseRequests();

  expect((await Request.findById(req._id)).status).toBe('CANCELLED');
});
```

- [ ] **Step 2: Run — expect FAIL** (today `req.save()` writes `PAUSED` over `CANCELLED`, and
  `PAUSED` is reactivatable, so a cancelled request can receive offers again).
- [ ] **Step 3: Implement.** Call `requestRepository.findAutoPausableRequests(now)`. Replace
  each `doc.save()` with a CAS:
  `Request.findOneAndUpdate({_id, status: REQUEST_STATUS.OPEN}, {$set:{…}, $inc:{pauseCount:1}}, {returnDocument:'after'})`,
  counting only non-null results. Delete the `'pending'` branch from the query. Remove the
  direct `import Request from '…/request.model.js'` in favour of the repository.
  **Note the `pauseCount` gap (M9's second half):** two other paths set `PAUSED` without
  incrementing `pauseCount`, so the "max 3 reactivations" rule is enforced against one of three
  pause paths. **Document this in the commit body; do not fix it here** — it is a business-rule
  question for the PO, not a consolidation.
- [ ] **Step 4:** Run `npx jest tests/unit/request.lifecycle.test.js tests/unit/request.service.test.js tests/integration/requests-offers.test.js` → PASS. Commit.

#### Task S6.2 — Delete `otp-cleanup.cron.js` (S-9)

- [ ] **Step 1:** Record the proof in the commit body:
  `auth.service.js:132` and `:403` reject an expired OTP at point of use; `:106`, `:168`, `:391`
  reset `otpAttempts` on every issue. The cron therefore has zero correctness value.
- [ ] **Step 2: DO NOT add a TTL index.** `otpExpiresAt` lives on `User`; a TTL index there
  deletes user accounts (§0.1 C1). Write this warning into the commit body and into
  `docs/OPS.md` so nobody "restores" the behaviour that way.
- [ ] **Step 3:** Delete `src/jobs/otp-cleanup.cron.js` and its registration in
  `src/server.js` (or wherever `startOtpCleanupCron` is called — `grep -rn "startOtpCleanupCron" src/`).
- [ ] **Step 4:** `system-coherence.test.js:161-170` iterates `src/jobs/*.cron.js` and requires
  `if (registered) return` in each — removing a file does not break it. Confirm by running it.
- [ ] **Step 5:** Run `npm run verify` → green. Commit.

#### Task S6.3 — Timezone on the six remaining crons (S-10 / M11)

- [ ] **Step 1:** Add `export const BUSINESS_TIMEZONE = 'Africa/Cairo';` to
  `src/common/constants/defaults.constant.js` (or reuse the existing constant if
  `businessDay.util.js` already exports one — `grep -rn "Africa/Cairo" src/` first and use
  the single source).
- [ ] **Step 2:** Pass `{ timezone: BUSINESS_TIMEZONE }` as the third argument to every
  `cron.schedule(...)`.
- [ ] **Step 3:** Add to `system-coherence.test.js`:

```js
it('every cron declares the business timezone', () => {
  for (const file of fs.readdirSync('src/jobs').filter((f) => f.endsWith('.cron.js'))) {
    expect(fs.readFileSync(`src/jobs/${file}`, 'utf8')).toMatch(/timezone:\s*BUSINESS_TIMEZONE/);
  }
});
```

- [ ] **Step 4:** `grep -L timezone src/jobs/*.cron.js` must return nothing. Commit.

*Analysis:* **Business behaviour impact — REAL.** On a UTC host the 02:00/03:00 sweeps
currently run at 04:00/05:00 Cairo; after this they run at the intended hour. **Flag to ops:**
the first deployment shifts sweep times by the UTC offset. **Risk: VERY LOW.**

#### Task S6.4 — Indexes (S-11 / L12)

- [ ] Add `bookingSchema.index({ 'noShowDetails.reportedAt': 1, 'noShowDetails.respondedAt': 1, status: 1 })`
  to serve `findPendingNoShowReports` (`booking.repository.js:242-249`, currently a COLLSCAN
  every 15 minutes).
- [ ] Add `offerSchema.index({ status: 1, expiresAt: 1 })` to serve the offer-expiry sweep.
- [ ] **Do not** add an index for autopause — `request.model.js:67` already has one (§0.1 C4).
- [ ] **Gate the build (M27).** `autoIndex` is on in production with no deploy gate, and
  `scripts/check-duplicate-active-subscriptions.js` is wired into no npm script. Add both to
  `package.json` as a `predeploy` script and document the gate in `docs/OPS.md`.
- [ ] Verify with `explain()` on staging that neither sweep is a COLLSCAN. Commit.

#### Task S6.5 — Honest `ecosystem.config.cjs` (S-14)

- [ ] Rewrite the `instances: 1` comment to name **all four** load-bearing properties (D.17):
  the six crons' re-entrancy, the `tokenVersionCache` 30 s in-process revocation cache, the
  `session-reminder` `reminderSentAt` guard, and the moderation blocked-word in-memory cache.
  Note that a Redis `SET NX PX` leader lock is the unblocking change, and that
  `tokenVersionCache` needs Redis-backing independently.
- [ ] `system-coherence.test.js:173-179` already asserts `instances: 1` / `exec_mode: 'fork'` —
  leave it. Commit.

**Phase S6 summary.** **Dependencies:** none beyond S0 (can run in parallel with S5).
**Business behaviour impact:** sweeps run at the correct Cairo hour (real change, flag to ops);
a request cancelled mid-sweep is no longer revived. **Database impact:** two index builds,
gated. **API impact:** No API change. **Rollback:** trivial per job; index drops are safe.
**Acceptance criteria:** `grep -L timezone src/jobs/*.cron.js` → nothing ·
`ls src/jobs/*.cron.js | wc -l` → 6 · the autopause lost-update test green · neither sweep is
a COLLSCAN. **Risk: LOW.**

---

### Phase S7 — Documentation truth and final audit

**Objective.** Make the documentation match the code, and prove the consolidation actually
happened.

- [ ] **Step 1: Close every row of the audit's §9 "code contradicts the docs" table.** For
  each, fix one side and write which side was changed:
  `03_SKELETON_STATUS.md` §10 vs §83-140 (L1) · Socket.IO in 8 files (L2/P7 — recommendation:
  **delete the claim**; FCM already covers the product need and this plan explicitly forbids
  introducing a socket layer) · `PHASE_05` (5 booking statuses documented, 7 in code) ·
  `MONEY_AND_LEDGER.md`'s `round2` and `markProcessing` transaction claims · `AGENTS.md`'s
  `isFrozen` invariant (per P1) · `postDoubleEntry`'s JSDoc (done in S4.1).
- [ ] **Step 2: Amend `REVISION_BUSINESS_RULES_AND_ARCHITECTURE.md`** — record that
  `COUPON_DISCOUNT` etc. are the code's authoritative entry-type names (D.13), and record the
  P1–P7 outcomes as a dated amendment (extending the S0 section).
- [ ] **Step 3: Remove the legacy path.** Delete `calculateCancellationOutcome`'s wrapper only
  if every caller now uses `computeSettlement` directly — **otherwise keep it**; it is a thin,
  well-named booking-specific adapter. Delete `settlement.differential.test.js` **only when
  the legacy implementation it differentiates against no longer exists.** Until then it is
  live regression protection.
- [ ] **Step 4: Run the consolidation audit.** Every one of these must hold:

```bash
grep -rn "readyState === 1" src/ --include=*.js            # exactly 1 (routes/index.js)
grep -rn "console.error" src/ --include=*.js               # 0
grep -rn "role === 'admin'" src/ --include=*.js            # 0
grep -rn "userIdStr !== clientIdStr" src/                  # 0
grep -rn "ReliabilityEvent" src/                           # 0 (if P2 = delete)
grep -rn "isFrozen" src/                                   # 0 (if P1 = delete)
grep -rn "FULL_REFUND_HOURS\|PARTIAL_REFUND_PERCENTAGE" src/  # 0
grep -L timezone src/jobs/*.cron.js                        # nothing
ls src/jobs/*.cron.js | wc -l                              # 6
npm run verify                                             # green, 137/137
```

- [ ] **Step 5: Re-run the full-system audit** against the simplified tree using
  `docs/AUDIT_2026_09_FULL_SYSTEM.md`'s own methodology. **Acceptance: no new CRITICAL or
  HIGH.** Record the result as `docs/AUDIT_2026_09_POST_SIMPLIFICATION.md`.
- [ ] **Step 6:** For each consolidation, confirm a test exists that **fails against the
  pre-consolidation commit** — the same evidentiary bar the remediation set for itself. Nine
  from S2, three from S3.2, one per ledger site from S4.1, one from S6.1. Record the list.

**Risk: VERY LOW.**

---

## H. MIGRATION PLAN

**Exactly one migration writes documents** (H.1). H.2 writes none — see below; H.3 is a
conditional post-release cleanup. No collection is dropped, no field is renamed, no document is
transformed destructively, and each has an exact inverse. There is no `SubscriptionOrder →
Payment` migration in this plan, and **no migration fabricates evidence the database does not
actually hold**.

**Universal rules for every migration below:**
1. Script lives in `scripts/`, is wired into `package.json`, and takes `--dry-run` as its
   **default**; writing requires `--apply`.
2. Dry-run first on a restored production snapshot; record the affected-document count.
3. Run **after** the code that tolerates both old and new values is deployed, never before.
4. Old fields are retained for **one full release**. A separate, later cleanup removes them.
5. Every script logs each document it would change, with its `_id`, before/after.

### H.1 `payoutStatus: 'paid' → 'not_owed'` (S3.3)

- **Type:** Backfill. **Additive** — the enum gains a value; nothing is removed.
- **Scope:** exactly the documents the `'paid'` overload created.

```js
// scripts/migrate-s3-payout-status.js
// Narrow ON PURPOSE. 'paid' means "disbursed" for every booking that reached a real Payout
// batch, and "nothing owed" only for a settled stylist no-show that never did. The absence
// of a payoutId is what distinguishes them.
const filter = {
  status: 'no-show-stylist',
  payoutStatus: 'paid',
  $or: [{ payoutId: null }, { payoutId: { $exists: false } }],
};
// --apply: Booking.updateMany(filter, { $set: { payoutStatus: 'not_owed' } })
```

- **Verify before applying:** `Payout.countDocuments({ bookingIds: { $in: [<matched ids>] } })`
  must be **0**. If any matched booking appears in a real payout batch, the filter is wrong —
  **stop and investigate manually.**
- **Order:** deploy the code (which tolerates both values — the `PAYOUT_ELIGIBILITY` and
  `processRefund` guards key on `'unpaid'`, so both `'paid'` and `'not_owed'` behave
  identically) **first**, then backfill.
- **Inverse:** `updateMany({payoutStatus: 'not_owed'}, {$set: {payoutStatus: 'paid'}})`.
- **Risk:** MEDIUM. **Verification:** after applying, no booking has
  `{status:'no-show-stylist', payoutStatus:'paid', payoutId:null}`; `findEligibleForPayout`
  returns the same set as before (it filters on `'unpaid'` and is unaffected by either value).

### H.2 `checkInAt` → `clientCheckInAt` / `stylistCheckInAt` (S3.4) — **NO BACKFILL**

**This migration was rewritten.** An earlier draft of this plan proposed copying the single
historical `checkInAt` into **both** per-party fields as a "conservative" backfill. **That is
not conservative — it is forgery.** The database does not record which party checked in;
writing the same timestamp into both fields asserts that *both* parties attended, for every
historical booking, and it writes that assertion durably into the collection that the no-show
anti-fraud gate reads. It would reproduce the exact L5 hole the task exists to close, make it
permanent in the data rather than merely present in the code, and do so under a label that
makes it look deliberate and safe. **Do not fabricate historical attendance evidence to make a
migration convenient.**

- **Type:** **Additive schema only. Zero documents written. No script.**
- The two new fields are simply absent on every pre-existing booking, which is the truthful
  representation: *we do not know who checked in.*

**Backward compatibility — a time-boxed, code-side legacy fallback.** Historical bookings must
not have a legitimate no-show report stranded, so the gate accepts the old evidence for
bookings that predate the deploy, and only those:

```js
// no-show.service.js — the gate. CHECKIN_SPLIT_AT is the deploy timestamp, from env/config.
const reporterCheckIn = userId === clientId ? booking.clientCheckInAt : booking.stylistCheckInAt;

// Legacy fallback, deliberately time-boxed. Bookings created before the per-party split have
// only the shared `checkInAt`, which cannot say WHO attended -- so for those, and only those,
// the old (weaker) rule still applies. This is the pre-existing behaviour for pre-existing
// data, not a new weakening, and it expires on its own: a booking scheduled before the split
// reaches a terminal status within the grace + response window, after which no report can be
// filed against it at all. Delete this branch (and CHECKIN_SPLIT_AT) one release later --
// tracked as a dated TODO, asserted by the test below.
const legacyCheckIn = booking.createdAt < CHECKIN_SPLIT_AT ? booking.checkInAt : null;

if (!reporterCheckIn && !legacyCheckIn) {
  throw new ApiError(400, 'You must check in at the meeting location before reporting the other party as a no-show.');
}
```

- [ ] Test that the fallback is **inert for new bookings**:

```js
it('the legacy check-in fallback does not apply to bookings created after the split', async () => {
  const b = await Booking.create({ /* createdAt: after CHECKIN_SPLIT_AT */, checkInAt: new Date(),
                                   clientCheckInAt: null, stylistCheckInAt: new Date() });
  await expect(noShowService.fileNoShow(clientUser, b._id, {})).rejects.toThrow(/must check in/i);
});
```

- **`checkInAt` is retained and still written**, because `reliability.service.js:58-65` reads
  it for punctuality and `booking.dto.js:41` projects it into the API response.
- **Inverse:** none needed — nothing was written. Reverting the code restores today's gate.
- **Trade-off, stated plainly:** bookings created before the deploy keep today's weaker gate
  for a bounded window (hours to days, since a no-show can only be filed inside the grace and
  response windows around a scheduled time). The alternative — backfilling both fields —
  extends that weakness to **every historical booking, permanently, as recorded fact.** The
  bounded-window option is strictly safer and is the one this plan takes.
- **Risk:** VERY LOW. **Verification:** `Booking.countDocuments({clientCheckInAt: {$ne: null}})`
  is **0** immediately after deploy and grows only from new check-ins; no booking ever has both
  per-party fields set from a single check-in (asserted by S3.4 Step 4).

### H.3 `isFrozen` / `frozenReason` / `frozenAt` cleanup — **only if P1 = delete**

- **Type:** Field removal (`$unset`). Runs **after** a full release with the code removed.
- **Order:** (1) deploy code with the fields and the index gone; (2) confirm no reader remains
  (`grep -rn "isFrozen" src/` → 0); (3) drop the `{isFrozen, payoutStatus}` index; (4) `$unset`
  the three fields.
- **Inverse:** none needed — the fields were never written, so no data is lost. **Verify that
  claim on a production snapshot before running:**
  `Booking.countDocuments({isFrozen: true})` must be **0**.
- **Risk:** VERY LOW, conditional on that count being zero. **If it is not zero, P1 is wrong —
  something writes the field and the module is not dead. Stop.**

### Migrations explicitly NOT performed

| Not done | Why |
|---|---|
| `SubscriptionOrder → Payment` | D-1. Money path + backfill for one fewer model; §0.1 C2 removed its safety argument |
| `BlockedWord` + `BlockedDomain` → `BlockedTerm` | O-1. Two-collection merge, no correctness gain |
| `REQUEST_STATUS.DECLINED → CLOSED` | P5, product decision, excluded |
| Operational models → integer minor units | Deliberate design (`MONEY_AND_LEDGER.md`); a large risky change for a 1-piastre rounding nuance |
| TTL index on `User.otpExpiresAt` | **Would delete user accounts** (§0.1 C1) |

---

## I. TESTING STRATEGY

The evidentiary bar is the one this repository already set for itself in the remediation:
**for every consolidation, a test that fails against the pre-consolidation code.**
"It should still work" is not acceptable evidence anywhere in this plan.

### I.1 Group 1 — Regression (must pass **unchanged**, every phase)

The entire existing suite. No assertion in any of these may be edited to accommodate a
refactor; if one needs editing, behaviour changed and the task is wrong.

Highest-signal members: `tests/unit/cancellation.service.test.js` ·
`no-show.policy.test.js` · `no-show.service.test.js` · `no-show.admin-resolve.test.js` ·
`dispute.resolution.test.js` · `dispute.arbitration.test.js` · `payment.service.test.js` ·
`payment.refund-and-webhook-failure.test.js` · `payout.service.test.js` ·
`payout.netting.test.js` · `ledger.service.test.js` · `status.migration.test.js` ·
`system-coherence.test.js` · `entitlement.service.test.js` · `moderation.scanner.test.js` ·
`blocked-words.test.js` · `auth.service.test.js` · `upload.service.test.js`.
Integration: `no-show-refund.test.js` · `cancellation-ledger.test.js` ·
`ledger-dual-write.test.js` · `ledger.reconciliation.test.js` · `payments.test.js` ·
`bookings-scheduling.test.js` · `booking.completion-race.test.js` ·
`booking.broadcast-race.test.js` · `subscription-checkout.test.js` ·
`subscription-grant-transaction.test.js` · `subscription-renewal-race.test.js` ·
`subscription.one-active-invariant.test.js` · `moderation-interceptor.test.js` ·
`users-verification.test.js` · `payout.authorization.test.js` · `token-revocation.test.js`.

### I.2 Group 2 — Differential (S1, gates S3)

`tests/unit/settlement.differential.test.js`. 7 prices × 9 hour offsets × 3 roles = **189**
cancellation comparisons against the legacy function, plus the no-show stylist-share and
dispute-split reproductions. **Byte-equality on every returned field.** Green before S3 starts
and green after every S3 commit. **This is the proof that "same business rules" is true.**

### I.3 Group 3 — Financial invariants (new, permanent)

- `refundAmount + stylistCompensationAmount + platformFeeAmount === price` (±1 piastre) for
  every branch of `computeSettlement`.
- No component is ever negative.
- `platformFee + stylistPayout === amount` on every `Payment` after `processRefund`.
- After any settled booking: `Σ DEBIT === Σ CREDIT` for that `bookingId` in `LedgerEntry`.
- Every ledger write carries a non-empty `idempotencyKey`; a replay returns the existing row
  and creates nothing.
- The platform never owes more than it retained (`processRefund`'s clamp).

### I.4 Group 4 — Race and concurrency (new)

| Race | Test | Phase |
|---|---|---|
| Cancel vs. complete | Concurrent `cancelBooking` + `confirmCompletion`; exactly one wins, the other 409s | S2 |
| Stale-read overwrite | Nine tests, one per migrated writer: the status changes between the read and the write; the loser must not overwrite | S2 |
| Double cancellation | Two concurrent `cancelBooking`; exactly one refund, one penalty, one ledger pair | S2 |
| Double no-show settle | Two concurrent `resolveNoShow`; one settlement, one penalty (E11000 tolerated) | S3 |
| No-show CAS loss | The booking completes mid-`resolveNoShow`; **the schedule block survives** (NS1) | S3 |
| Refund failure | `processRefund` throws; `payoutStatus` stays `unpaid`, `refundError` durable (NS2) | S3 |
| Ledger failure | `postDoubleEntry` throws; `Penalty` and `payoutStatus` roll back (NS3) | S3 |
| Payout retry | Force one `WriteConflict`; `createdPayouts` correct, `PAYOUT_CREATED` once per payout (M5) | S4 |
| Webhook replay | Deliver the same success callback twice, for both booking and subscription purposes | S4, S5 |
| Cron vs. API | A request is `CANCELLED` mid-autopause-sweep; it stays `CANCELLED` (M9) | S6 |
| **Crash after refund** | Kill between `processRefund` and the settlement transaction; the sweep finds the booking, the resume completes it, and **the penalty/coupon counts are 1, not 2** (S3.2a, NS5) | S3 |
| **Ambiguous refund** | Payment left in `REFUNDING`; the resume throws 409, records the error, and **makes no provider call** | S3 |
| **Sweep blindness** | Assert `findPendingNoShowReports` returns **empty** for a claimed-but-unfinished booking, and `findUnfinishedNoShowSettlements` returns it — the two queries must not overlap | S3 |
| **Bounded retry** | After `maxAttempts` the booking stops being swept and is logged at `error`; it is never retried forever | S3 |

### I.5 Group 5 — Corpus (S4, moderation)

`tests/unit/moderation.corpus.test.js`. Two frozen lists. `MUST_DETECT` must be **100 %** both
before and after the fallback removal. `MUST_NOT_DETECT` must be **0 %** after (it fails
before — that failure is the finding). A single lost detection blocks the commit.

### I.6 Group 6 — Migration verification (S3)

**Only H.1 has a script.** It has a test that seeds the exact pre-state, runs in `--dry-run`
(asserting zero writes), runs with `--apply`, asserts the post-state, runs the inverse, and
asserts the original state is restored. It also asserts the mandatory pre-check —
zero overlap between the matched bookings and any real `Payout`.

**H.2 has no script, and that is the assertion:** a test confirms that immediately after the
S3.4 deploy `Booking.countDocuments({ clientCheckInAt: { $ne: null } })` is **0**, and that no
single check-in ever sets both per-party fields. H.3 runs only if P1 = delete, gated on
`Booking.countDocuments({ isFrozen: true })` being **0**.

### I.7 Group 7 — The plan-level audit (S7)

The greps in S7 Step 4, plus `npm run verify`, plus the "fails against the pre-consolidation
commit" list from S7 Step 6.

---

## J. ROLLBACK STRATEGY

| Phase | Rollback | Data to undo | Window |
|---|---|---|---|
| **S0** | `git revert` the docs commit | none | instant |
| **S1** | `git revert` the four commits; delete the files. **Nothing references them** except `booking.repository.js`'s single import, which reverts with them | none | instant |
| **S2** | Per-commit `git revert`. Each writer is independent; the S1 primitive can stay in place under a partial rollback | none | instant |
| **S3.1** | Revert; `computeSettlement` becomes unused but harmless | none | instant |
| **S3.2** | Revert the restructure commit. The refund's own `REFUNDING` CAS is untouched by this phase, so no in-flight refund is affected | none | instant |
| **S3.2a** | Revert; `settlementCompletedAt` / `settlementAttempts` become inert and the cron's second pass disappears. **Reverting restores the crash window**, so revert this only together with S3.2 | none (additive fields, no backfill) | instant |
| **S3.3** | Revert code, then run H.1's inverse (`not_owed → paid`) | H.1 | one release |
| **S3.4** | Revert code; `checkInAt` is still written, so the gate degrades to today's behaviour rather than breaking. **No data to undo — H.2 writes nothing.** Optionally `$unset` the two additive fields | none | instant |
| **S3.5** | Revert. Already-issued coupons stay valid — **do not void them**; they are a user-facing promise the docs already made | none | instant |
| **S4.1** | Per-site revert. Idempotency keys are unchanged, so no entry is orphaned or duplicated by reverting | none | instant |
| **S4.2** | Per-file revert | none | instant |
| **S4.3** | Revert restores the deleted code. **If H.3 already `$unset` the `isFrozen` fields**, restoring the code restores the schema defaults (`isFrozen: false`), which is the value every document held anyway | H.3 (no-op if the pre-check was honoured) | one release |
| **S4.4** | Revert. KYC reads go back to public_ids; upload 403s go back to 201s | none | instant |
| **S5** | Per-commit revert | none | instant |
| **S6** | Per-job revert. Index drops are safe and online | index builds | instant |
| **S7** | Revert docs | none | instant |

**Rollback invariants.** No phase drops a collection, renames a field, or writes a value the
previous release cannot read. Any phase can be reverted without reverting a later one, except
that S3 depends on S1's primitives and S2's CAS being present.

---

## K. RISK REGISTER

| ID | Risk | Category | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|---|---|
| **K1** | A `fromStates` list in S2 is wider than the writer's original guard, permitting a transition that was previously refused | Regression | MEDIUM | **HIGH** — a real money outcome changes | The per-writer table in S2 fixes each list explicitly; `fromStates` must equal the pre-read guard's admitted set; nine new illegal-transition tests; one writer per commit | LOW |
| **K2** | `computeSettlement` differs from the legacy arithmetic in an untested corner (a price with >2 decimals, a boundary hour) | Financial | LOW | **VERY HIGH** — wrong refunds | 189-case differential test with irregular prices (`100.01`, `333.33`, `777.77`, `4999.99`) and the exact 24.0 boundary; the legacy function survives until S7 | VERY LOW |
| **K3** | H.1's backfill matches a booking that **was** really paid out | Migration / Financial | LOW | **VERY HIGH** — a stylist's payout record is contradicted | The filter requires `status:'no-show-stylist'` **and** no `payoutId`; a mandatory pre-check asserts zero overlap with `Payout`; `--dry-run` default; exact inverse | VERY LOW |
| **K4** | S3.2's transaction restructure changes no-show settlement ordering in a way that breaks idempotency on retry | Concurrency / Financial | LOW | HIGH | Every financial write keeps its deterministic idempotency key; the E11000 tolerance on `Penalty` is preserved verbatim; three new partial-failure tests | LOW |
| **K5** | S4.1 moves a ledger pair inside a transaction that also contains a provider call | Financial | LOW | **VERY HIGH** — a slow provider holds the transaction; an abort cannot un-refund | Stated as a hard constraint in S3.2 and repeated in S4.1's table: the provider call stays outside. Review gate: no `provider.` call may appear inside a `withTransaction` callback — add this as a `system-coherence` grep assertion | VERY LOW |
| **K6** | S-12 removes a **real** detection along with the false positives | Security / Revenue | MEDIUM | HIGH — disintermediation is revenue-existential | The `MUST_DETECT` corpus is frozen before the change and must stay at 100 %; a single loss blocks the commit | LOW |
| **K7** | S4.4's upload role matrix forbids a folder/role pair a real flow needs | Regression | MEDIUM | MEDIUM — a user journey breaks with a 403 | The matrix must be confirmed against `docs/04_ROUTES.md` and the real flows **before** implementing; the note in S4.4 calls this out explicitly | LOW |
| **K8** | S6.3's timezone change shifts sweep times in production by the UTC offset on first deploy | Operational | **CERTAIN** | LOW | This is the intended fix. Flag to ops in the release notes; the affected sweeps are idempotent | NONE |
| **K9** | S3.5 starts incurring a real coupon cost the platform has never actually paid | Financial (business) | **CERTAIN** | MEDIUM | It is a documented rule (`REVISION…md:635`) that was silently not executing. **PO must acknowledge in S0** before S3.5 ships; the 150 EGP cap and 14-day expiry bound the exposure | NONE |
| **K10** | S4.4's KYC signing exposes documents more broadly than intended | Security / Privacy | LOW | **HIGH** — identity documents | URLs are minted per request, expire in 1 hour, are never persisted, and are produced **only** on the admin/operator read path; a test asserts the owner's own profile read is unsigned | LOW |
| **K11** | The two source-grepping tests (`system-coherence`, `status.migration`) are edited casually to make a refactor pass | Process | MEDIUM | HIGH — a real invariant is silently disabled | §0.2 names them; every edit to either must be in the same commit as the code it describes and justified in the commit body | LOW |
| **K12** | P1/P2/P4 are never decided and S4 stalls or proceeds on a guess | Process | MEDIUM | MEDIUM | S0 is a hard gate. S4.3's dead-code items are individually skippable — the rest of S4 does not depend on them | LOW |
| **K13** | `withTransaction` retries a non-idempotent callback (`session.withTransaction` retries on `WriteConflict`) | Concurrency | LOW | HIGH — a duplicated side effect | The helper's doc comment states the requirement; S4.2's payout task exists precisely because M5 is this bug already present. Review gate: no `eventBus.emit` and no external call inside a `withTransaction` callback | LOW |
| **K14** | Test-suite runtime grows past CI limits with the 189-case differential and the corpus | Operational | LOW | LOW | Both are pure unit tests with no DB; expected added runtime is seconds | NONE |
| **K15** | **The no-show crash window**: the provider refunds, the process dies before the settlement transaction, and nothing ever finishes — no penalty, no coupon, `payoutStatus` uncorrected, the schedule block never freed, and **no alarm fires** (debits still equal credits) | Financial / Reliability | MEDIUM (this is a real crash window, not a theoretical one) | **VERY HIGH** — silent, permanent, unreconcilable loss | **S3.2a is the mitigation and is mandatory**: `settlementCompletedAt` marker, resume-aware refund step with Paymob idempotency guard, bounded retry via the existing 15-minute cron's second pass with cluster-mode atomic claim (`claimSettlementResume`), batched state-driven `findUnfinishedNoShowSettlements` + index. Verified pre-existing today (`no-show.service.js:184-190` early-returns; `booking.repository.js:242-249` cannot see a claimed booking; no `REFUNDING` sweep exists) | LOW |
| **K16** | A resume double-refunds a client because the payment was left in the ambiguous `REFUNDING` state | Financial | LOW | **VERY HIGH** | The resume path **fail-stops** on `REFUNDING`: it records, alerts and throws 409 rather than guessing. It never calls the provider from that state. A test asserts no provider call is made | VERY LOW |
| **K17** | Backfilling `checkInAt` into both per-party fields fabricates attendance evidence for every historical booking, permanently preserving the L5 fraud hole in data | Security | **WAS CERTAIN** if the earlier H.2 had been executed | HIGH | **Eliminated by design**: H.2 now writes **zero documents**. Historical bookings keep a time-boxed, code-side legacy fallback that expires with the pre-cutoff bookings themselves | NONE |
| **K18** | A future booking route calls `assertBookingParticipant` without stating `allowAdmin` and silently grants admin bypass | Security | MEDIUM | HIGH | The default is `false` (fail closed), a test asserts the omission denies, and a `system-coherence` assertion requires the option to be stated literally at every call site | VERY LOW |

**Risks explicitly avoided by scope decisions:** a `SubscriptionOrder → Payment` data
migration on the money path (D-1) · a moderation two-collection merge (O-1) · a booking-state
reduction (§E.1) · an authentication refactor (§B DO NOT TOUCH) · a TTL index that would delete
user accounts (§0.1 C1) · an operational-model move to minor units (§H).

---

## L. FINAL RECOMMENDATION

### What should be implemented now

**S0 → S7, in order, with S5 and S6 free to run in parallel after S4.**

| Phase | Content | Risk |
|---|---|---|
| **S0** | Baseline + the four blocking product decisions (P1–P4). **No code.** | VERY LOW |
| **S1** | `withTransaction`, `assertBookingParticipant`, `computeSettlement`, `BOOKING_TRANSITIONS`, `transitionStatus`, and the **differential proof**. Nothing calls them yet | VERY LOW |
| **S2** | The nine booking writers and the ~20 ownership checks migrate. One writer per commit | MEDIUM |
| **S3** | `computeSettlement` adopted at all three sites; `resolveNoShow` made atomic; `not_owed`; per-party check-in; the missing coupon | **MEDIUM-HIGH** |
| **S4** | Ledger pairs sessioned, `withTransaction` adopted (incl. M5), dead code deleted, KYC + upload authorization fixed | MEDIUM |
| **S5** | Subscription webhook amount verification + reconcilable subscription ledger entries | LOW |
| **S6** | 7 crons → 6, timezones, two indexes, autopause CAS, honest PM2 comment | LOW |
| **S7** | Documentation truth + the consolidation audit | VERY LOW |

**If appetite is limited, the minimum viable scope is S0 + S1 + S2 + S3.** That is where
essentially all the correctness value sits: the nine divergent guards and the worst
partial-failure surface in the repository. S4–S6 are cheaper and lower-risk but individually
less valuable.

### What should be deferred

`SubscriptionOrder → Payment` (D-1) · Redis cron leader election (D-2) · Redis-backed
`tokenVersionCache` (D-3) · the entitlement `capacity()` TOCTOU fix (D-4) · correlation IDs,
an alerting sink and a coverage threshold (D-5) · `BlockedWord`+`BlockedDomain` merge (O-1) ·
the notification listener table (O-2) · the Swagger relocation (O-3) · L4's reliability scoring
gaps · M6/M8/M10/M19/M21/M26/M29 (real bugs, independent of consolidation — keep them in the
audit backlog).

### What should never be simplified

Authentication and session security · authorization and `restrictTo` · webhook HMAC **and**
amount verification · every idempotency key and every unique/partial-unique index · money
arithmetic, `round2`, the fee identity, the retained-amount clamp, and the decimal-EGP ⟂
integer-piastre boundary · `LedgerEntry` and `SubscriptionHistory` immutability · the
`Penalty` debt model · the three-layer offer-acceptance guard · the two-stage completion CAS ·
the in-transaction `ScheduleBlock` overlap check · `uniq_active_subscription_per_user` ·
atomic `UsageCounter.consume()` · the `REFUNDING` pre-provider claim · the four-branch
cancellation matrix · the two no-show statuses and their distinct money · the preventive
moderation gate and the 3-strike ladder · `NODE_ENV` with no default and the placeholder-secret
boot refusal · the nightly reconciliation sweep · Firestore chat · **and the dense rationale
comments, which are this repository's single best asset.**

### What requires a product decision

**Gating only their own S4.3 deletion item:** P1 `safety/` · P2 `reliability/` · P4 `past_due`.
**Gating nothing in this plan (backlog only):** P3 proration (M28).
**Non-blocking, recorded only:** P5 `REQUEST_STATUS.DECLINED` · P6 `blocked` vs `suspended` ·
P7 Socket.IO (resolved in S7; recommendation: delete the claim).
**Acknowledgement required before S3.5 ships:** K9 — the late-stylist-cancellation coupon is a
real, documented cost that has never actually been incurred.

### Effect on Phase 15 readiness

Phase 15 remains **untouched and unstarted** by this plan. Its readiness improves in three
specific ways and in no others:

1. An AI module that calls booking, wardrobe and entitlement services will build on **one**
   transition primitive rather than nine divergent guards, which narrows the blast radius of
   every AI-initiated booking action.
2. `src/modules/ai/` stops being an empty directory next to a dead `reliability/` module, so
   the module list stops carrying two "is this real?" questions.
3. M23 (unvalidated Gemini output written into un-enumed fields) is **not** fixed here — it is
   deliberately left to Phase 15, which wants a Zod-validated model contract anyway.

Phases S1–S6 touch `wardrobe/` **only** if S4.2's `withTransaction` adoption reaches it
(it does not — `wardrobe.service.js` has no `readyState` guard). **No AI work, no embeddings,
no RAG, no vector search, no agent orchestration is planned, designed or begun.**

---

## PLAN COMPLETE

```text
PLAN COMPLETE

Source files modified: 0
Phase 15 started: NO

Recommended execution scope:
  S0 → S1 → S2 → S3 → S4 → (S5 ∥ S6) → S7
  Minimum viable scope if appetite is limited: S0 + S1 + S2 + S3

Highest-risk proposal:
  S3 — the no-show settlement restructure (now including the mandatory S3.2a
  resume mechanism) plus the payoutStatus 'not_owed' enum widening and its
  backfill (H.1). It is money, a schema change and a data migration in one phase.
  It is scheduled behind S1's differential proof and S2's CAS primitive precisely
  because it is not safe without them. S3.2 without S3.2a is NOT safe to ship:
  it would trade a noisy partial-failure surface for a silent permanent one.

Proposal I explicitly recommend NOT implementing:
  The SubscriptionOrder -> Payment merge. The prior assessment ranked it the
  highest-value structural merge, but its main safety argument — "it gives the
  subscription path the CAS the booking path already has" — is stale: I verified
  the CAS is already there (subscription.service.js CAS-claims pending ->
  processing, reverts to pending on grant failure, writes paid only after the
  grant succeeds). What remains is a data migration on the money path in exchange
  for one fewer model. Both real defects it was going to fix — no amount
  verification on the subscription webhook, and subscription ledger entries being
  invisible to the reconciliation cron — are fixed directly in S5 with no
  migration at all.

  Runner-up: a Mongo TTL index on User.otpExpiresAt to replace otp-cleanup.cron.
  A TTL index deletes the whole document, so this would delete user accounts ten
  minutes after an OTP is issued. Delete the cron; add no index.

Final decision:
  PROCEED WITH RESTRICTIONS
```

---

*Planning document only. No source files were modified. No migration was run. Phase 15 was not
started. No business rule, state, API contract or financial safeguard was changed by producing
this plan.*
