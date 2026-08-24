# Hardening 7 — Phase Reconciliation (Phases 9–16)

## Goal

Make every remaining phase document **executable as written**. Phases 9–16 were specified before
Phases 0–8 were built, and reality drifted. Several phase docs reference functions that don't exist,
use a module syntax the project doesn't use, and duplicate work that `HARDENING_01`–`06` now delivers.

Running them as written today would produce broken code or duplicated modules. This document is the
diff between what those phase docs assume and what will actually be true when you get there.

## Depends on

`HARDENING_01`–`06`. Read this **before** starting any phase from 9 onward.

## How to use this document

This is a **reference**, not a step list — it has no "Steps" section of its own. Before starting
Phase N, read this document's Phase N section, apply the amendments to that phase doc, then run the
phase normally per `02_PROJECT_RULES.md`.

---

## Part 1 — Cross-cutting problems affecting every remaining phase

These break **all** of Phases 9, 10, 12, 14, and 15. Fix them once, here, rather than rediscovering
each one mid-phase.

### 1.1 Every code sample is CommonJS. The project is ESM.

`package.json` declares `"type": "module"`, and `02_PROJECT_RULES.md` states **"ESM only — `import`/
`export`, never `require`."** But the code samples in the remaining phase docs use CommonJS
throughout:

| Doc | Sample |
|---|---|
| `PHASE_09` Step 8 | `module.exports = { send: (opts) => provider.send(opts) };` |
| `PHASE_12` Steps 1–3 | `const IORedis = require('ioredis'); … module.exports = connection;` |
| `PHASE_15` Steps 2–3 | `exports.chat = …`, `module.exports = { name: 'searchStylists', … }` |

**Amendment:** treat every code block in Phases 9–16 as pseudocode for shape, not syntax. Convert to
ESM. An assistant that copies these verbatim will produce files that crash on import.

### 1.2 `catchAsync` doesn't exist. The global is `asyncHandler`.

`PHASE_15` Step 2 uses `catchAsync(...)`. The project attaches `asyncHandler` (from
`express-async-handler`) to `globalThis` in `src/common/globals.js`, alongside `ApiResponse` and
`ApiError`. There is a file named `src/common/utils/catchAsync.js`, but it is **not** what controllers
use — every existing controller uses the bare `asyncHandler` global with no import.

**Amendment:** use `asyncHandler`, `ApiError`, and `ApiResponse` as bare globals, matching every
existing controller. Do not add per-file imports for these three.

### 1.3 The mail service is `sendMail()`, not `send()`

`00_PHASES_INDEX.md` states the mail signature **"must stay identical"** so Phase 9 is a drop-in
replacement. But the shipped shim exports `sendMail`:

```js
// src/modules/mail/mail.service.js
export default { sendMail };
// called as: mailService.sendMail({ to, subject, html })  ← auth.service.js:43, :85, :198
```

`PHASE_09` Step 8 and `PHASE_12` Steps 3/5 both specify `mailService.send(...)`. Building Phase 9 as
written **breaks all three auth mail flows** (register, resend-OTP, forgot-password) with a
`TypeError`.

**Amendment:** keep the name `sendMail` and update Phases 9 and 12 to match — renaming the shipped
function to satisfy a doc is backwards. Also note `HARDENING_03` Step 4 changes `sendMail` to throw
`ApiError` rather than a bare `Error`; preserve that when Phase 9 replaces the shim.

### 1.4 [RESOLVED] Phase 10's `AUDIT_EVENT_MAP` referenced events that didn't exist

**Historical note — fixed directly in `PHASE_10_AUDIT_ADMIN.md`, kept here for context.** The
original `AUDIT_EVENT_MAP` sample referenced `OFFER_ACCEPTED`, `BOOKING_CREATED`, `USER_SUSPENDED`,
`USER_REACTIVATED`, `DISPUTE_RESOLVED`, and `REVIEW_HIDDEN` before any of them were defined in
`src/common/constants/events.constant.js` — all six now exist. Two problems outlived that fix and
have since been corrected in the phase doc itself:

- **`REVIEW_CREATED`** was never a real constant; the actual one is `REVIEW_SUBMITTED`.
- **`PAYOUT_STATUS_CHANGED`** was never real either, and never will be — `payout.service.js` emits
  four granular events instead (`PAYOUT_CREATED`/`PROCESSING`/`PAID`/`FAILED`). The map now lists
  all four individually.

Because `EVENTS.X` for an undefined key evaluates to `undefined`, and `EventEmitter` accepts
`undefined` as a valid key, an unfixed reference like this doesn't throw — it silently collides every
mistyped key onto one channel. `tests/unit/event-graph.test.js` now catches a listener with no
matching emitter, but confirming against `events.constant.js` before writing the map is still
cheaper than waiting for a test to fail.

### 1.5 [RESOLVED] `.env.example` was missing 9 required variables

**Fixed** during the v1-scope/Paymob-activation pass. `.env.example` now matches
`src/config/env.config.js` exactly, including the `API_URL` and `PAYMOB_API_KEY` vars added in that
same pass (see `03_SKELETON_STATUS.md` §7 for the full list of what changed and why). `PHASE_13`
Step 6's "no drift" checklist item is now actually true — re-verify it stays true as new vars are
added, don't re-diff from scratch.

---

## Part 2 — Phase-by-phase amendments

### Phase 9 — Uploads & Mail — ✅ DONE (2026-08-25)

**Fully delivered.** Both halves built, tested, lint clean. `44 suites / 192 tests`. Kept here for
context on what was decided along the way — nothing left to do in this phase.

| Piece | State |
|---|---|
| Multer middleware, Cloudinary service, `POST /uploads/:folder`, folder allow-list, size/MIME limits | **Done** by `HARDENING_03` Step 1 |
| Upload architecture, private KYC folder, KYC internal-reference intake | **Done** — verified pre-existing, see prior note below |
| Sharp compression (resize + per-format encode, PDFs correctly skipped) | **Done** |
| Mail provider interface, Resend provider, SendGrid 501 stub, provider selection, 5 templates | **Done** |

**Decisions made along the way:**

1. **Upload architecture** was never actually in conflict — `upload.service.js` exports
   `uploadFile()` as a plain function *and* it's wired to `POST /uploads/:folder`; both patterns
   this section originally worried about already coexisted.
2. **Private folder for identity documents** was also already correct — `type: 'authenticated'` /
   `access_mode: 'authenticated'` on the `kyc-documents` folder, plus `getSignedKycUrl()`.
3. **KYC raw-URL intake** was already closed — `user.validator.js` takes `documentRef`, not a URL.
4. **SendGrid stays a stub, by decision** — `send()` throws `ApiError(501, 'SendGrid provider not
   yet implemented')`. Not a placeholder to fill in later without a decision; revisit only if Resend
   needs a real fallback.
5. **PDFs are excluded from Sharp compression** — `upload.service.js` only compresses when
   `file.mimetype.startsWith('image/')`, so `kyc-documents` PDF uploads pass through untouched.
   This wasn't explicitly speced; it was a correct catch — Sharp cannot decode PDFs and would have
   corrupted them. **Not yet covered by a test** — see follow-up below.

**Follow-ups, not blockers — carry into whichever phase touches these areas next:**

- `welcomeTemplate` and `bookingConfirmationTemplate` are built and unit-tested but **called from
  nowhere in `src/`.** No welcome email fires on registration; no confirmation email fires on
  booking creation. Wire these in when touching registration (`auth.service.js`) or booking creation
  (`booking.service.js`) next — don't let it become an assumed feature that was never actually built.
- The PDF-skip guard above has no regression test. A future refactor could remove the `startsWith('image/')`
  check with nothing failing. Worth a one-line test whenever `upload.service.js` is next touched.

---

### Phase 10 — Audit Log & Admin

**Status as of 2026-08-24: ~75% already delivered** (updated — a session after this document was
first written closed most of what it originally listed as missing).

| Piece | State |
|---|---|
| `audit-log.model.js`, listener, `GET /admin/audit-logs` | **Done** by `HARDENING_03` Step 5 |
| Dispute resolution (`GET /admin/bookings/disputed`, `PATCH .../resolve-dispute`) | **Done** by `HARDENING_05` Section B2 |
| Suspend/reactivate (`PATCH /admin/users/:id/suspend`, `/reactivate`) | **Done** — full route, validator, controller, service, and `USER_SUSPENDED`/`USER_REACTIVATED` events, wired into the audit-log listener |
| `GET /admin/users` (list/search) | **Not done** |
| `GET /admin/dashboard/stats` | **Not done** |
| Review hide/unhide | **Done, single-toggle route** — `PATCH /admin/reviews/:id/hide` takes `{ isHidden: boolean }` and emits `REVIEW_HIDDEN`/`REVIEW_UNHIDDEN` depending on the value. **Do not add a separate `/unhide` route** — the capability already exists. |
| Admin/operator middleware carve-out | **Already correct** in `admin.routes.js` |

**Important:** `PHASE_10` Step 3 specifies the dispute-resolution contract in real detail — `outcome:
'completed' | 'cancelled'`, optional `refundPercentage`, and the rule that resolving as `'completed'`
emits `SessionCompleted` so the booking becomes payout-eligible. **This answers most of
`HARDENING_05` Section A2.** See Part 3 below.

**Conflicts (fixed directly in `PHASE_10_AUDIT_ADMIN.md` — Part 1.4 below is now historical):** the
`AUDIT_EVENT_MAP` doc previously referenced `EVENTS.PAYOUT_STATUS_CHANGED`, which does not exist —
`payout.service.js` emits four granular events (`PAYOUT_CREATED`/`PROCESSING`/`PAID`/`FAILED`)
instead. Also `REVIEW_CREATED` → the real constant is `REVIEW_SUBMITTED`. Both corrected in the
phase doc itself. Step 2's constraint note about `ipAddress`/`userAgent` not being available in
domain-event payloads is correct and worth honoring — don't fake it.

**Remaining scope for Phase 10:** `GET /admin/users` and `GET /admin/dashboard/stats` only.

---

### Phase 11 — Safety & Payouts

**Status after hardening: payouts ~70% delivered, safety 0%.**

`PHASE_11` Part B is genuinely well-specified — manual payouts, `pending → processing → paid`,
`bank_transfer | vodafone_cash`, the pending-balances aggregation with disputed/safety exclusions, and
double-payout prevention via a `payoutId`/`payoutStatus` marker on Booking. `HARDENING_05` Section B1
implements the ledger-correctness constraints on top of it.

**One gap the phase doc doesn't cover:** `payout.model.js` records `method` and `reference` but there
is **no field anywhere for the stylist's actual bank account or wallet number**. An admin cannot
execute a transfer without it. This is new PII and needs the same handling as KYC documents.

**Second gap:** the aggregation excludes bookings *currently* disputed, but nothing prevents a dispute
filed **after** a payout has been made. `HARDENING_05` A2.3 (filing window) is the fix — tie the
dispute window to the payout eligibility delay so they can't overlap.

**Part A (Safety) is entirely unbuilt** and depends on nothing from hardening — build as written.
Two notes: `POST /safety/sos` needs a rate limiter (`PHASE_13` Step 1 calls for it), and the live
location piggyback writes to `conversations/{bookingId}/liveLocation`, which must be covered by the
tightened Firestore rules from `HARDENING_02` Step 7 — those rules restrict conversation-document
updates to `lastMessageAt` only, so **`liveLocation` must be explicitly allowed or written via the
Admin SDK.** Building Phase 11 without checking this will produce silent permission-denied failures.

---

### Phase 12 — Scheduled Jobs (re-scoped, formerly "Background Jobs")

**Status as of 2026-08-24: re-scoped and ~35% delivered.** `PHASE_12_BACKGROUND_JOBS.md` was
rewritten wholesale during the v1-scope pass — it no longer specs BullMQ/Redis at all. Read the
current file, not this summary, before implementing; this entry exists so the reasoning isn't lost.

**What changed and why:** the original five queues split into three recurring sweeps (cron-shaped)
and two per-item retryable jobs (queue-shaped):

| Original queue | Now |
|---|---|
| `offer-expiry` | **Done** — `src/jobs/offer-expiry.cron.js`, in-process `node-cron`, wired into `server.js` |
| `otp-cleanup` | This phase, `node-cron` — not yet built |
| `session-reminder` | This phase, `node-cron` — not yet built, needs `reminderSentAt` added to `booking.model.js` |
| `mail` | **Moved to Phase 14** — that's where Redis/BullMQ actually gets installed |
| `notification` | **Moved to Phase 14**, same reason |

**`offerRepository.expireOldOffers()` being dead code was a real, live bug** (defined, never called —
`03_SKELETON_STATUS.md` §4 used to claim otherwise) and is **fixed**, not merely planned. It doesn't
need re-fixing in this phase.

Remaining corrections for the two new cron jobs:
1. **CommonJS throughout** (Part 1.1) — any code you write should be ESM, matching
   `offer-expiry.cron.js`'s existing pattern, which the rewritten phase doc now points at directly.
2. **`mailService.send` → `sendMail`** (Part 1.3) — moot for this phase specifically now that mail
   moved to Phase 14, but still applies wherever mail is eventually queued.
3. **No `redis.config.js`, no `bullmq`/`ioredis` here.** Phase 14 owns that installation now — see
   its updated "Depends on" section. Installing it in this phase would just mean redoing the
   provisioning story twice.
4. **`reminderSentAt` doesn't exist on `booking.model.js`.** Still true, still needed for the
   session-reminder cron job.
5. **Bull Board at `/admin/queues`** moves to Phase 14 along with the queue infrastructure it
   dashboards. Still respect `HARDENING_03` Step 7's decision about exposing dashboards in
   production when it lands there.

---

### Phase 13 — Security, Logging, Docs, Tests

**Status after hardening: ~70% already delivered.** This phase was written as the catch-all hardening
pass — most of it is what the audit found and `HARDENING_01`–`06` fix.

| Phase 13 checklist item | Now covered by |
|---|---|
| `.strict()` on every validator | `HARDENING_04` Step 4 |
| Rate limiting on `/payments/callback` | `HARDENING_01` Step 1 |
| Rate limiting on `/auth/*` (OTP routes) | `HARDENING_03` Step 2 |
| Upload MIME/size validation | `HARDENING_03` Step 1 |
| Refresh tokens hashed + rotated | Already true; `HARDENING_03` Step 6 fixes invalidation |
| Secrets in `.gitignore` | Already true for `.env`; `HARDENING_06` Step 0 fixes `docs/` |
| No user-enumeration in error messages | Already correct in auth |
| Swagger audit | `HARDENING_03` Step 7 |
| Index/`explain()` pass | `HARDENING_04` Step 6 |
| `.env.example` matches schema | Part 1.5 above |

**Genuinely still to do at Phase 13:**

- **Correlation/request IDs** (Step 2) — a `req.id` UUID middleware threaded through every log line.
  Not covered by any hardening doc; genuinely useful and genuinely missing.
- **The full end-to-end test** (Step 4) — register → verify → admin-verify → search → request → offer
  → accept → pay → chat → check-in → confirm → review. This is the single highest-value test in the
  project and it does not exist. It only becomes possible after `HARDENING_02` Step 9 provides a real
  test database.
- **Coverage thresholds** in `jest.config.js` — note there is currently **no `jest.config.js` file at
  all**; config lives inline in the `package.json` test script.
- **`npm audit`** clean.
- **CORS review** — `app.js:27` uses `origin: env.CLIENT_URL || '*'`. Since `CLIENT_URL` always has a
  default the `*` branch is unreachable, but it only supports **one** origin, which will break the
  moment there's a staging frontend or a mobile web build.

**Amended scope for Phase 13:** request IDs, the end-to-end test, coverage thresholds, `npm audit`,
multi-origin CORS. Everything else is verification that hardening held.

---

### Phase 14 — Wardrobe

> See `docs/AI_ASSISTANT_BRIEF.md` for the product framing (business logic, occasion-matching
> requirement, n8n ruling, open decisions) this phase and Phase 15 implement.

**Status as of 2026-08-24: 0% delivered, but now owns more than it did when this section was
written.** `PHASE_14_WARDROBE.md` itself was amended directly — read it, not this summary, for
current steps. Corrections that still apply, plus two that reversed:

1. **`POST /wardrobe` takes `{ imageUrl }`** — a raw client-supplied URL, the same pattern
   `HARDENING_03` Step 5 removes from KYC uploads for the same reasons. **Still unfixed** — amend to
   accept an internal upload reference from `POST /uploads/wardrobe` when this phase is implemented.
2. **[REVERSED] No longer depends on Phase 12 for a classification queue.** Phase 12 was re-scoped
   to node-cron-only scheduled sweeps and never installs BullMQ. Phase 14 now installs and owns
   Redis + BullMQ itself (see its new Step 0) — it doesn't wait on anything for this.
3. **[REVERSED] Env vars are no longer required — they're optional, and Phase 14 is where that
   changes back.** `OPENAI_API_KEY`, `VECTOR_DB_URL`, `VECTOR_DB_API_KEY` were made `.optional()`
   during the v1-scope pass (they were `secret()` — required in production — for variables nothing
   read, which would have blocked a v1 boot on meaningless secrets). They are now correctly present
   in `.env.example` (Part 1.5 is resolved). Phase 14 is where they should be promoted back to
   `secret()`, once the classification worker actually calls them.
4. **No vector DB or OpenAI package is installed** — `03_SKELETON_STATUS.md` §9 confirms this.
   Phase 14 installs them for the first time. Budget for choosing between Pinecone and Qdrant — the
   spec never decides (see `docs/AI_ASSISTANT_BRIEF.md` open decision #1).
5. The `DELETE /wardrobe/:id` → delete-the-vector requirement is the kind of thing that silently rots.
   Make it a test, not a checklist line.

---

### Phase 15 — AI Skeleton

**Status after hardening: 0% delivered.** Two blocking corrections:

1. **CommonJS + `catchAsync`** (Part 1.1, 1.2).
2. **The dependency claim is circular and currently false.** `PHASE_15` Step 5 states *"`OPENAI_API_KEY`
   and the vector DB credentials are already **required** in `env.config.js` as of Phase 14"* and
   *"the vector DB SDK … installed and required as of Phase 14"*. Phase 14 has **not** been built, so
   no SDK is installed. `getOutfitSuggestions` — the one tool this phase implements for real — depends
   entirely on `wardrobeService` and a populated per-user vector index. **Phase 15 cannot be started
   before Phase 14 is complete.** `00_PHASES_INDEX.md` already encodes this dependency; the point is
   that `03_SKELETON_STATUS.md` claims both are already active, which would mislead anyone starting
   here.

---

### Phase 16 — Deployment Readiness

**Status after hardening: partially delivered.** `HARDENING_06`'s Definition of Done includes the
go-live checklist (remove `MAIL_TO_ADDRESS`, set `PAYMENT_PROVIDER=paymob`, rotate dev-default
secrets, verify `trust proxy`, run `seed:admin`).

**Still open:**

- **The hosting decision has not been made.** The doc presents Railway/Render *and* a Docker/VPS path
  in full and explicitly says the choice is unmade. Decide before starting.
- **MongoDB replica set is now mandatory, not optional.** `HARDENING_01` Step 3 makes transactions a
  hard requirement — a standalone MongoDB will fail booking creation. Atlas provides this by default;
  a self-hosted VPS deployment must configure it. This is a **deployment blocker** the phase doc
  doesn't currently flag.
- **`trust proxy` must match the chosen host's hop count** (`HARDENING_01` Step 5).
- `.env.example` drift (Part 1.5) blocks a documented-setup deploy today.

---

## Part 3 — Correction to `HARDENING_05_BUSINESS_GAPS.md`

`HARDENING_05` Section A asks the repo owner to decide the payout rail, dispute outcomes, and escrow
release trigger. **Having now read `PHASE_10` and `PHASE_11` in full, most of that is already decided**
— I over-asked. The existing answers:

| `HARDENING_05` question | Already answered in |
|---|---|
| A1.1 Payout rail | `PHASE_11` Part B — manual `bank_transfer` / `vodafone_cash`, admin-executed outside the system, recorded via `reference` |
| A1.2 Escrow release trigger | `PHASE_11` Part B.2 — on `SessionCompleted` + `Payment.status === 'paid'`, excluding disputed bookings and open safety reports |
| A1.3 Cadence | `PHASE_11` Part B.2 — admin-initiated batches, no fixed schedule |
| A1.5 Failed payouts | `PHASE_11` Part B — manual admin resolution |
| A2.1/A2.2 Dispute outcomes | `PHASE_10` Step 3 — `outcome: 'completed' \| 'cancelled'` + optional `refundPercentage` override |
| A2.4 Does a dispute freeze payout | `PHASE_11` Part B.2 — yes, excluded from the aggregation |

**Genuinely still undecided** — these four remain real questions:

1. **A1.4 — stylist bank/wallet details.** No field exists on any model. Required before a payout can
   actually be executed.
2. **A2.3 — the dispute filing window.** Nothing prevents a dispute on a booking completed months ago,
   after payout. `PHASE_11`'s exclusion logic only handles disputes filed *before* the aggregation runs.
3. **A3 — stylist cancellation consequences.** Not addressed in any phase doc.
4. **A4 — the 2/day and 5/day caps.** Not addressed in any phase doc.

**Amendment:** revise `HARDENING_05` Section A down to these four questions, and change Section B to
"implement `PHASE_11` Part B with the ledger constraints below" rather than designing payouts from
scratch. The design already exists — it just needs the corrected payment record underneath it.

---

## Definition of Done

- [ ] `.env.example` contains all 9 missing variables and matches `env.config.js` exactly.
- [ ] `events.constant.js` defines every key referenced by `PHASE_10`'s `AUDIT_EVENT_MAP`, and the startup assertion from `HARDENING_02` Step 1 passes.
- [ ] `PHASE_09`, `PHASE_12`, `PHASE_15` code samples converted to ESM, or annotated "pseudocode — convert to ESM".
- [ ] `PHASE_09` and `PHASE_12` reference `sendMail`, not `send`.
- [ ] The upload-architecture contradiction between `PHASE_09` Step 4 and `04_ROUTES.md` is resolved and recorded.
- [ ] Each of Phases 9, 10, 11, 13 carries a note stating which of its steps hardening already delivered.
- [ ] `PHASE_11` amended with a stylist bank/wallet details field.
- [ ] `PHASE_11` amended to note the `liveLocation` Firestore-rules interaction.
- [ ] `PHASE_12` amended: `expireOldOffers` is dead code today and this phase is what activates it; `reminderSentAt` must be added to `booking.model.js`.
- [ ] `PHASE_14` amended to take an upload reference, not a raw `imageUrl`.
- [ ] `PHASE_15` amended to remove the false "already installed as of Phase 14" claims.
- [ ] `PHASE_16` amended: replica set is mandatory; hosting decision recorded.
- [ ] `HARDENING_05` Section A reduced to the four genuinely-open questions.
