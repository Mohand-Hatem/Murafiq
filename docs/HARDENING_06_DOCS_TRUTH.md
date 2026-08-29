# Hardening 6 — Documentation Accuracy

## Goal

Make the documentation describe the system that exists. Right now several docs assert that unbuilt
modules and uninstalled packages are "Active", which is worse than having no docs at all — it causes
both humans and AI assistants to build on top of things that aren't there.

## Depends on

Everything else. This runs **last**, so the docs describe what actually shipped rather than what was
intended.

---

## Steps

### 0. Un-ignore the docs (do this immediately, not last)

`.gitignore` currently contains:

```
docs/
AGENTS.md
AGENT.md
```

**The entire specification — every phase doc, every hardening doc, this file — is untracked.** The
only other copy is an untracked `docs.rar` in the repo root. There is no version history for any
planning decision, and a fresh clone gets nothing.

**Changes.** Remove those three lines, commit `docs/` and `AGENTS.md`, delete `docs.rar`. Confirm
`.env` **stays** ignored (it currently is, correctly — `.env.example` is the tracked template).

> This is the one step in this document that should happen **before** all the other hardening work, not
> after. It's listed here for completeness but is also in `HARDENING_01_CRITICAL.md`'s Definition of Done.

---

### 1. Correct `03_SKELETON_STATUS.md` — ✅ ALREADY DONE

> [!NOTE]
> **This step was pulled forward and completed during the audit.** `03_SKELETON_STATUS.md` has been
> rewritten against commit `3ace8c8` and is now the verified current-state reference that every
> hardening and phase session reads for context. It carries a "verified against commit" line and a
> maintenance note requiring it to be updated as part of every Definition of Done.
>
> **Nothing to do here except keep it current.** The table below records what was wrong, for the
> record — do not re-do the rewrite.

This file exists specifically to answer *"is X actually working right now, or is it a placeholder?"*
It **was** the least accurate file in the repository. What was wrong, verified against the code:

| Claim in the doc | Reality |
|---|---|
| §1 `paymob.provider.js` — "✅ Active. **Fully implemented**" | Code exists, **zero tests**, and until `HARDENING_02` Step 3 it is fed an empty customer object so every transaction carries placeholder billing data. Untested network code isn't "Active" — mark it **Sandbox-untested**. |
| §2 Templates (welcome, OTP, verify-email, forgot-password, booking-confirmation) — "✅ Active" | No `mail/templates/` directory and no `mail/providers/` directory exist. Only the Phase-1 shim `mail.service.js`. The OTP email is a string literal at `auth.service.js:17`. |
| §2a Firestore Security Rules — "✅ Active" | The file exists but permits message tampering and participant injection until `HARDENING_02` Step 7. |
| §2a `chat.service.js` — "✅ Active" | Silently falls back to in-memory `Map`s when Firebase isn't initialized (`HARDENING_03` Step 3). |
| §3 `getOutfitSuggestions` tool — "✅ Active" | `src/modules/ai/` contains only a `.gitkeep`. |
| §3 OpenAI SDK / Pinecone-Qdrant — "✅ Active (since Phase 14)" | **Not installed.** |
| §3a Wardrobe model, endpoints, worker, vector index — "Built in Phase 14" | **`src/modules/wardrobe/` does not exist.** |
| §4 `expireOldOffers()` — "✅ Active" | Lazy expiry-on-read is real (`request.service.js:79`). The BullMQ sweep is correctly marked pending. |
| §5 Safety SOS + live location — "Built in Phase 11" | `src/modules/safety/` contains only a `.gitkeep`. |

**Changes.** Rewrite the file to reflect Phases 0–8 plus the 4-route admin slice, adjusted for whatever
`HARDENING_01`–`05` actually delivered. Add a "last verified against commit `<sha>`" line at the top —
the failure mode here was a status file drifting from reality with nothing forcing a re-check.

---

### 2. Correct `01_PROJECT_STRUCTURE.md`

§2's technology table marks as **Active**:

- **"File Storage: Cloudinary + Multer"** — neither package is in `package.json`
  (fixed by `HARDENING_03` Step 1; update the row to match what ships).
- **"Queue/Jobs: BullMQ + Redis — Active (limited job set)"** — `bullmq` is not installed, no Redis
  client is installed, `jobs/queues/` and `jobs/workers/` are empty. Mark as **not built**.
- **"Realtime (chat & notifications) … Active from Phase 7"** — chat is real; the Socket.io half is
  not (see `HARDENING_04` Step 2).
- **"Testing: Jest + Supertest (unit + integration) — Active from Phase 1"** — until `HARDENING_02`
  Step 9, the integration suites mock every repository and touch no database.

§3 principle 3 — **"No cross-module DB access. Module A never imports Module B's Mongoose model. It
calls Module B's service."** This is violated in **16 places across 8 files**, e.g.:

```
booking.service.js       → requestRepository, offerRepository, paymentRepository
review.service.js        → bookingRepository, stylistRepository, userRepository
notification.listener.js → requestRepository, offerRepository, bookingRepository
offer.service.js         → requestRepository, userRepository
payment.service.js       → bookingRepository
request.service.js       → userRepository, stylistRepository
stylist.service.js       → userRepository
```

**Changes.** Make a decision and write it down: either (a) enforce the rule and refactor those services
to call foreign **services** instead of foreign repositories, or (b) relax the rule to "no cross-module
**model** imports; repository imports are permitted" — which is what the code actually does, and is a
defensible position. Do **not** leave a principle stated that the codebase contradicts everywhere. If
(a), that's a substantial refactor and deserves its own document.

§4's folder tree also lists directories that don't exist (`scheduling/`, `wardrobe/`, `payouts/`,
`safety/`, `mail/templates/`, `mail/providers/`, `notifications/sockets/`) and misses files that do
(`bookings/schedule.model.js` and `schedule.repository.js` live in `bookings/`, not a separate
`scheduling/` module). Mark unbuilt paths as planned rather than presenting them as current.

---

### 3. Correct `04_ROUTES.md`

The table presents planned and built routes identically. Verified gaps:

- **`/admin` lists 19 routes; 4 exist** (`verifications` list/approve/reject, `reviews/:id/hide`).
  Missing: user list/suspend/reactivate, disputed bookings, resolve-dispute, safety reports, all 5
  payout routes, audit-logs, dashboard stats, queues, review unhide.
- **`GET /health`** — documented as "Mongo + **Redis** status"; checks Mongo only.
- **`GET /docs`** — documented as "🔓 (or 🛡️ **in prod**)"; mounted unconditionally with no auth.
- Entire route groups documented but not built: `/safety/*`, `/uploads/*`, `/wardrobe/*`, `/ai/*`,
  `/stylists/me/payouts`, `/bookings/:id/live-tracking`.

**Changes.** Add a **Status** column (✅ built / 🔲 planned) rather than deleting planned rows — the
roadmap value is real, the ambiguity isn't. Update as `HARDENING_03`/`05` add routes.

---

### 4. Fix inaccurate code comments

Comments that assert behaviour the code doesn't have — each one has misled at least one reader already:

| Location | Comment | Reality |
|---|---|---|
| `booking.service.js:108` | "Non-fatal if firestore is offline during creation; **service listeners will retry/sync**" | No retry or sync mechanism exists anywhere. The error is swallowed and the conversation is simply never created. |
| `businessDay.util.js:4` | "Returns start and end Date objects for the current calendar day **in BUSINESS_TIMEZONE ('Africa/Cairo')**" | Returns **UTC** midnight bounds. Fixed by `HARDENING_02` Step 6 — update the comment to match the fix. |
| `firestore.rules:44` | "Participants can update message **read receipts (deliveredAt / seenAt)**" | The rule permits updating *any* field including `content` and `senderId`. Fixed by `HARDENING_02` Step 7. |
| `sockets/index.js:3` | "Socket events will be wired in **Phase 7**" | Phase 7 shipped chat on Firebase instead. Never wired. |
| `03_SKELETON_STATUS.md` §2 warning block | `MAIL_TO_ADDRESS` sandbox redirect "remove before go-live" | Still active. Add it to the go-live checklist so it isn't forgotten. |

---

### 5. Write the missing docs

A production SaaS needs these and none exist:

1. **`README.md`** — the repo has **no README at all**. Setup, env vars, how to run tests, how to seed
   an admin (`HARDENING_01` Step 6), how to run the local replica set (`HARDENING_01` Step 3).
2. **`DATA_MODEL.md`** — the 8 collections (`User`, `StylistProfile`, `Request`, `Offer`, `Booking`,
   `ScheduleBlock`, `Payment`, `Review`, `Notification`) plus the Firestore `conversations` tree,
   their relationships, and **every index and why it exists**. Currently discoverable only by reading
   8 model files.
3. **`AUTH_AND_PERMISSIONS.md`** — the 4 roles, the dual cookie/Bearer token scheme, token lifetimes
   and rotation, and a route × role matrix. The `operator` boundary ("only 3 verification routes") is
   currently asserted in prose in `01_PROJECT_STRUCTURE.md` and enforced in code with no doc tying them
   together.
4. **`MONEY_AND_LEDGER.md`** — the single biggest documentation hole. What the platform holds, what it
   owes, when escrow releases, how a partial refund is booked, how a payout is derived. `PHASE_06` §3
   covers commission arithmetic but nothing covers the **lifecycle** of a unit of money.
5. **`ERRORS.md`** — the status-code contract. Which conditions produce 400 vs 403 vs 409, and the
   `{ success, message, data, meta }` envelope.
6. **`OPS.md`** — deploy runbook, log locations (`logs/error.log`, `logs/combined.log`), health-check
   semantics, what to do when a webhook fails or a payout is stuck.

---

## Definition of Done

- [x] `docs/` and `AGENTS.md` are tracked in git; `docs.rar` deleted; `.env` still ignored.
- [x] `03_SKELETON_STATUS.md` contains no ✅ for any module that is a `.gitkeep` or any package not in `package.json`, and carries a "last verified against commit `<sha>`" line.
- [x] Every "Active" row in `01_PROJECT_STRUCTURE.md` §2 corresponds to an installed dependency and a wired-up code path — spot-check each against `package.json`.
- [x] The cross-module access rule in `01_PROJECT_STRUCTURE.md` §3 either matches the code or the code matches it. Decision recorded.
- [x] `04_ROUTES.md` has a Status column and every ✅ row resolves to a real route in `src/routes/index.js` or a module router.
- [x] The five inaccurate comments in Step 4 are corrected or removed.
- [x] `README.md`, `DATA_MODEL.md`, `AUTH_AND_PERMISSIONS.md`, `MONEY_AND_LEDGER.md`, `ERRORS.md`, and `OPS.md` exist and are accurate.
- [x] A go-live checklist exists covering: remove `MAIL_TO_ADDRESS`, set `PAYMENT_PROVIDER=paymob`, rotate every secret off its dev default, verify `trust proxy`, run `seed:admin`.
- [x] A new developer can clone the repo, follow `README.md`, and reach a running server with a seeded admin without asking a question.
