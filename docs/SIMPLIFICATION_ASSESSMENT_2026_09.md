# Murafiq — Full Simplification Assessment

> **Date:** 2026-09-11 · **Branch inspected:** `remediation/audit-2026-09-p0-p3` @ `e894088`
> **Type:** assessment and migration plan only. **No source was modified.**
>
> Reads against, and defers to in this order: (1) `REVISION_BUSINESS_RULES_AND_ARCHITECTURE.md`
> (latest explicit business-rule revision, R0–R12), (2) the phase decisions, (3) the current
> implementation, (4) older documentation. Where a doc and the code disagree, the code was
> re-read at `file:line` before any claim below was accepted.

---

## 0. ANSWER

# **YES — SIMPLIFY**

But the word needs qualifying immediately, because the obvious reading of it is wrong here.

**Murafiq's problem is not that it is over-designed. It is that it is under-consolidated.**

The 2026-09 audit looked for over-engineering and found three items, of which it recommended
changing one. That finding holds up: I re-checked it independently and agree. There is no
speculative abstraction layer, no premature microservice boundary, no generic framework, no
event-sourcing, no CQRS, no DI container. The layering (`Route → Validator → Controller →
Service → Repository → Model`) is real, uniform, and cheap.

What there *is*, measurably:

- **the same decision implemented many times in many places** — the booking status guard exists
  in nine writers with divergent rules; the participant/ownership check is copied ~20 times and
  the copies disagree about admin bypass; the `readyState === 1` transaction guard is copied
  **9** times and its fallback branch is dead by construction; the ledger dual-write is
  hand-rolled at 4+ call sites instead of going through the `postDoubleEntry` primitive that
  already exists in the same files.
- **entities and states that exist but nothing drives** — `src/modules/reliability/`
  (`ReliabilityEvent`, a complete append-only model with indexes) has **zero writers and zero
  readers**; `Booking.isFrozen` is read by the payout eligibility query and has **no writer
  anywhere**; `PAYMENT_STATUS.CANCELLED` has **0** references; `Subscription.status: 'past_due'`
  is declared and never set; `CANCELLATION_POLICY.FULL_REFUND_HOURS` /
  `PARTIAL_REFUND_PERCENTAGE` are a second constants source no code reads;
  `src/modules/safety/` and `src/modules/ai/` are `.gitkeep` only.
- **infrastructure that carries one job and one load-bearing assumption** — Redis is connected
  and used for exactly two things (the wardrobe BullMQ queue, and since Round 2, production rate
  limiting). Seven separate in-process `node-cron` jobs, none with a distributed lock, none with
  a `timezone` option despite three of them commenting "Cairo time". PM2 `instances: 1` is
  silently load-bearing for cron re-entrancy, the token-revocation cache, and the schedule sweep.
- **22% of the source tree is Swagger annotation** — 5,710 of 25,754 lines live in
  `*.swagger.js` files, with `admin/` alone at 826 annotation lines against 688 lines of code.

That is accidental complexity, and it is worth removing. It is also the *low-risk* kind: every
one of those consolidations makes the system strictly smaller and strictly more correct, because
in each case the duplicated copies already disagree with each other and the disagreement is
itself the bug class the audit kept finding.

**What must NOT be simplified is the business-rule surface.** The specific reduction the brief
floats — `PENDING → ACCEPTED → COMPLETED` plus `CANCELLED` — was tested against the actual rules
and **fails**. It is not a simplification; it is a product change that destroys money
correctness. §2.3 shows exactly where. The four-branch cancellation matrix, the two no-show
statuses, the double-entry ledger and the penalty-debt model are each traceable to a written PO
decision in §C/§H of the Business Rules Revision, and each encodes a distinct financial outcome
that has nowhere else to live.

So the recommendation is: **simplify the implementation aggressively, and leave the rule set
alone except for a short, itemized list of genuinely-dead states.**

Estimated complexity reduction: **MEDIUM-to-HIGH on implementation surface, LOW on business
rules.** Production-readiness impact: **improves it** — see the final Decision section.

---

## 1. What the repository actually is (measured, not estimated)

| Metric | Value | How measured |
|---|---|---|
| JS source files under `src/` | 231 | `find src -name '*.js'` |
| Total source lines | 25,754 | `wc -l` over the above |
| …of which Swagger annotation | **5,710 (22.2%)** | `*.swagger.js` |
| Modules | 24 dirs, **2 empty** (`ai/`, `safety/`) | `.gitkeep` only |
| Mongoose models | 25 | `*.model.js` |
| Services / Repositories / Controllers | 25 / 24 / 19 | file count |
| HTTP endpoints | 137 (all documented, 137/137) | `npm run validate:openapi` |
| Test files / tests | 113 / 696, all passing | remediation Appendix |
| `node-cron` jobs | 7 | `src/jobs/*.cron.js` |
| BullMQ queues / workers | 1 / 1 | wardrobe classification |
| Runtime dependencies | 31 | `package.json` |
| Open audit findings | 44 (28 MEDIUM, 16 LOW/INFO) | remediation §12 |
| Distinct enumerated lifecycle states | ~61 across 13 state machines | §3 |

Largest modules by non-Swagger code: `subscriptions` 2,190 · `bookings` 2,110 ·
`payments` 1,429 · `moderation` 1,274 · `stylists` 958 · `requests` 910.

**This is a mid-sized, coherent modular monolith.** It is not bloated for what it does. The
25,754 lines cover a two-sided marketplace with escrow, disputes, arbitration, a subscription
tier system, a moderation pipeline, chat, KYC, and payouts. The issue is distribution of that
code, not its volume.

---

## 2. Domain-by-domain analysis

### 2.1 Authentication

**Current design.** `auth.service.js` (472 lines) + `session.repository.js` (123) +
`auth.middleware.js` + `tokenVersionCache.js` + `authCookies.util.js` +
`auth-rate-limiter.middleware.js`.

States and mechanisms: bcrypt (12 rounds) password hash · JWT access (15m, carries `tv`) +
refresh (30d) with **distinct secrets** · per-device `sessions[]` subdocument array holding
SHA-256 refresh hashes, capped via atomic `$slice` (`MAX_SESSIONS_PER_USER`, default 10) ·
refresh rotation via an atomic `$elemMatch` CAS returning `null` to the loser · reuse detection
revoking only the affected session · a `jti` nonce preventing byte-identical rotations inside one
second · a global `tokenVersion` stamp bumped on password change/reset, logout-all, admin
revocation, suspension, blocking and moderation enforcement · a 30s-TTL `tokenVersionCache` ·
dual-transport delivery by `X-Client-Type` (web → httpOnly cookies, mobile → JSON body) ·
6-digit OTP with 10-minute TTL and a 5-attempt lockout · Google Sign-In verifying the ID token
server-side and auto-linking by verified email · account-aware (not IP-only) rate limiting on
OTP routes, Redis-backed in production.

**Assessment: this is the strongest code in the repository. Do not touch the mechanism.**

The audit found no IDOR, no mass assignment, no cross-user leak. The two CRITICAL auth defects
(X3 dead OTP lockout, X6 `NODE_ENV` defaulting to development) are both fixed and both were
*missing enforcement*, not excess complexity. Every element above answers a named attack:
distinct secrets stop refresh-as-access forgery; the CAS stops concurrent-refresh double-issue;
`tokenVersion` is the only revocation axis that works on a stateless access token; SHA-256 rather
than bcrypt is required because a salted hash cannot be matched by equality, which would make the
single-round-trip atomic rotation impossible (the code says exactly this, in a comment).

**Simplify (cosmetic only):**

| Item | Change | Risk |
|---|---|---|
| `ACCOUNT_STATUS` has 5 values; `blocked` and `suspended` are checked at 7 sites with near-identical handling and `deleted` overlaps `isDeleted`/`deletedAt` | Document the semantic difference, or collapse `blocked` into `suspended` with a `suspensionReason`. **Do not collapse without a product decision** — the moderation ladder writes `suspended` at strike 3 and admin ban writes `blocked`, which is a real distinction | LOW |
| Enumeration oracles on `/auth/resend-otp` and `/auth/register` (M19) | Make them uniform, matching `forgotPassword` six functions away | LOW — a *fix*, not a simplification |
| Google-auth suspension re-check duplicated in `login` and `googleLogin` | One `assertLoginAllowed(user)` helper | LOW |

**Nothing else in auth should be reduced.** OTP, refresh rotation, lockout, session cap and the
dual transport are all load-bearing.

---

### 2.2 Users / KYC / Verification

**Current design.** One `User` model (127 lines) carrying identity, auth credentials
(`select: false`), profile, GeoJSON location, `fcmTokens`, client rating aggregates, and an
embedded `verification` subdocument: `status` ∈ `unverified | pending | verified | rejected`,
`documents[]` (4 enumerated types), `rejectionReason`, `reviewedBy`, `reviewedAt`. Required doc
sets differ by role (client 3, stylist 4 including `police_clearance_certificate`) and are
enforced in the **service**, not the schema. Verification gates the core loop at 4 points.
`operator` is a role scoped to exactly 3 verification routes. Soft delete is the only delete.

**Assessment: already minimal. Four states is the floor for a human-review workflow** — you need
"not started", "awaiting a human", "passed", "failed with a reason". There is no fifth state and
no separate KYC entity. Stylist verification is not a separate workflow; it is the same four
states with a longer required-document list. Police clearance is one more entry in
`documents[].type`, not a state.

**The real problem here is not complexity — it is a dead path.** `getSignedKycUrl` is exported
and **never called** (M16); documents are stored `authenticated` on Cloudinary and the raw
`documentRef` is written into a field named `url`. **Reviewers cannot actually view the documents
they are being asked to approve.** That is a missing wire-up, not a simplification target, and it
is arguably the highest-value open MEDIUM in the repository because the entire verification
product capability is inert without it.

**Simplify:** nothing structural. **Fix:** wire the signed-URL path; add per-folder upload
authorization (M15 — today any authenticated user of any role can write to `kyc-documents`).

---

### 2.3 Requests / Offers / Booking

**Current design.**

- `Request`: 6 states (`OPEN`, `PAUSED`, `CLOSED`, `FULFILLED`, `CANCELLED`, `DECLINED`),
  `visibility` ∈ `direct | broadcast`, derived `offerCount` / `firstOfferAt`, `pauseCount`,
  `autoPauseAt`, `expiresAt`. Deliberately **no** `OFFERED` state — "has offers" is a count.
- `Offer`: 6 states (`PENDING`, `ACCEPTED`, `REJECTED`, `WITHDRAWN`, `CLOSED`, `EXPIRED`),
  24h expiry + 30-day long-stop, partial-unique `{requestId, stylistId}` on
  `{PENDING, ACCEPTED}`.
- `Booking`: 7 states (`confirmed`, `in-progress`, `completed`, `cancelled`, `disputed`,
  `no-show-stylist`, `no-show-client`) plus a **separate** `payoutStatus` axis
  (`unpaid | processing | paid`), plus `isFrozen`, plus `noShowDetails` (8 fields),
  `disputeDetails` (5), `disputeResolution` (5).
- Concurrency: offer acceptance is one transaction with a retry loop and **three** independent
  guards (Request CAS, unique `Booking.offerId`, unique `Booking.requestId`), plus a
  `ScheduleBlock` overlap check inside the same transaction. Completion is a **two-stage CAS**
  (`setCompletionConfirmation` → `promoteToCompleted`).

**Does the brief's proposed reduction work?** `PENDING → ACCEPTED → COMPLETED` + `CANCELLED`.

**No. Verified against the rules, it breaks four things:**

1. **`in-progress` is load-bearing for money.** It is set by geolocated check-in, and it is the
   *only* thing that stops a client from letting the stylist finish the job and then cancelling
   for an 80% refund (audit X10, now guarded). Merge it into ACCEPTED and that fraud path
   reopens.
2. **`disputed` cannot be a flag.** Arbitration resolves to exactly one of two outcomes, and
   cancellation, no-show filing and payout eligibility all read the status directly. As a
   boolean, every one of those guards has to be rewritten as a compound predicate — more
   conditions, not fewer.
3. **The two no-show statuses carry different money.** `no-show-stylist` = client 100% /
   platform 0% / stylist 0% / stylist penalty 10% / coupon issued. `no-show-client` = client 60%
   / platform 20% / **stylist 20%** / no penalty / no coupon. `CANCELLED` = 97/3 or 80/20,
   stylist zero. Encoding these as `cancelled + reason` — which the Revision explicitly
   considered and rejected in §F.3 — makes them **unqueryable**: `PAYOUT_ELIGIBILITY` matches
   `{status: 'no-show-client'}` specifically, because a client no-show is the one non-completed
   booking a stylist still gets paid for.
4. **`completed` ≠ `no-show-client` for `completedAt`.** The payout hold window anchors on
   `completedAt` for one and `noShowDetails.confirmedAt` for the other. Collapsing the states
   collapses two different clocks.

**Conclusion: 7 booking states is the correct number and the Revision already reasoned it out.**
What is wrong is not the count — it is that **the transition rules for those 7 states are
implemented nine separate times** with divergent guards. That scatter is the direct cause of X4
(admin resurrects any booking), X9 (terminal overwrite) and X10 (`in-progress` cancellable). All
three are now fixed, individually, at the nine sites — which means the *next* writer has nine
places to get wrong.

**Highest-leverage simplification in the entire repository:**

```
BOOKING_TRANSITIONS = { confirmed: ['in-progress','cancelled','disputed','no-show-*'], ... }
bookingRepository.transition(id, fromStates[], patch, session) -> doc | null
```

One map, one repository primitive, nine call sites collapsed to nine one-liners. This is the
audit's own §11 recommendation #1 and I endorse it without reservation. It removes code, removes
the ability for the guards to diverge, and gives CAS semantics to every lifecycle write for free.

**Genuinely removable states here (small, safe):**

| State | Evidence | Action |
|---|---|---|
| `REQUEST_STATUS.DECLINED` | 2 refs; semantically "stylist declined a direct request" — indistinguishable from `CLOSED` for every query and quota rule | **Merge into `CLOSED`** with a `closedReason`. The Revision §F.1 itself says "if the PO prefers one state, merge into CLOSED" |
| `Request` status `'pending'` | Not in `REQUEST_STATUS` at all; `request-autopause.cron.js:18` still queries it | Dead legacy value — delete the query branch (also fixes M9) |
| `OFFER_STATUS.CLOSED` vs `REJECTED` | **Keep both.** The Revision §F.2 gives a specific reason: "someone else won" vs "this client said no" are different signals for a stylist's acceptance-rate metric | No change |

**Do not touch:** offer acceptance (three-layer guard, best-tested concurrency code here), the
two-stage completion CAS, the in-transaction overlap check.

---

### 2.4 Payments — HIGH PRIORITY

**Current design.** `Payment` (1 per booking, unique index) with 7 states:
`pending → paid → {refunding → refunded | partially_refunded} | failed`, plus a **dead**
`cancelled` (0 references). Provider abstraction (`mock` | `paymob`) behind a real interface, with
mock hard-blocked in production. HMAC-SHA512 webhook verification over Paymob's 21 canonical
fields with a length pre-check and `timingSafeEqual`. Amount verification against the expected
piastre value before marking paid (X19). CAS on every status transition via
`transitionStatus(id, fromStatus, patch)` (X18). Refund CAS-claims `REFUNDING` **before** calling
the provider and reverts to `paid` on provider failure (X17). Money as decimal EGP with
`round2()` in operational models; integer piastres **strictly** in `LedgerEntry`, converted at
one boundary. Escrow is not a separate entity — it is `Payment.status === 'paid'` plus
`ESCROW_HOLD`/`ESCROW_RELEASE` ledger entries.

#### MUST KEEP — no negotiation

| Control | Why |
|---|---|
| HMAC webhook verification + timing-safe compare | Without it anyone can mark any booking paid |
| Webhook **amount** verification | HMAC proves the message is authentic, not that the right amount was captured |
| CAS on every `Payment.status` transition | The only thing preventing double-processing of a redelivered callback |
| `REFUNDING` as a durably-written pre-provider claim | Removing it reopens X17: a crash between the provider succeeding and our write leaves the client refunded with no record, and the booking still payout-eligible |
| Ledger `idempotencyKey` unique index, E11000 → return existing | The idempotency primitive the whole money system rests on |
| `platformFee + stylistPayout === amount`, clamped so the platform can never owe more than it kept | Verified in the coupon path too |
| Refund refuses when `booking.payoutStatus !== 'unpaid'` | Prevents refunding money already disbursed |
| Provider interface with mock production-blocked | Vendor swap is an env var, not a rewrite |
| Decimal-EGP / integer-piastre split | Deliberate, documented, boundary correctly isolated. Migrating operational models to minor units is a large risky change for a 1-piastre reconciliation nuance |

#### CAN SIMPLIFY

| Item | Current | Simplified | Net |
|---|---|---|---|
| `PAYMENT_STATUS.CANCELLED` | Declared, **0 references** | Delete from the enum | −1 state |
| Ledger dual-writes | Hand-rolled as two independent `postEntry` calls at 4+ sites, in `try/catch` → `console.error` (M2). `postDoubleEntry` exists and is used correctly for coupons **in the same file** | Route every pair through `postDoubleEntry` **with a session** | −4 hand-rolled patterns, +atomicity |
| `readyState === 1` guard | **9 copies.** Tests connectedness, not replica-set support; the non-transactional `else` only runs when the DB is unreachable, where it cannot succeed either | One `withOptionalTransaction(fn)` in `src/common/`, or just always open a transaction (`AGENTS.md` already declares a replica set non-negotiable) | −8 copies, −1 false signal |
| Refund `stylistPayoutOverrideAmount` | Caller passes an EGP amount that the callee clamps | Pass the **policy object** (`{clientRefundPct, stylistPct, platformPct}`) and let `processRefund` do all the arithmetic once | −1 arithmetic duplication between `no-show.service` and `payment.service` |
| No-show / cancellation / dispute each compute their own split | 3 separate arithmetic sites | **One `settlement.js` pure module**: `computeSettlement(booking, event, now) → {refundPct, stylistAmount, platformAmount, penaltyAmount, couponEligible, tier}` | See §2.6 — the single biggest business-logic consolidation available |
| Stuck `REFUNDING` | No recovery sweep (self-flagged in remediation §11) | A small admin endpoint + one sweep. This *adds* a job; it is the one place where adding is right | +1 small job |

**Escrow:** already as simple as it can be. There is no `Escrow` entity and there should not be
one. Keep.

---

### 2.5 No-show

**Current design.** `no-show.service.js` (433 lines): `fileNoShow` → `respondToNoShow`
(contest → `disputed` → `adminResolveNoShow`; accept → settle) → `resolveNoShow`, plus
`autoResolveExpiredNoShows` on a 15-minute cron. Gates: 30-minute grace after scheduled start;
reporter must have checked in; accused gets 2 hours; silence resolves for the reporter; contest
goes to human arbitration.

`resolveNoShow` performs **six independent writes** — schedule delete, booking CAS, refund,
penalty, coupon, reliability recompute — **with no transaction** and four of them
error-swallowed, then locks the chat and emits an event.

**Assessment: the *flow* is correct and is not over-designed.** Every gate answers a named fraud
primitive that the Revision §H spells out: a one-tap "they didn't show" that refunds 100% and
penalises the counterparty is a fraud primitive; the gates are the mitigation. Removing any of
them is a product regression, not a simplification.

**But the *implementation* is the worst partial-failure surface in the repository.** Six writes,
no transaction, four swallowed errors. A failure in the middle leaves a booking in a terminal
no-show status with only some of its financial consequences applied. The idempotency keys mean a
**retry** would be safe — but nothing retries.

**Simplify:**

1. **Wrap the money writes in one transaction** (booking CAS + refund + penalty ledger). Schedule
   deletion, coupon, reliability and chat lock are genuinely post-hoc and can stay outside, but
   they need a retry/DLQ record rather than a swallowed `logger.error`.
2. **Push the split arithmetic into the shared `computeSettlement`** (§2.4) so no-show and
   cancellation stop computing money in two places.
3. **Fix the anti-fraud gate while consolidating** (L5): `booking.checkInAt` is **one shared
   field either party can write**, so *the accused party's check-in satisfies the accuser's
   gate*. The correct per-party pattern already exists three fields away
   (`clientConfirmedAt`/`stylistConfirmedAt`). This is a genuine hole in a stated rule.
4. **Stop overloading `payoutStatus: 'paid'` to mean "nothing owed"** — that overload is what
   caused X1 (a stylist no-show never refunded the client, silently). The fix ordered the writes
   around it; the *simplification* is a distinct `not_owed` value so it cannot recur.

**Do not simplify:** the states. `no-show-stylist` and `no-show-client` must stay separate (§2.3).
The dispute escalation must stay — a contested no-show is exactly the case a human is for.

---

### 2.6 Cancellation / Refund

**Current design.** `calculateCancellationOutcome(booking, role, now)` — a **pure function**,
~80 lines, four branches driven entirely by `CANCELLATION_POLICY` constants:

| Who / when | Client refund | Platform | Stylist | Penalty debt | Coupon |
|---|---|---|---|---|---|
| Client, H ≥ 24 | 97% | 3% | 0 | — | — |
| Client, H < 24 | 80% | 20% | 0 | — | — |
| Stylist, H ≥ 24 | 100% | 0 | 0 | 3% | — |
| Stylist, H < 24 | 100% | 0 | 0 | 20% | 10% (spec'd, **never issued** — L8) |
| Admin | priced on the client branch (no-fault) | | | | |

**Assessment: this is already the "small number of deterministic rules" the brief asks for.** It
is a pure function over `(price, hoursUntil, whoCancelled)` returning a settlement object, with
every number a named constant and a PO decision behind it (Revision §H). There is nothing to
compress. The audit's §10 says explicitly: *"Explicitly NOT over-engineered — do not simplify:
the four-branch cancellation policy (each branch is a distinct business outcome)."* I agree.

**What *is* wrong:**

- **The stylist late-cancellation coupon is computed and never issued** (L8). `couponEligible:
  true` is returned in the quote and `booking.service.js` has no `couponService` import at all.
  Both the Revision §H and the product guide state it works. A promised user-facing capability
  does not exist.
- **`FULL_REFUND_HOURS` / `PARTIAL_REFUND_PERCENTAGE`** are a dead second source of truth (L6).
- **`cancelBooking` has a polymorphic signature** — `(param1, param2, cancelData)` with runtime
  type-sniffing to decide whether arg 1 is a user or an ID. This is pure accidental complexity
  from a call-site migration that never finished. One signature, update callers.
- **`cancelBooking` has no CAS and no retry loop**, unlike `acceptOffer`. A genuine concurrent
  cancel surfaces as an unhandled 500.

**Simplify: unify cancellation, no-show and dispute settlement into one pure
`computeSettlement()` module** returning the same shape for all three events. Three call sites
currently do this arithmetic independently. One pure function, exhaustively table-tested, is both
smaller and safer — and it is the natural home for the `round2`/clamping rules that are currently
re-derived per site.

---

### 2.7 Subscriptions

**Current design — 5 entities + 1 cron + 1 service (2,190 lines, the largest module):**

| Entity | Role | Verdict |
|---|---|---|
| `Plan` | Config: code, role, tier, `priceEgp`, `priceYearlyEgp`, `entitlements` map | **KEEP.** Deliberately has no `billingCycle` (one row, both prices) — the comment explains the drift bug that caused |
| `Subscription` | One mutable active row per user; partial unique index `uniq_active_subscription_per_user` | **KEEP.** The partial index *is* the invariant |
| `SubscriptionOrder` | Checkout record: `specialReference`, provider IDs, 4 states incl. transient `processing` | **SIMPLIFY** — see below |
| `SubscriptionHistory` | Immutable append-only transition snapshots, `pre`-hook-blocked mutation | **KEEP.** Answers "what plan were they on last month and who changed it" — support and billing disputes need it, and it is genuinely cheap |
| `UsageCounter` | `{subjectId, metric, periodKey}` unique, TTL-expiring, atomic `$inc` with a range predicate | **KEEP.** `consume()` is the only correct atomic quota primitive in the codebase |

Plus `entitlement.service` (215 lines: `getEntitlements` with lazy expiry, atomic `consume`,
TOCTOU `capacity`, `refundQuota`) and `subscription-renewal.cron.js` (191 lines) handling expiry,
scheduled downgrades and free-tier fallback.

**Assessment: 5 entities is defensible but it is the one place where a merge is genuinely
available.**

`SubscriptionOrder` is **a Payment by another name**. It holds `amountEgp`, `provider`,
`providerIntentionId`, `providerTransactionId`, `status ∈ {pending, processing, paid, failed}`,
`paidAt`, `rawCallbackData` — the same fields as `Payment`, with `specialReference` playing the
role of `idempotencyKey`. The evidence they are duplicates is in the routing itself:
`payment.service.handleWebhook` sniffs `bookingId.startsWith('subord_')` and **delegates to a
second, parallel webhook handler**. Two webhook implementations, two status machines, two ledger
write patterns, for the same "Paymob took money" event.

**Proposed:** give `Payment` an optional `purpose ∈ {booking, subscription}` and a
`subscriptionRef`, drop `SubscriptionOrder`, and run **one** webhook handler. This

- removes 1 model, 1 repository, 1 status machine (4 states), and the string-prefix routing hack;
- makes subscription ledger entries reconcilable (M3: today they are posted with no `bookingId`,
  and the reconciliation cron walks `bookingId`, so a half-written subscription pair is
  **invisible to the job built to catch it**);
- gives the subscription path the CAS the booking path already has (M4 is still open).

This is the single highest-value *structural* merge in the repository. It is also the riskiest
item in this report and needs a data migration, so it is scheduled last among the money phases.

**Also simplify:**

- **`Subscription.status: 'past_due'` is declared and never set** (the Revision specifies it with
  a 3-day grace; the product guide says "no auto-renewal"; the code implements neither). **Resolve
  the spec conflict, then either implement it or delete the enum value.** −1 state if deleted.
- **Resolve the proration conflict (M28)** — Revision §E.5 mandates prorated charging; the product
  guide documents full-price-and-reset; the code follows the guide. A user one month into a
  yearly plan who upgrades **loses ~11 months**. This is a real user-facing money bug hiding
  behind a documentation conflict.
- **`capacity()` is TOCTOU** (M7) on the *monetized* limits — two concurrent creates both pass,
  handing users paid-tier capacity for free. The correct pattern (atomic counter / unique index)
  already exists in `consume()` in the same file.

**Do not simplify:** `UsageCounter`, `SubscriptionHistory`, the partial unique index, or the
entitlements-as-a-map design.

---

### 2.8 Moderation

**Current design — 5 models + scanner + service (1,274 lines):**
`BlockedWord`, `BlockedDomain`, `ModerationEvent` (4 enums: `matchedLayer` ×6, `severity` ×4,
`actionTaken` ×5, `reviewStatus` ×3), `PolicyViolation` (4 enums: `violationType` ×5,
`severity` ×4, `enforcementAction` ×4, `status` ×3). A regex/normalisation scanner (Arabic-Indic
numeral folding, zero-width stripping, tashkeel removal, separator-tolerant phone regex — the
normalisation work is genuinely good). A 2-minute in-memory blocked-word cache. A **3-strike
escalation ladder**: WARN → RESTRICT (7-day chat restriction + `tokenVersion` bump) → SUSPEND
(account suspended + all sessions revoked + cache invalidated). `MODERATION_MODE ∈ {DRY_RUN,
ENFORCE}` gating enforcement, now correctly present in the env schema (X2 fixed) and logged
loudly at boot.

**Does `Report → Admin Review → Action` suffice?** **Partially — and the part it misses is the
important one.**

That flow covers *reactive* moderation (a user reports something). It does **not** cover
*preventive* moderation, which is the actual product requirement here: Murafiq's business model
depends on stopping off-platform contact exchange (`REVISION_MODERATION_CLASSIFIER_GATE.md`).
Disintermediation is a revenue-existential risk for a commission marketplace. The synchronous
scanner at the write path is what enforces it; a report-and-review loop fires after the phone
number has already been exchanged.

**So the pipeline stays. The bookkeeping can shrink:**

| Item | Assessment |
|---|---|
| `BlockedWord` + `BlockedDomain` | **MERGE** into one `BlockedTerm {kind: 'word'\|'domain', value, isActive}`. Two models, two repositories, two cache paths, one concept. −1 model, −1 repository |
| `ModerationEvent` + `PolicyViolation` | **KEEP BOTH.** Genuinely different: an Event is "this content matched a rule" (may be a false positive, reviewable); a Violation is "this user has a confirmed strike" (drives enforcement, expires after 30 days). Merging them makes the strike count unreliable, which is the one thing that must not be |
| `actionTaken` ×5 including `ALLOW` | `ALLOW` is never written (a non-flagged scan returns early). **Trim to what is written** |
| Scanner's substring fallback (L13) | `wordRegex.test(t) \|\| t.includes(normWord)` — blocked word `"ass"` matches `"Hassan"`; domains are pure `includes`, so a domain `"me"` blocks every message containing "me". **Delete the fallback.** This is a simplification *and* a correctness fix |
| Image bypass (X12) and report participant check (X13) | Already closed in remediation |

**Net: −1 model, −1 repository, a few dead enum values, one dangerous fallback removed. Capability
unchanged.**

---

### 2.9 Chat

**Current design.** Firestore, not Mongo. `conversationId === bookingId`. Created **closed** at
booking time; opened by the `PaymentSucceeded` listener; locked read-only on
`SessionCompleted`/`BookingCancelled`/no-show settlement. Realtime delivery is **client-side via
Firestore Security Rules** — there is no server socket. REST writes go through `chat.service.js`,
the only module allowed to touch `firebase-admin`. Admin read-only access is granted by a `role`
custom claim, narrowly conditioned on a disputed/cancelled booking, and audited. An in-memory
`Map` fallback exists for local dev when Firebase credentials are absent.

**Assessment: this is the cleanest architectural decision in the repository, and it is already
minimal.** Not running a socket server is *why* it is simple: fan-out, presence, reconnection and
horizontal scale are all Google's problem. The lifecycle is 3 booleans (`isOpen`, `isLocked`, and
membership), not a state machine.

**Simplify:** nothing. **Fix:** the docs — `Socket.io` is referenced in 8 files, is not a
dependency, and nothing is attached to the HTTP server (L2). Either build Phase 7's realtime
notification delivery or **delete the claim from 8 documents.** I recommend deleting it; FCM
already covers the product need.

---

### 2.10 Notifications

**Current design.** Mongo `Notification` (12 types, `isRead`, `relatedEntityId`) as the in-app
feed + FCM multicast push with automatic stale-token pruning, driven by a single
`notification.listener.js` (455 lines) mapping domain events → notifications.

**Assessment: appropriately sized, with one shape problem.** The persist-then-push design is
right; stale-token pruning is a real operational need. But `notification.listener.js` at 455
lines is the largest listener in the codebase and is essentially a 20-branch switch with the
copy hardcoded inline.

**Simplify:** extract a declarative `EVENT → {type, titleKey, bodyKey, audience}` table (the
audit-log module already does exactly this with `AUDIT_EVENT_MAP` and it works well). Expect
roughly −40% on that file, and it becomes the obvious place to add Arabic i18n later, which this
product will need.

**Also:** `NOTIFICATION_TYPES` includes `'safety'` for a module that does not exist. Trim when the
safety decision is made (§2.12).

---

### 2.11 Ledger / Financial Records — special attention

**Current design.** `LedgerEntry`: immutable (8 mutation hooks throw), unique `idempotencyKey`,
integer piastres, `direction ∈ {DEBIT, CREDIT}`, `accountType ∈ {PLATFORM, CLIENT, STYLIST,
ESCROW}`, 11 entry types, `correlationId`, indexes on `{accountId, createdAt}` and
`{bookingId, entryType}`. `postEntry` (idempotent, E11000 → return existing) and
`postDoubleEntry` (amount-matched pair). A nightly reconciliation cron that detects both
unbalanced bookings **and** settled payments with no ledger entries at all.

**Verdict: GENUINELY REQUIRED. Do not remove. Do not shrink the schema.**

Reasoning, against the brief's four options:

- **Duplicating Payment/Payout?** No. `Payment` holds *current* state and is mutated (status
  flips, refund amounts overwrite `platformFeeAmount`/`stylistPayoutAmount`). The ledger holds
  *what happened*, immutably, in order. Those are different questions, and the second one cannot
  be reconstructed from the first after a refund overwrites the split.
- **Necessary for correctness?** Yes, for the paths that have no other record: penalty accrual
  (there is no stylist payment instrument — the debt lives only here and in `Penalty`), coupon
  merchant-funding, escrow hold/release, and platform revenue recognition on a cancellation
  (X20 — before that fix, retained cancellation fees sat in escrow with **no entry ever
  recognising them as revenue**, and because debits still equalled credits, reconciliation never
  alerted).
- **Overbuilt?** The *primitives* are not. The **usage** is: dual-writes are hand-rolled at 4+
  sites instead of going through `postDoubleEntry`, without a session, swallowed to
  `console.error` (not Winston, so it never reaches aggregation). That is the overbuild — not the
  ledger, the **way it is called**.

**The simplest safe version is the one that exists, called correctly:**

1. Every pair goes through `postDoubleEntry` **with a session**, inside the same transaction as
   the operational write.
2. Failures go to Winston with an alert, never `console.error`.
3. Reconciliation gets a `Payment`-rooted pass covering subscription purchases, so those entries
   stop being structurally invisible (M3), plus a 1-piastre tolerance for the
   `egpToPiastres(Σ)` vs `Σ egpToPiastres(each)` rounding nuance.
4. Reconciliation output goes somewhere a human sees. Today the one control that detects money
   moving without a ledger record **writes to a log file nobody watches**.

**Entry-type naming drift** (`COUPON_DISCOUNT` vs the Revision's `COUPON_CREDIT`, etc.) — pick the
code's names and amend the spec. Renaming a live enum has no correctness benefit.

---

### 2.12 Redis / BullMQ / Cron — per-use classification

| # | Use | Why it exists | Simpler? | Verdict |
|---|---|---|---|---|
| 1 | **BullMQ** wardrobe classification worker | A Gemini vision call inline in an upload would make uploads feel broken on a slow network. Redis job locking makes it the *only* re-entrancy-safe job here | No — right tool, correctly configured (retries, exponential backoff, bounded retention, `maxRetriesPerRequest: null`, clean shutdown) | **KEEP** |
| 2 | **Redis** rate-limit store (production only) | Added in Round 2 (X27). Per-process limits are meaningless the moment there are 2 processes | No | **KEEP** |
| 3 | `offer-expiry.cron` (*/5m) | Proactive sweep complementing lazy read-time expiry | Keep the job; add a `{status, expiresAt}` index (L12 — full scan every 5 minutes) | **KEEP + index** |
| 4 | `no-show-resolution.cron` (*/15m) | Silence must not stall settlement indefinitely | Keep; add the missing index (full scan every 15 min) | **KEEP + index** |
| 5 | `request-autopause.cron` (*/5m) | 48h-no-offers auto-pause | **SIMPLIFY** — it bypasses the repository, imports `Request` directly, filters on a dead `'pending'` status, and `doc.save()`s with no precondition, so a request cancelled mid-sweep is **revived to `PAUSED`** and can receive offers again (M9). The correct `findAutoPausableRequests` exists and is never called | **SIMPLIFY** |
| 6 | `session-reminder.cron` (hourly) | 24h-ahead reminders | Keep; the `reminderSentAt` guard is a non-atomic `find`→`updateOne` and duplicates under >1 instance | **KEEP + CAS** |
| 7 | `otp-cleanup.cron` (daily 04:00) | Clears expired OTP hashes, resets attempt counters | **REMOVE.** A Mongo TTL index on `otpExpiresAt` does this natively — no job, no timezone bug, no instance pinning. The `otpAttempts` reset belongs in the OTP-issue path anyway | **REMOVE** |
| 8 | `subscription-renewal.cron` (daily 02:00) | Expiry sweep + scheduled downgrades | Keep the job, but `entitlement.service` **already does lazy expiry on read** (X16), so the cron is no longer load-bearing for correctness — only for recording the `SubscriptionHistory` transition. Use `replaceActivePlanCAS`, not `updateById` (X8/X15 drift) | **KEEP + CAS** |
| 9 | `ledger-reconciliation.cron` (daily 03:00) | The only money-integrity detector | **KEEP** — and give it an alerting sink | **KEEP** |
| 10 | **`timezone` option** | 3 crons comment "Cairo time"; **zero** pass a `timezone` (M11). On a UTC VPS they run 2h off the Cairo business-day boundaries the rest of the system computes against | Pass `{timezone: BUSINESS_TIMEZONE}` | **FIX** |
| 11 | **Cron leader election** | All 7 use a process-local `let registered = false` — not a lock. Correctness depends on PM2 `instances: 1`, undocumented as load-bearing for this | **DEFER** until >1 instance is needed; then a Redis `SET NX PX` lock is ~10 lines. Until then, **document** the dependency in `ecosystem.config.cjs` | **DEFER + document** |
| 12 | Token-revocation cache (`tokenVersionCache`, 30s in-memory) | Avoids a Mongo read per request | **DEFER.** Redis-backing it is the correct eventual answer but it is not a bottleneck at current scale | **DEFER** |

**Net: 7 crons → 6, one genuinely removed (TTL index), one genuinely fixed (autopause), timezone
applied to all, indexes added to two sweeps.** No new infrastructure. Redis stays at two jobs.

---

## 3. STATE MACHINE AUDIT

| Domain | Current states | Proposed | Simplify? | Why |
|---|---|---|---|---|
| **Booking** | 7: `confirmed`, `in-progress`, `completed`, `cancelled`, `disputed`, `no-show-stylist`, `no-show-client` | **7 (unchanged)** | **NO** | Each carries distinct money. Verified in §2.3. The *transitions* must be centralised into one table — that is where the win is |
| **Booking.payoutStatus** | 3: `unpaid`, `processing`, `paid` | **4**: + `not_owed` | **NO — ADD ONE** | `paid` is overloaded to mean "nothing owed", which caused X1 (silent client money loss). A distinct value makes the bug structurally impossible |
| **Payment** | 7: `pending`, `paid`, `failed`, `cancelled`, `refunded`, `partially_refunded`, `refunding` | **6** (drop `cancelled`) | **YES, −1** | `cancelled` has **0** references |
| **Refund** | (no separate machine — an axis of Payment) | unchanged | **NO** | Already minimal; do not extract a Refund entity |
| **Payout** | 4: `pending`, `processing`, `paid`, `failed` | **4** | **NO** | Minimal for a manual disbursement with a failure path; all four are written |
| **Penalty** | 4: `OUTSTANDING`, `PARTIALLY_SETTLED`, `SETTLED`, `WAIVED` | **4** | **NO** | Partial settlement is real (a batch can be smaller than the debt); `WAIVED` is an admin capability |
| **Subscription** | 4: `active`, `past_due`, `cancelled`, `expired` | **3** (resolve `past_due`) | **YES, −1 (conditional)** | `past_due` is declared and never set. Specs conflict on whether it should exist. Decide, then implement or delete |
| **SubscriptionOrder** | 4: `pending`, `processing`, `paid`, `failed` | **0 — merge into `Payment`** | **YES, −1 entity, −4 states** | It is a Payment by another name; §2.7 |
| **Request** | 6: `OPEN`, `PAUSED`, `CLOSED`, `FULFILLED`, `CANCELLED`, `DECLINED` | **5** (`DECLINED` → `CLOSED` + reason) | **YES, −1** | The Revision §F.1 itself offers this merge |
| **Offer** | 6: `PENDING`, `ACCEPTED`, `REJECTED`, `WITHDRAWN`, `CLOSED`, `EXPIRED` | **6** | **NO** | `CLOSED` vs `REJECTED` is a deliberate, documented product signal |
| **Verification (KYC)** | 4: `unverified`, `pending`, `verified`, `rejected` | **4** | **NO** | Floor for a human-review workflow |
| **Account** | 5: `active`, `suspended`, `deleted`, `restricted`, `blocked` | **4–5** | **MAYBE, −1** | `blocked` vs `suspended` differ mainly by who set them. Needs a product decision, not a refactor |
| **Coupon** | 4: `ISSUED`, `REDEEMED`, `EXPIRED`, `VOIDED` | **4** | **NO** | All read; `VOIDED` is an admin path |
| **ModerationEvent** | `reviewStatus` ×3, `actionTaken` ×5, `matchedLayer` ×6, `severity` ×4 | trim `actionTaken` to written values | **YES, small** | `ALLOW` is never written |
| **PolicyViolation** | `status` ×3, `enforcementAction` ×4, `violationType` ×5, `severity` ×4 | unchanged | **NO** | Drives the strike ladder; all used |
| **No-show** | Not a separate machine — an axis of Booking + `noShowDetails` (8 fields) | unchanged | **NO** | Correct as modelled; the *code path* needs a transaction, not fewer states |

**Net state change: −4 to −6 across the system** (`Payment.cancelled`, `Request.DECLINED`,
`Subscription.past_due`, the 4 `SubscriptionOrder` states via the merge, minus 1 added
`payoutStatus.not_owed`). **That is roughly 8% of ~61 enumerated states. The state surface is not
where the complexity lives.**

---

## 4. COMPLEXITY HOTSPOTS — top 10

Legend: **E** = essential (the business problem causes it) · **A** = accidental (the
implementation causes it).

| Rank | Area | Why complex | Necessary? | Simplification |
|---|---|---|---|---|
| **1** | **Booking transitions scattered across 9 writers** | No central table; each writer re-derives its own legal-`from` set, and they disagree. Direct cause of X4, X9, X10 | **A** | `BOOKING_TRANSITIONS` map + `repository.transition(id, from[], patch, session)`. 9 guards → 1 |
| **2** | **`resolveNoShow`: 6 untransacted writes, 4 swallowed errors** | Worst partial-failure surface in the system. A failure leaves a terminal no-show with only *some* financial consequences applied | **A** | Transaction around the money writes; DLQ record for the rest; shared settlement function |
| **3** | **`SubscriptionOrder` ⟂ `Payment` duplication** | Two parallel webhook handlers routed by a `'subord_'` string prefix; two status machines; two ledger patterns; subscription entries unreconcilable (M3) | **A** | `Payment.purpose` + one handler. −1 model, −1 repo, −4 states |
| **4** | **Settlement arithmetic in 3 places** | Cancellation, no-show and dispute each compute refund/platform/stylist/penalty independently, with their own `round2` and clamping | **A** | One pure `computeSettlement(booking, event, now)` |
| **5** | **`readyState === 1` transaction guard ×9** | Tests connectedness, not replica-set support. The non-transactional branch only runs when the DB is unreachable — dead code that makes every money path *read* as if atomicity is optional | **A** | One `withOptionalTransaction`, or always transact |
| **6** | **Ownership/participant check ~20 verbatim copies** | The copies **disagree about admin bypass**; four compare against the string `'admin'` instead of `ROLES.ADMIN` | **A** | `assertBookingParticipant(user, booking, {allowAdmin})` |
| **7** | **5,710 lines of Swagger inline in `src/`** | 22% of the source tree. `admin/`: 826 annotation lines vs 688 code lines. Every route edit is a two-file edit and the second file is bigger | **A** | Generate from the Zod validators (already `.strict()` and already the contract) — or move annotations to `docs/openapi/`. The 137/137 validator script guarantees the move is safe |
| **8** | **Hand-rolled ledger dual-writes ×4+** | Two independent un-sessioned `postEntry` calls in a `try/catch` → `console.error`. DEBIT commits, CREDIT throws, the book is permanently unbalanced. `postDoubleEntry` exists and is used correctly **in the same files** | **A** | Route all pairs through `postDoubleEntry` with a session |
| **9** | **7 in-process crons, no locks, no timezone, `instances: 1` load-bearing for 4 properties** | `ecosystem.config.cjs` justifies the pin by naming **one** cron | **A** (partly **E** — sweeps are real) | TTL index replaces one; `{timezone}` on all; document the pin; Redis lock deferred |
| **10** | **Dead modules and dead state** | `reliability/` (0 writers, 0 readers), `safety/` (empty, but `isFrozen` and `Notification.type:'safety'` reference it), `Payment.cancelled`, `past_due`, `FULL_REFUND_HOURS`, `getSignedKycUrl`, `booking.controller.resolveDispute` (inverted args, unrouted) | **A** | **Decide each: build or delete.** Undecided dead code is worse than either |

**Essential complexity worth naming, so nobody tries to remove it:** escrow + dispute
arbitration; the 4-branch cancellation matrix; two distinct no-show outcomes; double-entry
accounting; the penalty-debt model (Murafiq holds no stylist payment instrument, so the debt has
nowhere else to live); the preventive moderation gate; per-device sessions with two revocation
axes; daily quota + persistent capacity as two separate entitlement mechanisms.

---

## 5. FEATURE PRESERVATION MATRIX

| Feature | Current implementation | Simplified implementation | Same user capability? |
|---|---|---|---|
| Register / login / Google sign-in | JWT pair, distinct secrets, per-device sessions, OTP verification | Unchanged | ✅ identical |
| Multi-device sessions + revoke | `sessions[]` + CAS rotation + `tokenVersion` | Unchanged | ✅ identical |
| Password reset / change | OTP + full session invalidation | Unchanged | ✅ identical |
| KYC / identity verification | 4 states, role-specific doc sets, admin/operator review | Unchanged states; **wire the signed-URL view** (M16) | ✅ **improved** — reviewers can finally see documents |
| Direct request to a stylist | `Request{visibility:'direct'}` | Unchanged | ✅ identical |
| Broadcast request to the feed | `Request{visibility:'broadcast'}` + `$geoNear` feed | Unchanged; project addresses to area level in the feed (M13) | ✅ same capability, less over-disclosure |
| Request auto-pause / reactivate (max 3) | Cron + `pauseCount` | Same rules, via the repository with a CAS | ✅ identical (**fixes** cancelled-request revival) |
| Stylist sends offers (daily + active limits) | `offers.daily` counter + `offers.active` capacity | Unchanged; make `capacity()` atomic | ✅ identical (closes a free-tier bypass) |
| Accept offer → booking, atomically | One transaction, 3 guards, retry loop | **Unchanged — do not touch** | ✅ identical |
| Double-booking prevention | Overlap check + `ScheduleBlock` unique index | Unchanged; fix the UTC/Cairo day window (L11) | ✅ identical |
| Pay for a booking (card, Paymob) | Provider interface, HMAC webhook, amount check, CAS | Unchanged | ✅ identical |
| Coupon at checkout | Transactional redeem + ledger pair + clamping | Unchanged | ✅ identical |
| Escrow hold until completion | `Payment.status === 'paid'` + ledger entries | Unchanged | ✅ identical |
| Geolocated check-in | `checkInAt` + `in-progress` | **Split into `clientCheckInAt` / `stylistCheckInAt`** | ✅ same UX, closes the L5 fraud gate |
| Mutual completion confirmation | Two-stage CAS | **Unchanged — do not touch** | ✅ identical |
| Cancel with quote (4 tiers) | Pure `calculateCancellationOutcome` | Moves into shared `computeSettlement`; **same numbers** | ✅ identical |
| Late-stylist-cancel coupon | **Computed, never issued (L8)** | Actually issue it | ✅ **restored** — a spec'd capability that does not exist today |
| File / contest / arbitrate a no-show | 30m grace, check-in gate, 2h window, auto-resolve, admin arbitration | Same flow; money writes in one transaction | ✅ identical, far safer |
| Refunds (full & partial) | CAS-claimed `REFUNDING` before the provider | Unchanged | ✅ identical |
| Stylist penalty debt | `Penalty` + ledger accrual, netted in the payout batch | Unchanged | ✅ identical |
| Payout batches (manual admin) | `Payout` + penalty netting + 48h hold | Unchanged; add the CAS + move the accumulator inside the retry (M5) | ✅ identical (removes phantom rows / duplicate notifications) |
| Booking chat (Firestore) | `conversationId === bookingId`, open on payment, lock on end | **Unchanged** | ✅ identical |
| Chat moderation (contact exchange) | Synchronous scanner + 3-strike ladder | Same; merge the two term models; drop the substring fallback | ✅ identical (**fewer false positives**) |
| User reports → admin review | `ModerationEvent` + `confirmEvent` → strike | Unchanged | ✅ identical |
| Push + in-app notifications | Mongo feed + FCM multicast + token pruning | Same; declarative event→notification table | ✅ identical |
| Two-way reviews | Unique `{bookingId, direction}`, from-source aggregates | Unchanged | ✅ identical |
| Subscription plans & entitlements | `Plan` + `Subscription` + `UsageCounter` + history | Same; `SubscriptionOrder` folds into `Payment` | ✅ identical |
| Buy / upgrade / downgrade a plan | Paymob checkout + webhook grant + scheduled downgrade | Same UX, one webhook handler | ✅ identical (**and proration decided**) |
| Admin manual plan grant | Shares `applyPlanGrant`, no Payment/ledger by design | Unchanged | ✅ identical |
| Wardrobe upload + AI classification | BullMQ + Gemini + per-user vector namespace | Unchanged; validate model output against a Zod schema (M23) | ✅ identical, no silent corruption |
| Admin dashboard & dispute resolution | `admin` module + audit log | Unchanged | ✅ identical |
| Freeze a booking's payout pending safety review | **`isFrozen` has no writer — does not work** | **Decide:** build `safety/`, or delete the field and the doc claim | ⚠️ currently a claimed-but-absent capability |
| Reliability scoring | `reliability.service` recompute; `ReliabilityEvent` **dead** | **Decide:** wire it or delete it | ⚠️ score moves, nobody can explain why |

**Two rows carry a ⚠️. Neither is caused by complexity — both are undecided product scope.** They
must be decided, not refactored.

---

## 6. PRODUCTION SAFETY CHECK

Every proposed simplification, against the brief's failure list:

| Risk | Introduced by any proposal? | Why not |
|---|---|---|
| Duplicate payments | **No** | Unique `Payment.bookingId`, `idempotencyKey`, and status CAS are all untouched. The `SubscriptionOrder` merge *adds* CAS to a path that currently lacks it (M4) |
| Duplicate refunds | **No** | The `REFUNDING` CAS claim is explicitly in MUST-KEEP |
| Duplicate payouts | **No** | The proposal *adds* the missing `payoutStatus` CAS and moves the accumulator inside the retry callback (M5) |
| Duplicate bookings | **No** | The three-layer acceptance guard is explicitly do-not-touch |
| Lost financial records | **No** | The ledger schema is unchanged; the proposal makes dual-writes **atomic and sessioned**, which strictly reduces loss |
| Invalid booking transitions | **No — reduced** | A central transition table is strictly stronger than 9 divergent guards |
| Authentication bypass | **No** | No auth mechanism is changed. Only enumeration-oracle uniformity and a shared helper |
| Authorization bypass | **No — reduced** | One `assertBookingParticipant` replaces ~20 copies that **currently disagree** about admin bypass |
| OTP brute force | **No** | Lockout, account-keyed rate limiting and the Redis store are all untouched. Replacing the OTP-cleanup cron with a TTL index does **not** touch the attempt counter, which resets on issue |
| Webhook replay | **No — reduced** | One handler instead of two, both CAS-guarded, amount-verified |
| Race conditions | **No — reduced** | Every proposal adds CAS or a transaction; none removes one |
| Inconsistent subscription state | **No — reduced** | The partial unique index stays; the merge brings CAS to the webhook grant |
| Moderation bypass | **No** | The synchronous gate, the ladder and `ENFORCE` mode are untouched. Dropping the substring fallback removes **false positives**, not detections |
| Data corruption | **Migration risk on one item only** | The `SubscriptionOrder` → `Payment` merge needs a backfill. It is scheduled last, behind a dual-read window and a reversible migration (Phase S3) |

**Residual risks that the simplification does not solve and must be tracked separately:** no
correlation IDs, no alerting sink, no coverage threshold (L14); the audit log is fire-and-forget
and not tamper-evident (M1); no HTML escaping in mail templates (M21); auth fails open during a
Mongo outage on Cloudinary/Firebase-only routes (M18).

---

## 7. MUST REMAIN ROBUST — do not simplify

1. **Authentication core** — distinct secrets, per-session CAS refresh rotation, reuse detection,
   SHA-256 session hashes, `tokenVersion` global invalidation, session cap via `$slice`, OTP
   lockout, account-keyed OTP rate limiting.
2. **Authorization** — `restrictTo` on every mutating route; the `operator` role scoped to exactly
   3 verification routes; Zod `.strict()` on every body (mass-assignment guard); admin chat access
   narrowly conditioned and audited.
3. **Webhook verification** — HMAC-SHA512 over the 21 canonical fields, length pre-check,
   `timingSafeEqual`, mock provider hard-blocked in production, no `verify()` stub.
4. **Webhook amount verification** — X19. Authenticity ≠ correct amount.
5. **Idempotency** — ledger `idempotencyKey`, coupon `{sourceBookingId, issuedReason}`, penalty
   `{bookingId, reasonType}`, `SubscriptionOrder.specialReference`, `Payment.bookingId`.
6. **Money calculations** — `round2`, the fee/payout identity, the retained-amount clamp, the
   decimal-EGP / integer-piastre boundary.
7. **Financial persistence** — `LedgerEntry` immutability hooks; `SubscriptionHistory`
   immutability; `Penalty` accrual. Never delete an accounting record to simplify code.
8. **Booking concurrency** — the three-layer offer-acceptance guard, the two-stage completion CAS,
   the in-transaction overlap check, the `settleNoShow` CAS.
9. **Subscription payment consistency** — `uniq_active_subscription_per_user` partial index,
   `replaceActivePlanCAS`, atomic `consume()`.
10. **Security configuration** — `NODE_ENV` with no default; the production placeholder-secret
    boot refusal; helmet, CORS, mongo-sanitize; Swagger admin-gated in production.
11. **Database constraints** — every unique and partial-unique index in the repository is a real
    business invariant. **Do not drop one to simplify a query.**
12. **Auditability** — event-bus-driven audit logging via `AUDIT_EVENT_MAP` (never scattered
    direct calls); the nightly reconciliation sweep.

---

## 8. PROPOSED TARGET ARCHITECTURE

**Same architecture: a modular monolith.** No microservices, no event sourcing, no CQRS, no
message bus beyond the in-process `EventEmitter`, no new Redis responsibilities. The module list
barely changes — which is the point.

```text
src/
  common/          ← settlement.js (NEW, pure)  ·  withOptionalTransaction (NEW)
                     assertParticipant (NEW)    ·  constants · QueryBuilder · events
  config/
  jobs/            ← 6 crons (was 7) + 1 BullMQ queue/worker
  modules/
    auth/          unchanged
    users/         + KYC signed-URL view wired
    stylists/      unchanged  (absorbs reliability/ if it is built; deleted if not)
    requests/      5 request states (was 6)
    offers/        unchanged
    bookings/      + booking.transitions.js (NEW, central table)
                     no-show.service now transactional and settlement-driven
    payments/      + purpose:{booking|subscription}  ·  ONE webhook handler
    payouts/       + CAS on payoutStatus
    subscriptions/ − SubscriptionOrder (merged into payments)
    moderation/    − blocked-domain (merged into blocked-word → BlockedTerm)
    coupons/       unchanged
    ledger/        unchanged schema; all callers use postDoubleEntry(session)
    chat/          unchanged
    notifications/ + declarative event→notification map
    reviews/       unchanged
    uploads/       + per-folder role authorization
    wardrobe/      + Zod validation of model output
    admin/         unchanged
    audit-log/     unchanged
    mail/          unchanged
    safety/        ← DECIDE: build, or delete (and delete isFrozen + the doc claims)
    ai/            ← Phase 15, unblocked
  routes/
docs/openapi/      ← Swagger annotations relocated out of src/ (optional, Phase S6)
```

**Module count: 24 → 22–23.** **Models: 25 → 22.** **Crons: 7 → 6.** **Dependencies: 31 → 31**
(nothing added, nothing removed — `node-cron`, `bullmq`, `ioredis` all still earn their place).

---

## 9. CURRENT VS TARGET

| Area | Current complexity | Target complexity | Why |
|---|---|---|---|
| Booking transitions | 9 writers, divergent guards | 1 table + 1 repository primitive | Root cause of 3 CRITICAL/HIGH findings |
| Settlement arithmetic | 3 independent implementations | 1 pure function | Same numbers, one place to test |
| No-show settlement | 6 untransacted writes, 4 swallowed | 1 transaction + DLQ for post-hoc steps | Worst partial-failure surface |
| Subscription billing | 2 models, 2 webhook handlers, 2 state machines | 1 model, 1 handler, 1 machine | They model the same event |
| Ledger writes | 4+ hand-rolled un-sessioned pairs | All via `postDoubleEntry(session)` | The primitive already exists |
| Transaction guard | 9 copies, dead fallback | 1 helper | Removes a false safety signal |
| Ownership checks | ~20 copies that disagree | 1 helper | An authorization bug class |
| Moderation term lists | 2 models, 2 repos, 2 caches | 1 model, 1 repo, 1 cache | One concept |
| Background jobs | 7 crons, no timezone, 2 full scans | 6 crons, timezone set, indexed | 1 replaced by a TTL index |
| Swagger | 5,710 lines inside `src/` | Generated or relocated | 22% of the tree, edited twice per route |
| Dead code | 1 dead module, 2 empty modules, 4 dead states, 3 dead functions | Decided: built or deleted | Undecided dead code is the worst option |
| Notification listener | 455-line switch | Declarative map | Matches `AUDIT_EVENT_MAP`, i18n-ready |

**Estimated, grounded in the counts above:**

| Dimension | Estimate | Basis |
|---|---|---|
| Models removed | **−3** (25 → 22) | `ReliabilityEvent`, `SubscriptionOrder`, `BlockedDomain` |
| Services/repositories merged | **−3 to −4** | `subscription-order.repository`, `blocked-domain.repository`, `reliability/`, possibly `no-show.service` folding into `bookings` |
| Enumerated states removed | **−4 to −6** (~61 → ~55) | §3 |
| Jobs removed | **−1** (7 → 6) | `otp-cleanup` → TTL index |
| Dependencies removed | **0** | All 31 earn their place |
| Duplicated code paths collapsed | **~45 sites → ~5 helpers** | 9 transition guards + 9 `readyState` + ~20 ownership + 4 ledger pairs + 3 settlement |
| Source lines | **−8% to −15% of non-Swagger code**; a further **−20% of the total tree** if Swagger is generated | 20,044 non-Swagger lines; 5,710 Swagger |
| Test suites | **+0 net** (some merge, new ones added for the shared helpers) | 113 today |

**Honest note:** these are *ranges derived from measured counts*, not predictions. The line-count
reduction is the least important number here and the least certain. The valuable reduction is
"45 places where a rule is written → 5", which does not necessarily shrink the line count much
and matters far more.

---

## 10. MIGRATION PLAN

**Principle: incremental simplification of working code. No rewrite. Every phase ends green on
`npm run verify` (lint + 137/137 OpenAPI + full suite) and is independently revertable.**

### Phase S0 — Freeze & decide (no code)

- **Objective:** stop the two things that make everything downstream ambiguous.
- **Decisions required (product, not engineering):**
  1. `safety/` — build it, or delete `isFrozen`, `frozenReason`, `frozenAt`,
     `Notification.type:'safety'` and the `AGENTS.md` invariant claim.
  2. `reliability/` — wire `ReliabilityEvent`, or delete the module.
  3. Proration (M28) — Revision §E.5 vs the product guide. The code follows the guide and
     currently costs an upgrading yearly subscriber ~11 months.
  4. `past_due` + grace period — implement or delete.
  5. `blocked` vs `suspended` — distinct, or merged.
  6. Socket.io — build Phase 7 realtime, or delete the claim from 8 documents.
- **Affected:** documentation only. **Migration:** none. **Tests:** none.
- **Risk:** none. **Rollback:** n/a.
- **Acceptance:** six decisions written into `REVISION_BUSINESS_RULES_AND_ARCHITECTURE.md` as a
  dated amendment. **No S-phase starts until S0 is signed off.**

### Phase S1 — Shared primitives (pure additions, zero behaviour change)

- **Objective:** create the helpers before anything is migrated onto them.
- **Files:** `src/common/withOptionalTransaction.js`, `src/common/assertParticipant.js`,
  `src/common/settlement.js` (pure), `src/modules/bookings/booking.transitions.js`,
  `bookingRepository.transition()`.
- **Behaviour affected:** none — nothing calls them yet.
- **Migrations:** none. **Tests:** exhaustive table tests for `computeSettlement` covering all
  7 policy rows in Revision §H with decimal prices, plus transition-table tests for all
  7 booking states.
- **Risk:** very low. **Rollback:** delete the files.
- **Acceptance:** `computeSettlement` reproduces **byte-identical** outputs to
  `calculateCancellationOutcome` and to the `NO_SHOW_POLICY` arithmetic, proven by a differential
  test against the existing functions before either is removed.

### Phase S2 — Booking lifecycle consolidation

- **Objective:** all 9 booking writers go through the transition table; all 3 settlement sites go
  through `computeSettlement`; `resolveNoShow` becomes transactional.
- **Files:** `booking.service.js`, `no-show.service.js`, `booking.repository.js`,
  `admin.service.js`, `payout.service.js`, `session-reminder.cron.js`,
  `no-show-resolution.cron.js`.
- **Behaviour affected:** **none intended.** Two deliberate exceptions, each flagged as a change:
  (a) `payoutStatus: 'not_owed'` replaces the overloaded `'paid'`; (b) per-party check-in
  (`clientCheckInAt`/`stylistCheckInAt`) closes the L5 gate.
- **Migrations:** backfill `payoutStatus: 'paid'` → `'not_owed'` **only** where
  `status === 'no-show-stylist'` and no `payoutId` exists; backfill `checkInAt` into both
  per-party fields (conservative — it preserves existing `in-progress` bookings).
- **Tests:** every existing booking/no-show/cancellation suite must pass **unchanged**. Add:
  illegal-transition rejection per state; concurrent cancel vs complete; `resolveNoShow`
  partial-failure rollback.
- **Risk:** **medium** — this is the money path. Mitigated by: no rule changes, the differential
  test from S1, and one writer migrated per commit.
- **Rollback:** per-commit revert; the migration is additive (old fields retained one release).
- **Acceptance:** full suite green; the 9 guard implementations are gone; a `grep` for a
  `booking.status` write outside the repository returns zero.

### Phase S3 — Payment & subscription-billing unification

- **Objective:** one webhook handler; one payment model; ledger pairs atomic.
- **Files:** `payment.model.js` (+`purpose`, +`subscriptionRef`), `payment.service.js`,
  `subscription.service.js`, `subscription-order.*` (removed), `ledger-reconciliation.cron.js`.
- **Behaviour affected:** none user-facing. Internally: the subscription grant gains the CAS it
  lacks (M4) and subscription entries become reconcilable (M3).
- **Migrations:** backfill `SubscriptionOrder` → `Payment{purpose:'subscription'}`, mapping
  `specialReference` → `idempotencyKey`. **Dual-read for one full release** before dropping the
  old collection. **Do not drop the collection in this phase.**
- **Tests:** replay the same webhook twice for both purposes; amount-mismatch rejection on both;
  crash-between-provider-and-write for both; reconciliation detects a half-written subscription
  pair (it cannot today).
- **Risk:** **highest in the plan.** Money, plus a data migration. Deliberately scheduled after
  S2 so the transition primitive and the test discipline are already proven.
- **Rollback:** the old collection still exists and the old handler is feature-flagged for one
  release.
- **Acceptance:** one webhook entry point; `grep 'subord_'` returns zero; reconciliation reports
  a seeded broken subscription pair.

### Phase S4 — Moderation & notification consolidation

- **Objective:** `BlockedWord` + `BlockedDomain` → `BlockedTerm`; drop the substring fallback;
  trim dead enum values; declarative notification map.
- **Files:** `moderation/*`, `notification.listener.js`.
- **Behaviour affected:** **fewer false positives** (`"ass"` no longer matches `"Hassan"`; a
  domain `"me"` no longer blocks every message containing "me"). Detections unchanged — prove it.
- **Migrations:** merge two collections into one with a `kind` discriminator.
- **Tests:** a corpus regression — every currently-detected string must still be detected; the
  known false positives must now pass. Strike-ladder tests unchanged.
- **Risk:** **low-medium.** Moderation is revenue-protective; a missed detection is the failure
  mode. The corpus test is the control.
- **Rollback:** keep both collections for one release, read-merged.
- **Acceptance:** detection corpus 100%; false-positive corpus 0%; an `ENFORCE`-mode end-to-end
  test green.

### Phase S5 — Infrastructure & jobs

- **Objective:** 7 crons → 6; timezone on all; indexes on the two full-scan sweeps; autopause
  through the repository with a CAS; `ecosystem.config.cjs` documents everything `instances: 1`
  is load-bearing for.
- **Files:** `src/jobs/*`, `user.model.js` (TTL index), `booking.model.js`, `offer.model.js`,
  `audit-log.model.js`, `ecosystem.config.cjs`.
- **Behaviour affected:** sweeps run at the correct Cairo hour (a **real** behaviour change —
  currently 2h off on a UTC host); a request cancelled mid-sweep is no longer revived.
- **Migrations:** index builds. **Gate them** — `autoIndex` is currently on in production with no
  deploy gate (M27), and `scripts/check-duplicate-active-subscriptions.js` exists and is wired
  into no npm script.
- **Tests:** cron unit tests with an injected clock; the autopause lost-update regression.
- **Risk:** low. **Rollback:** trivial per job; index drops are safe.
- **Acceptance:** `grep -L timezone src/jobs/*.cron.js` returns nothing; no sweep does a COLLSCAN.

### Phase S6 — Documentation, Swagger and tests

- **Objective:** make the docs true, and get 5,710 annotation lines out of `src/`.
- **Files:** `AGENTS.md` (the 97/3–80/20 correction is done; Socket.io and `isFrozen` are not),
  `03_SKELETON_STATUS.md` (it contradicts itself, L1, and `AGENTS.md` calls it the live source of
  truth), `MONEY_AND_LEDGER.md` (`round2`; the `markProcessing` transaction claim), `PHASE_05`
  (5 booking statuses documented, 7 in code), `docs/openapi/`.
- **Behaviour affected:** none.
- **Migrations:** none. **Tests:** `npm run validate:openapi` must still report 137/137 after the
  Swagger move — that script is what makes this refactor safe.
- **Risk:** very low. **Rollback:** trivial.
- **Acceptance:** every row in the audit's §9 "Code contradicts the docs" table is closed by
  fixing one side or the other, with a note saying which.

### Phase S7 — Final audit

- **Objective:** re-run the full-system audit against the simplified tree.
- **Acceptance:** no new CRITICAL or HIGH; the ~45-site duplication count is ~5; states down by
  4–6; models 25 → 22; `npm run verify` green; **and the specific check this repository's history
  demands** — for each consolidation, a test that fails against the pre-consolidation code, the
  same evidentiary bar the remediation set for itself.

**Sequencing note:** Phase 15 (AI) can start **in parallel from S2 onward**. It touches
`src/modules/ai/` and `wardrobe/`, neither of which S1–S5 modify beyond the M23 output
validation — which Phase 15 wants anyway.

---

## 11. Risk of NOT simplifying

Stated for balance, since "do nothing" is a real option:

- The 44 open MEDIUM/LOW findings cluster in the duplicated paths. Each new feature adds another
  copy — nine transition guards becomes ten.
- Phase 15 will add an AI module that calls booking, wardrobe and entitlement services. Building
  it on nine divergent transition guards and a TOCTOU capacity check widens the blast radius of
  every AI feature.
- Horizontal scaling is currently impossible without breaking crons and the revocation cache.
  That ceiling is documented for crons and **undocumented for the cache**.
- The dead-code decisions (`safety/`, `reliability/`, `isFrozen`) get harder, not easier, with
  every month they stay undecided — and `AGENTS.md` currently asserts an invariant that the code
  cannot enforce.

---

# DECISION

# **YES — SIMPLIFY**

### Why?

1. The complexity is **accidental, not essential** — the audit found only 3 over-engineering items
   and I confirm that; the real cost is ~45 sites where one rule is written many times.
2. **Nine divergent booking-transition guards** directly caused three CRITICAL/HIGH findings; a
   central table removes the entire bug class, not three instances of it.
3. **~20 copies of the ownership check disagree about admin bypass** — an authorization bug class
   waiting to fire.
4. **The `readyState === 1` guard is copied 9 times and its fallback is dead by construction**, so
   every money path reads as if atomicity is optional.
5. **`SubscriptionOrder` is a `Payment` by another name**, routed by a string-prefix hack, which
   is why subscription ledger entries are structurally invisible to the reconciliation job built
   to catch them.
6. **Settlement arithmetic lives in three places** and must agree; one pure function is both
   smaller and exhaustively testable.
7. **One module is entirely dead** (`reliability/`), two are empty, and four enumerated states are
   never written — while `AGENTS.md` asserts an invariant (`isFrozen`) that has no writer.
8. **22% of the source tree is Swagger annotation** inside `src/`, making every route change a
   two-file edit where the second file is bigger.
9. Phase 15 will build on these foundations; consolidating first narrows the blast radius of
   everything that comes after.
10. **None of this requires changing a single business rule** — which is exactly why it is worth
    doing now.

### What should be simplified?

1. Booking transitions → one table + one CAS repository primitive (**highest leverage**).
2. Settlement arithmetic → one pure `computeSettlement()`.
3. `resolveNoShow` → one transaction + a DLQ record for post-hoc steps.
4. `SubscriptionOrder` → folded into `Payment` with `purpose`; one webhook handler.
5. Ledger dual-writes → all through `postDoubleEntry` with a session.
6. Nine `readyState` guards → one `withOptionalTransaction`.
7. ~20 ownership checks → one `assertParticipant`.
8. `BlockedWord` + `BlockedDomain` → `BlockedTerm`; drop the substring fallback.
9. 7 crons → 6 (`otp-cleanup` → TTL index), timezone on all, indexes on the two full scans.
10. Dead code and dead states — **decided** (built or deleted), not left undecided.
11. Swagger out of `src/` (or generated from the Zod validators).
12. `notification.listener.js` → declarative event map.

### What MUST NOT be simplified?

Authentication and session security · authorization and `restrictTo` · webhook HMAC **and**
amount verification · every idempotency key and unique index · money arithmetic and the
decimal/piastre boundary · `LedgerEntry` and `SubscriptionHistory` immutability · the three-layer
offer-acceptance guard · the two-stage completion CAS · the in-transaction overlap check ·
`uniq_active_subscription_per_user` · atomic `consume()` · the four-branch cancellation matrix ·
the two no-show statuses and their distinct money · the penalty-debt model · the preventive
moderation gate and 3-strike ladder · `NODE_ENV` with no default and the placeholder-secret boot
refusal · the nightly reconciliation sweep · **and the dense rationale comments, which are this
repository's single best asset.**

### What features remain unchanged?

Every user-facing capability in §5. Registration, login, Google sign-in, multi-device sessions,
KYC verification, direct and broadcast requests, the stylist feed, offers and daily/active limits,
atomic offer acceptance, double-booking prevention, card payment via Paymob, coupons, escrow,
geolocated check-in, mutual completion, the four-tier cancellation quote, no-show filing /
contesting / arbitration, full and partial refunds, stylist penalty debt, payout batches, booking
chat, contact-exchange moderation, reports and strikes, push and in-app notifications, two-way
reviews, subscription plans and entitlements, admin grants, wardrobe AI classification, and the
admin dashboard.

**Two capabilities are restored** (KYC document viewing; the late-stylist-cancellation coupon) and
**two are resolved from limbo** by decision (payout freeze; reliability events).

### Estimated complexity reduction

**MEDIUM-to-HIGH on implementation surface. LOW on business rules.**

Grounded: models 25 → 22 · enumerated states ~61 → ~55 · crons 7 → 6 · modules 24 → 22–23 ·
duplicated rule sites ~45 → ~5 · non-Swagger source −8% to −15%, with a further −20% of the total
tree available if Swagger is relocated or generated. Dependencies: **unchanged at 31.**

The business-rule reduction is deliberately **LOW**, and that is the correct outcome. The rules
are already close to minimal for what Murafiq is, and the brief's own suggested booking reduction
fails on inspection.

### Production readiness impact

**Improves production readiness, and reduces production risk.**

- Every consolidation replaces divergent implementations with a single one, and in every case the
  divergence is *already* a known bug class (X4, X9, X10, the admin-bypass disagreement).
- Every proposal adds CAS or a transaction; **none removes one**.
- Two currently-broken capabilities are restored; two undecided ones are decided.
- The reconciliation job becomes capable of seeing failures it is currently blind to.
- No new infrastructure, no new dependencies, no new failure domains.

**The one item carrying genuine risk is the `SubscriptionOrder` → `Payment` merge** (Phase S3),
because it is money plus a data migration. It is deliberately scheduled behind the booking
consolidation, behind a differential test, behind a dual-read window, and behind a feature flag.
If the appetite for that risk is not there, **S3 can be dropped entirely** — the remaining phases
still deliver most of the value and carry materially less risk.

---

*Assessment only. No source files were modified. Phase 15 was not started. No findings were
fixed.*
