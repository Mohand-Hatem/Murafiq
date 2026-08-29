# Business Rules Revision — Implementation Handoff Prompt

> **What this file is:** a complete, self-contained briefing to hand to an AI coding assistant (or a
> new engineer) that will implement the Business Rules Revision. Paste the whole thing as the first message of a fresh
> session, then follow the session protocol in §7.
>
> **What this file is not:** the specification. That is
> `docs/REVISION_BUSINESS_RULES_AND_ARCHITECTURE.md`. This file tells the implementer *how to work*,
> *what will bite them*, and *what they are forbidden to do*. It deliberately does not duplicate the
> spec — duplicated specs drift.

---

## 0. STOP — read this before writing a single line

You are about to modify a **live marketplace that moves real money**. Five things are true and all
five have already caused, or nearly caused, a production defect in this codebase:

1. **This is Mongoose/MongoDB, not Prisma, not SQL.** The original requirements document assumed
   Prisma. If you find yourself reaching for a migration file, stop — this project has none. Schema
   changes are model edits plus a one-off idempotent script (precedent:
   `scripts/backfill-broadcast-visibility.js`).
2. **There is no Socket.IO in this project.** Not in `package.json`, not in `src/server.js`. Realtime
   is Firestore listeners (chat) and FCM (push). Any requirement mentioning "disconnect the socket"
   means *revoke the Firebase session and the JWT*.
3. **Mongoose strict mode silently discards unknown fields.** This is not theoretical. Today,
   `payment.service.js:238` writes `refundedAt: new Date()` to a Payment. `refundedAt` is not a
   schema path. Every refund timestamp this platform has ever produced is gone, with no error, no
   log, no test failure. **Whenever you write a field, confirm it exists on the schema.**
4. **`ApiError`, `ApiResponse`, and `asyncHandler` are bare globals**, injected by
   `src/common/globals.js` via `globalThis`. Do **not** add imports for these three. Every existing
   file uses them bare; adding an import is a style regression that reviewers will reject.
5. **`npm test` must pass before you touch anything.** The current baseline is **76 suites / 381
   tests** (it was 51/214 before this revision began). If it does not pass, the documented baseline
   is stale and you must resolve that first — you cannot prove you broke nothing without a green
   starting point. Confirm the live number against `docs/03_SKELETON_STATUS.md`, not this line.

---

## 1. Your role and the hard boundaries

You are a senior backend engineer working inside an existing, working modular monolith. Phases 0–13
are built and in use.

**Absolute rules — violating any of these fails the task:**

- **Modular monolith only.** No microservices. No new datastore. No Redis/BullMQ — that is
  deliberately deferred to Phase 14 (`docs/HARDENING_07_PHASE_RECONCILIATION.md`). If a design seems
  to need a queue, it is the wrong design for this phase.
- **One approved step at a time.** Present What / Why (with a named alternative) / How, then **stop
  and wait for explicit approval**. Never bundle unrelated changes. This is `docs/02_PROJECT_RULES.md`
  and it is not optional.
- **Never touch a file belonging to a later phase.** Phases 14 (Wardrobe) and 15 (AI) are not built.
  You will define entitlements for them (`wardrobe.photos.max`, `ai.messages.daily`) but you will
  **not** create enforcement call sites, because there is nothing to enforce against. That is correct
  and expected — do not "helpfully" stub the modules.
- **Do not invent business values.** Every question in spec §R is now closed — see the Decisions Log
  at the top of the spec, which is authoritative wherever it differs from older `[REC]` text further
  down. If you need a number that genuinely is not there, **stop and ask**. A plausible-looking
  invented price or quota that ships is worse than a blocked task, and this has already happened once
  on this project: an earlier pass invented a 15% stylist compensation and cut the platform fee from
  20% to 5%, changing revenue on every late cancellation.
- **Reuse before invention.** Check `src/common/` first: `QueryBuilder`, `ApiError`, `ApiResponse`,
  `asyncHandler`, the event bus, `businessDay.util.js`, `timeUtils.js`, the shared Zod validators.
- **Test-first in money code, no exceptions.** Anything touching payments, escrow, cancellation,
  refunds, penalties, payouts, or scheduling: write the failing test first. `AGENTS.md` mandates this
  and reviewers enforce it.

---

## 2. Required reading, in this order

Do not skim. Read fully before proposing your first step.

| # | File | Why |
|---|---|---|
| 1 | `AGENTS.md` | Cross-cutting invariants. Two of them are being deliberately amended by this phase — see §5. |
| 2 | `docs/02_PROJECT_RULES.md` | The approval-gated process you must follow. |
| 3 | `docs/03_SKELETON_STATUS.md` | **The only trustworthy statement of what is actually built.** Trust it over every other doc — including this one. It records the defects found in each Revision pass and which stages are genuinely complete. |
| 4 | `docs/REVISION_BUSINESS_RULES_AND_ARCHITECTURE.md` | **The specification.** Sections A–R. Your source of truth for this phase. |
| 5 | `docs/01_PROJECT_STRUCTURE.md` | File locations and naming. |
| 6 | `docs/MONEY_AND_LEDGER.md` | ⚠️ **Contains a cancellation policy the code has never implemented.** Read it to know what is wrong, not to learn what is true. Correcting it is Stage R0. |

Then read these source files end to end — they are the ones you will change and the ones most likely
to surprise you:

`src/modules/offers/offer.service.js` · `src/modules/bookings/booking.service.js` ·
`src/modules/payments/payment.service.js` · `src/modules/requests/request.service.js` ·
`src/modules/requests/request-feed.service.js` · `src/modules/payouts/payout.service.js` ·
`src/common/utils/businessDay.util.js` · `firestore.rules`

---

## 3. Business values — RESOLVED as of 2026-08-27

All eight blockers are answered. **Read the Decisions Log at the top of
`docs/REVISION_BUSINESS_RULES_AND_ARCHITECTURE.md`** — it is the authoritative table. Summary:

| Item | Final value |
|---|---|
| Enterprise client requests/day | **5** |
| Stylist plans | Free $0 · Basic $1/mo, $12/yr · Pro $2.50/mo, $30/yr · Enterprise $5/mo, $60/yr (yearly = 12× monthly) |
| Offers/day | 3 · 6 · 10 · 20 |
| Max **active** offers | Same as each tier's daily quota: 3 · 6 · 10 · 20 |
| Client no-show | Client refunded **60%**, stylist paid **20%**, platform **20%** |
| Coupon | **10%**, capped **150 EGP**, **14-day** expiry, single-use, no minimum booking, not stackable |
| Moderation detection | **Layers 1–4 are local and mandatory**: normalization + contact regex + domain denylist + curated word lists. Build these first; they must work standalone. |
| Moderation classifier | `MODERATION_PROVIDER`, **default `none`**. An `openai` provider is conditionally approved — **you may build it, you may not enable it** until the 4-point gate in spec §I.2 is signed off (pricing verified, rate limits, data residency, fail-open tested). Hard 2s timeout, **fail open**. |
| Moderation review roles | `operator` **or** `admin` reviews events and approves RESTRICT-list terms. **`admin` only** approves CRITICAL terms or confirms any money-moving violation. |
| Moderation gap cover | **"Report message" user action is a required deliverable** in both configurations, not a nice-to-have |
| CRITICAL auto-enforcement | **Out of scope for v1.** Do not build a `BlockedTerm` model or a word-match → refund path. Automatic money movement from a regex is a fraud vector; the 3-strike ladder + report queue is the design. |
| Mobile chat client | When it is built it must send via `POST /api/v1/chat/:conversationId/messages`. **Never write messages to Firestore directly** — Firestore is the realtime *read* path only. Writing directly would manufacture a migration problem this project does not currently have. |

**`[OPEN]` tags still in the spec are no longer blockers.** The product owner delegated every
remaining item to the stated recommendation. Each is a named constant in `common/constants/` —
implement the recommended value and continue. Do not stop to ask about them.

**No business decision is outstanding.** Two items that were previously listed as needing a human
were closed on 2026-08-28 after checking them against the code:

1. ~~An admin must approve the CRITICAL term list.~~ **Deferred out of v1.** There is no
   `BlockedTerm` model, no CRITICAL word list, and no path from a word match to a refund — so there
   is nothing to approve. Do not build automatic CRITICAL-term enforcement; the 3-strike ladder plus
   the user-report queue is the shipped design. See "Deferred out of v1" in the spec.
2. ~~The `firestore.rules` cutover.~~ **A deployment note, not a task.** This repo has no
   `firebase.json`/`.firebaserc` and no CI step that deploys rules, and there is no mobile client
   yet, so the §O.8 adoption sequence does not apply.

**The one thing still gated on a human** is the classifier: `MODERATION_PROVIDER` stays `none` until
the 4-point gate in spec §I.2 is signed off (pricing, rate limits, **data residency**, fail-open
proof). The default is fully functional. **Do not flip this flag yourself.**

**You still may not invent values.** If you hit something the spec genuinely does not cover, stop and
ask. "Not covered" is different from "tagged `[OPEN]` with a recommendation attached."

**Three `AGENTS.md` invariants are amended by this phase. Each needs explicit sign-off, and each must
be updated in `AGENTS.md` in the same commit that changes the behaviour:**

- `AGENTS.md:138` — *"One active (`pending`) offer per stylist–client pair at a time."* Requirement §7
  removes this rule entirely.
- `AGENTS.md:81-83` — *"Money: decimal EGP … piastres conversion happens **only** inside
  `paymob.provider.js` at the external boundary."* The new ledger stores integer piastres. Rationale
  in spec §G.1.
- `AGENTS.md:121-122` — *"`operator` role is scoped to exactly 3 verification routes — nothing else.
  Any other `/admin/*` route must reject an operator token with `403`."* `operator` gains the
  moderation review routes. It remains barred from CRITICAL-term approval and from any action that
  moves money — those stay `admin`-only.

`AGENTS.md` must be updated **in the same commit** that changes the behaviour. An invariant doc that
lies is worse than no invariant doc.

---

## 4. The five landmines in this codebase

These are the specific things that will go wrong if you are not looking for them.

### 4.1 `acceptOffer` is correct. Do not rewrite it.

`src/modules/offers/offer.service.js:107-184` contains a CAS lock, unique-index defence in depth, and
a bounded retry envelope that distinguishes a genuine business `409` from a MongoDB
`WriteConflict`/`TransientTransactionError`. This was built after a real, hard-won debugging session
(the history is in `docs/03_SKELETON_STATUS.md`). A previous version turned retryable transience into
a permanent, misleading "someone else already won" error.

**You will change the status string values in the CAS filter. You will change nothing else about the
control flow.** If your change makes this function simpler, you have broken it.

### 4.2 The `{requestId, stylistId}` unique index drop is irreversible

Verified present today:

```
Offer indexes: [ {stylistId,clientId,status}, {requestId,status}, {requestId,stylistId} UNIQUE ]
```

Requirement §7 needs it gone. **Once duplicates exist, this index can never be recreated.** Give it
its own deploy window, after the status backfill has been verified. Drop it explicitly
(`Offer.collection.dropIndex('requestId_1_stylistId_1')`), do not rely on `syncIndexes()` alone to
express the intent.

### 4.3 Enum widening must ship one deploy BEFORE any code writes the new values

Mongoose validates enums on write. In a rolling deploy, instance A writing `'OPEN'` while instance B
still has the narrow enum causes validation failures on read-modify-write paths. The order is:

```
deploy 1: widen enum (old + new both valid)  → no behaviour change
deploy 2: backfill script                    → data moves to new values
deploy 3: index drop                         → irreversible, own window
deploy 4: code writes only new values
deploy 5: narrow enum to new values only
```

Never collapse these into one deploy, even in staging. Staging is where you prove the sequence works.

### 4.4 The `firestore.rules` cutover can take chat down for every user

Today clients write messages **directly to Firestore** (`firestore.rules:42` grants participants
`create`). Moderation requires routing sends through `POST /chat/:conversationId/messages` and then
setting `allow create: if false`.

**If you flip the rule before the mobile client stops writing directly, every message send in
production fails instantly.** The order is non-negotiable:

1. Deploy the backend proxy path — both write paths working.
2. Ship the mobile client that sends via REST.
3. Wait for adoption ≥ 95% (direct Firestore writes are observable — measure, do not guess).
4. Only then flip the rule.

This step is gated on a mobile release you do not control. Confirm the timeline before you start
R9.

### 4.5 Moderation must run observe-only first

Ship the scanner recording `ModerationEvent` and **blocking nothing** for two weeks. Measure the
false-positive rate on real bilingual AR/EN traffic. Then enable blocking.

Turning on a regex-based blocker against live marketplace chat without that measurement silently
breaks legitimate conversations at scale, and you will not find out from a test — you will find out
from churn.

**Related:** never attach automatic money movement to a bare pattern match. A self-service full refund
behind a word filter is a fraud primitive — a malicious client baits the counterparty into a flagged
word and gets their money back. Refunds require an admin-confirmed or curated-CRITICAL verdict. Spec
§C.8 and §I.4.

---

## 5. Conventions you must match (non-obvious ones only)

- **Layering:** `Route → Validator (Zod, `.strict()`) → Controller → Service → Repository → Model`.
  Swagger lives in `<module>.swagger.js`, never inline in routes.
- **No cross-module model imports.** A module calls another module's *service*. The single documented
  exception is `auth.repository.js` importing `user.model.js`. Only `chat.service.js` may touch
  `firebase-admin`.
- **Domain events for side effects, not for the core write.** The write happens as one direct service
  call inside one transaction; events drive notifications and audit afterwards.
- **Audit logging is event-bus-driven only.** Add entries to `AUDIT_EVENT_MAP` in
  `audit-log.listener.js`. Never scatter `auditLogService.log()` calls through business logic.
  **Do not build a separate `SecurityAuditLog`** — the existing `AuditLog` covers it; add a
  `severity` field.
- **Business-day maths:** use `getBusinessDayRange()` from `src/common/utils/businessDay.util.js`.
  It already handles Africa/Cairo correctly, including a bug fix for month boundaries. Do not write
  new timezone arithmetic.
- **Booking times are integer minutes since midnight** (`timeToMinutes()`/`minutesToTime()`), never
  strings. String comparison silently breaks overlap detection.
- **GeoJSON is `[lng, lat]`** — the reverse of Google Maps order. A recurring bug source here.
- **Money in existing models:** decimal EGP, 2 places, `round2()`. **Money in the new ledger:**
  integer piastres. The conversion boundary is `ledger.service.post()` and nowhere else.
- **Named constants in `common/constants/`**, never magic numbers, for anything with a business rule
  attached.
- **Cron jobs** follow `src/jobs/offer-expiry.cron.js` exactly: idempotent registration guard,
  `NODE_ENV === 'test'` early return, and they rely on the PM2 `instances: 1` pin in
  `ecosystem.config.cjs`. Do not add a job that breaks under multiple processes.

---

## 6. Build order

Full detail in spec §P. Execute **one sub-phase per session.** Do not read ahead into later
sub-phases — this project has a documented history of assistants jumping ahead and breaking event-bus
dependencies.

| Phase | Scope | Depends on |
|---|---|---|
| **R0** | Corrections only: add `Payment.refundedAt` to the schema; delete `BOOKING_STATUS.PENDING`; delete dead `CLIENT_DAILY_REQUESTS_UNVERIFIED`; correct `docs/MONEY_AND_LEDGER.md`. **No new features.** | — |
| **R1** | Domain foundation: enum widening, new fields, indexes, backfill scripts, the irreversible index drop. | R0 |
| **R2** | Ledger: `LedgerEntry`, `ledger.service`, idempotency keys, opening-balance backfill, reconciliation job. Dual-write; ledger stays read-only at first. | R1 |
| **R3** | Subscriptions & entitlements: Plan/Subscription/UsageCounter, `entitlement.service`, Paymob flow. **Shadow mode first** — log what it *would* decide for one week before enforcing. | R1, R2 |
| **R4** | Request lifecycle: OPEN/PAUSED/reactivate, edit endpoint, auto-pause cron, **the broadcast feed fix**. **Also finishes Phase 12's leftover OTP-cleanup + session-reminder sweeps** — same folder, same pattern, build them together. | R1, R3 |
| **R5** | Offer lifecycle: multiple offers, active-vs-daily split, withdraw, `CLOSED` vs `REJECTED`. | R4 |
| **R6** | Cancellation, refunds, penalties: new percentages, `Penalty` model, payout netting. | R2 |
| **R7** | No-show: new statuses, filing + response window, auto-resolution job. | R6, R8 |
| **R8** | Coupons: model, issue/validate/redeem, booking-price integration. | R2 |
| **R9** | Chat moderation: scanner, records, `tokenVersion` revocation, enforcement chain, rules cutover. Observe-only → enforce. | R1, R6 |
| **R10** | Reliability: `ReliabilityEvent`, score, tiers, feed effects. | R5, R7 |
| **R11** | Admin & ops: moderation review queue, ledger explorer, reconciliation dashboard. | all |
| **R12** | Test & rollout: full matrix, load test on the quota path, staged rollout. **Also finishes Phase 13's leftover Swagger/docs and test-coverage audit.** | all |

> **Phases 12 and 13 are closed by this revision, not scheduled separately.** Their leftovers land in
> R4 and R12 — see "Closing Phases 12 and 13" in §P of the spec. When those two stages are done, mark
> both phases ✅ in `docs/03_SKELETON_STATUS.md` as part of their Definition of Done.
>
> **Redis/BullMQ stays out.** It was reassigned to Phase 14 by `HARDENING_07`. Every job in this
> revision runs on `node-cron`. Do not pull it forward.

R2 and R3 may run in parallel after R1. R8 may run in parallel with R6.

**Start with R0.** It is small, safe, independently valuable, and it proves the workflow before
anything risky happens.

---

## 7. Session protocol

For every sub-phase, in this exact order:

1. **Read** the required files (§2) and the relevant spec sections. State what you read.
2. **Confirm the baseline:** run `npm test`, show it passing. Run `npm run lint`, show it clean.
3. **Restate the scope** of this sub-phase in your own words, and explicitly list what you are
   *not* touching.
4. **Propose step 1 only** — What / Why (with a named alternative you rejected and why) / How. **Stop.
   Wait for approval.**
5. On approval: **write the failing test first** (mandatory in money/scheduling code), then the
   implementation.
6. **Verify:** run the full suite and show the output. For any race-condition guard, use this
   project's proven method — **sabotage the guard, confirm the test fails, restore it, confirm it
   passes.** A race test that has never been shown to fail proves nothing.
7. **Report** against the Definition of Done, item by item, stating *how* each was verified. Code
   inspection alone is not evidence in these modules.
8. **Update `docs/03_SKELETON_STATUS.md`** — this is part of Definition of Done, not cleanup.
9. Repeat from step 4 for the next step.

**Never claim something works because you wrote it.** Show the passing output.

---

## 8. Definition of Done (every sub-phase)

- [ ] Full `npm test` passes; output shown, not summarised.
- [ ] `npm run lint` clean.
- [ ] New/changed routes are under `/api/v1/`, have `authMiddleware` + correct `restrictTo(...)`, a
      `.strict()` Zod validator, and a complete `@swagger` block in `<module>.swagger.js`.
- [ ] Every list endpoint goes through `QueryBuilder`; every response through `ApiResponse.success()`
      or `next(new ApiError(...))`.
- [ ] Any new schema field was confirmed present on the schema after writing (see §0.3).
- [ ] Any multi-collection write is inside one Mongoose session.
- [ ] Any financial write carries an idempotency key and posts to the ledger.
- [ ] New indexes verified with `getIndexes()`, output shown.
- [ ] Any race guard proven by sabotage-and-restore.
- [ ] `docs/03_SKELETON_STATUS.md` updated to reflect reality.
- [ ] If an `AGENTS.md` invariant changed, `AGENTS.md` updated in the same commit.
- [ ] **If the stage changed behaviour that a `PHASE_XX_*.md` file documents, that file is updated in
      the same commit.** The phase file is the source of truth for its module (`AGENTS.md:15`), so
      leaving it describing the old rule makes it actively wrong. Known cases:
      `PHASE_04_REQUESTS_OFFERS.md` (request states, one-offer-per-pair, daily caps) ·
      `PHASE_05_BOOKINGS_SCHEDULING.md` (no-show statuses) ·
      `PHASE_06_PAYMENTS.md` + `MONEY_AND_LEDGER.md` (refund percentages, penalties) ·
      `PHASE_07_CHAT_NOTIFICATIONS.md` (moderation, Firestore write path) ·
      `PHASE_11_SAFETY_PAYOUTS.md` (payout netting) · `PHASE_12_BACKGROUND_JOBS.md` (new sweeps).
      For **Phases 14 and 15, which are not built**, add a forward-note rather than a correction:
      the per-plan wardrobe photo cap and AI message cap are defined by this revision and must be
      enforced when those phases are built.

---

## 9. Things you might reasonably do that would be wrong here

A short list of plausible-looking mistakes, so you can recognise them in your own output:

| Tempting | Why it is wrong here |
|---|---|
| Adding a "usage reset" cron job | `periodKey` + a TTL index makes reset implicit. A nightly mass-write over every user buys nothing. Spec §E.3, §L. |
| Splitting `CANCELLED` into `CANCELLED_BY_CLIENT` / `CANCELLED_BY_STYLIST` | `cancelledBy` is already a field. Splitting the enum breaks every existing query, index, and test for zero gain. Spec §F.3. |
| Auto-deleting excess wardrobe photos / closing excess offers on downgrade | Grandfather and block additions instead. Deleting a paying customer's content on a billing event produces chargebacks. Spec §E.5. |
| Storing `activeOfferCount` as a counter field | Counters drift the moment a status changes outside the increment path. Use a live `countDocuments` against an index. Spec §E.4. |
| Importing `ApiError` at the top of a new file | It is a `globalThis` bare global. Match the existing files. |
| Making the daily quota relative to the user's timezone | Lets a user harvest two quotas by changing a device setting. Africa/Cairo is platform-fixed and deliberate. Spec §E.3. |
| Adding Redis/BullMQ "since we need a queue anyway" | Deferred to Phase 14 by an explicit decision. `node-cron` covers every job in §L. |
| Failing closed when the moderation classifier times out | An outage must not halt the entire marketplace's chat. Fail open, record `SUSPECT`. Spec §I.2. |
| Rewriting `acceptOffer` to be cleaner | See §4.1. |
| Picking a sensible default for a §R blocker | See §3. Stop and ask. |

---

## 10. First message you should send back

Do not write code. Reply with:

1. Confirmation that you have read `AGENTS.md`, `docs/02_PROJECT_RULES.md`,
   `docs/03_SKELETON_STATUS.md`, and `docs/REVISION_BUSINESS_RULES_AND_ARCHITECTURE.md` in full.
2. The output of `npm test` and `npm run lint`.
3. Confirmation that you have read the **Decisions Log** at the top of the spec, and that you will
   implement its values rather than the older `[REC]` text further down the document where the two
   differ (the Decisions Log wins).
4. Your proposed **step 1 of Stage R0**, in What / Why / How form, with a named alternative.
5. Then stop and wait.
