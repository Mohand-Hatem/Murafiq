# Murafiq — Agent Behavior Contract

> Always-loaded context. Does not replace `docs/01_PROJECT_STRUCTURE.md`,
> `docs/02_PROJECT_RULES.md`, `docs/03_SKELETON_STATUS.md`, or the `PHASE_XX_*.md`
> files — it summarizes the invariants most likely to be silently violated across
> the whole project, so they survive even when those docs aren't re-opened mid-task.

## Required reading before touching any phase
- `docs/02_PROJECT_RULES.md` — the process contract (approval-gated, step-by-step,
  Definition of Done verification). This governs *how* you work, full stop.
- `docs/03_SKELETON_STATUS.md` — what's real vs. stub *today*. Never assume a module
  is fully wired without checking this first.
- `docs/00_PHASES_INDEX.md` — phase order and dependencies. Never start a phase whose
  dependency isn't done per its own Definition of Done.
- The specific `PHASE_XX_*.md` for whatever you're building — it's the source of
  truth for that module; this file only captures cross-cutting invariants.

## Core behavior rules (always apply)
1. **No code without approval, one step at a time** — present What / Why (with a
   named alternative) / How, then stop and ask. Never bundle unrelated changes into
   one step.
2. **Simplicity first, reuse before invention** — check `src/common/` (QueryBuilder,
   ApiError, ApiResponse, asyncHandler, event bus, constants, shared validators)
   before adding a new utility or pattern.
3. **Surgical, scope-disciplined changes** — touch only the current approved step.
   Never touch a file belonging to a later, not-yet-reached phase, even if convenient.
4. **Verify before claiming done** — walk the phase's Definition of Done item by item,
   state how each was verified (test run, curl/Postman, `getIndexes()`, etc.). Never
   assert completion from memory of having written the code.
5. **ESM only, existing global helpers, no mixed styles** — `import`/`export` always.
   `ApiResponse`, `ApiError`, `asyncHandler` are bare globals (via `globalThis`), not
   per-file imports — match existing files, don't reintroduce imports for these three.

## Architecture rules (apply to every module)
- Layered: `Route → Validator → Controller → Service → Repository → Model`. Swagger
  annotations live in `<module>.swagger.js`, never inline in `<module>.routes.js`.
- **No cross-module Mongoose model imports.** A module calls another module's
  *service*, never its model directly. The one exception: `auth.repository.js` may
  import `user.model.js` (documented exception — Auth/Users share `User`). Chat
  follows the same isolation rule for Firestore: only `chat.service.js` touches
  `firebase-admin`; other modules that need chat data call `chatService`.
- **Provider pattern** for anything with a real/expensive/external version: Payments
  (`mock` / `paymob`), Mail (`resend` / `sendgrid`). Code depends on the interface,
  never a specific vendor, so swapping providers is an env var change, not a rewrite.
- **Domain events, not direct calls, for side effects.** The core write (e.g. booking
  creation) happens as one direct service call inside one transaction — events are for
  what happens *after* (notifications, audit log), not for the write itself.
- **Transactions** for any operation touching more than one collection atomically
  (offer acceptance → booking creation is the canonical example — one Mongoose
  session, all-or-nothing).
- **Every list endpoint** goes through `QueryBuilder`. **Every response** goes through
  `ApiResponse.success()` / `next(new ApiError(...))`, caught centrally by the error
  handler. **Every route** is versioned under `/api/v1/...` and has a matching
  `@swagger` block — this is a Definition-of-Done item in every phase, not optional
  polish.

## Skeleton-awareness
Check `docs/03_SKELETON_STATUS.md` before assuming — it's the live source of truth.
Treat the notes below as reminders of what tends to be mixed-state, not a snapshot:
- Payments: provider is env-switched (`PAYMENT_PROVIDER=mock|paymob`) — never assume
  which is active without checking.
- Chat/Notifications run on **Firebase** (Firestore for chat, FCM for push), *not*
  Socket.io/MongoDB. Socket.io (from Phase 0) is used only for the separate Mongo-
  backed Notification system's realtime delivery — don't conflate the two.
- AI module (`src/modules/ai/`): `getOutfitSuggestions` is the one real tool, built
  directly on Phase 14's wardrobe vector index. Every other tool
  (`searchStylists`, `checkAvailability`, `createRequest`, etc.) is a placeholder that
  throws. `POST /api/v1/ai/chat` returns `501` until the LangGraph agent is actually
  built — do not wire it "partially real."
- Wardrobe classification (Phase 14) is a deliberate exception to "AI stays
  skeleton" — vision/embedding calls are real and queued via BullMQ, separate from
  the AI module's shared RAG (which stays unbuilt).
- `sendgrid.provider.js` is a stub (throws 501) — don't route mail through it.
- Out of scope, not stubs, genuinely absent: Wallet, Coupons, Favorites, Loyalty,
  Referral, Video calls, Subscription plans. Don't half-build these "just in case."

## Cross-cutting conventions (violating these breaks other modules silently)
- **Time storage:** Booking/ScheduleBlock times are **integer minutes-since-midnight**
  (`timeToMinutes()`/`minutesToTime()` from `common/utils/timeUtils.js`), never a raw
  string — string comparison silently breaks overlap detection.
- **Money:** decimal EGP, 2 decimal places, `round2()` helper. Piastres conversion
  happens **only** inside `paymob.provider.js` at the external boundary — never in
  models/services/DTOs. See "Payments" below for the full invariant set.
- **Location:** GeoJSON `[lng, lat]` order (reverse of how Google Maps returns it) —
  a recurring off-by-order bug source. `2dsphere` index required on any location field
  used in geo queries.
- **Business-day caps** (daily request/offer limits) are computed in
  `BUSINESS_TIMEZONE` ('Africa/Cairo'), not server-local time or UTC.
- **Soft delete is the only delete for `User`** (`isDeleted`/`accountStatus`/
  `deletedAt`, excluded via global query middleware) — email/phone stay permanently
  reserved, never freed for re-registration. `WardrobeItem` is the opposite: hard
  delete, and must also delete the vector DB entry via `embeddingId` — an orphaned
  vector is a silent leak with no error to surface it.
- **Public mappers strip sensitive fields explicitly** (e.g. `stylist.dto.js`) — use
  an explicit `.select()` projection on any populate, never rely on `select: false`
  alone to prevent a leak.
- **Named constants, not magic numbers**, for anything with a business rule attached
  (`CANCELLATION_FULL_REFUND_HOURS`, `CANCELLATION_PARTIAL_REFUND_PERCENTAGE`,
  `REQUEST_EXPIRY_HOURS`, daily caps) — always in `common/constants/`, never
  hardcoded inline in a service.

## Module-specific invariants

### Auth & Users (Phases 1–2)
- Single role per account, fixed at registration (`client`/`stylist`/`admin`/
  `operator`) — no dual-role, no self-registration as `admin`/`operator`.
- Dual-mode token delivery by `X-Client-Type` header: `web` → httpOnly cookies, no
  tokens in body; `mobile` → tokens in JSON body, no cookies. One `authMiddleware`
  checks cookie first, falls back to `Authorization: Bearer`.
- Refresh tokens stored **hashed**, rotated on every refresh, invalidated on password
  reset.
- Login error messages: generic `"Invalid credentials"` for wrong password/unknown
  email (no user enumeration); specific messages OK for unverified/suspended.
- Google Sign-In: verify ID token server-side, auto-link to existing local account by
  verified email, re-check `accountStatus !== 'suspended'` — Google auth must not
  bypass a suspension.
- `verification.status` (`unverified → pending → verified/rejected`) gates the core
  marketplace loop: unverified clients can't create requests, unverified stylists
  can't send offers. Required doc sets differ by role (client: 3 docs, stylist: 4,
  +police clearance) — enforced in the service layer, not the schema.
- `operator` role is scoped to exactly 3 verification routes — nothing else. Any other
  `/admin/*` route must reject an operator token with `403`.

### Stylists & Search (Phase 3)
- `StylistProfile.location`/`country`/etc. are a **denormalized read-optimization**
  copy of `User`'s fields — never edited directly, kept in sync via the
  `UserLocationUpdated` event listener. `locationSet: false` (never-set address) must
  be excluded from geo "nearby" results, or new stylists spuriously surface at
  Null Island.
- `hourlyPrice` minimum is 100 EGP, enforced at both schema and Zod level.
- Public stylist responses go through `toPublicStylist()` only — no direct model
  serialization.

### Requests & Offers (Phase 4)
- Daily caps enforced at domain level, not HTTP rate-limiting: 2 requests/day per
  client, 5 offers/day per stylist, both counted regardless of eventual status
  (cancelled/expired still count).
- **One active (`pending`) offer per stylist–client pair at a time**, across all of
  that client's requests — not just "one offer per request." Check via the
  `{stylistId, clientId, status}` index before creating a new offer.
- Offer acceptance and booking creation are **one transaction, one service call** —
  never split into accept-then-listen-for-event for the core write.
- Expiry is checked two ways: lazily on read, and proactively swept (Phase 12). Always
  re-check `expiresAt` at accept-time even if already lazily marked, to close races.

### Bookings & Scheduling (Phase 5)
- Double-booking guard: overlap check (`existingStart < newEnd AND existingEnd >
  newStart`) runs inside the same transaction as booking creation, before creating
  the ScheduleBlock — must fail closed (`409`) on any race, never silently overlap.
- Session completion requires **both** `clientConfirmedAt` AND `stylistConfirmedAt` —
  single-party confirmation never transitions to `completed`.
- No-show has no automatic detection — always filed via `POST /bookings/:id/dispute`
  (`type: 'no_show'`), confirmed by admin before any refund outcome applies. A booking
  already `disputed` can't be disputed again (idempotent, `409` on duplicate).

### Payments & Escrow (Phase 6)
- **Decimal EGP with `round2()`, not integer piastres** — piastres conversion happens
  only inside `paymob.provider.js` at the API boundary.
- Platform fee + stylist payout === amount, exactly, always (test with decimal
  values, not just round numbers).
- Cancellation is **four branches**: client ≥24h (100% refund), client <24h (75%
  refund, thresholds are named constants), client no-show via dispute+admin (0%
  refund but stylist still paid), stylist any-time (100% refund). Never merge or
  simplify these.
- Escrow holds once `Payment.status === 'paid'` (not at offer-acceptance). Session
  check-in and chat unlock both gate on this same flag.
- Mutual confirmation → `SessionCompleted` marks the payout **eligible**, it does not
  auto-transfer. Actual payout is a manual admin action (`Payout` model), and a
  booking with an open dispute or open safety report must never appear as payable.

### Chat & Notifications (Phase 7)
- Chat is **Firestore**, not Mongo — `conversationId === bookingId`, created closed
  (`isOpen: false`) at booking time, opened by the `PaymentSucceeded` listener, locked
  (`isLocked: true`, read-only) by `SessionCompleted`/`BookingCancelled`. Realtime
  delivery is client-side via Firestore Security Rules, not a server socket.
- Admin gets read-only access to any conversation via a `role` custom claim on the
  Firebase token — required for dispute review, not a bypass to abuse.
- The `Notification.type` enum is defined once in this phase and extended, never
  redefined, by later phases.

### Reviews (Phase 8)
- **Two-way**: `client_to_stylist` and `stylist_to_client` are independent, each
  enforced unique per `{bookingId, direction}` at the index level (not just service
  logic) — one direction's duplicate attempt (`409`) never blocks the other direction.
- Direction is inferred from the caller's role relative to the booking, never accepted
  as a raw client-supplied field.
- Rating aggregates are recalculated from source on every `ReviewCreated` (and on
  admin hide/unhide) — not incrementally averaged, to avoid float drift.

### Uploads & Mail (Phase 9)
- Images are compressed (Sharp) in-memory before streaming to Cloudinary — never
  written to disk. Mail goes through the provider interface
  (`mailService.send({to, subject, html})`) — this exact signature must survive
  Phase 1's temporary shim being replaced, and survive the Phase 12 queue rewire, with
  zero changes to callers.

### Audit & Admin (Phase 10)
- Audit logging is **event-bus-driven only** — one central listener mapping events to
  log entries. Never scatter direct `auditLogService.log()` calls through business
  logic; if a new money/admin-affecting event is added, add it to `AUDIT_EVENT_MAP`,
  don't bypass it.
- Dispute resolution must always land in exactly one of two outcomes —
  `'completed'` (emits `SessionCompleted`, becomes payout-eligible) or `'cancelled'`
  (triggers refund + `BookingCancelled`) — never a third silent state.

### Background Jobs (Phase 12)
- Repeating jobs (offer-expiry sweep, OTP cleanup, session reminders) must be
  registered idempotently at boot — a restart must never create duplicate repeating
  jobs. External-service queues (mail) need retry/backoff configured, not fire-and-
  forget.

### Wardrobe & AI (Phases 14–15)
- Classification runs **async via BullMQ**, never inline in the upload request —
  blocking on a vision API call would make uploads feel broken on a slow network.
- Per-user wardrobe vectors are metadata-filtered by `userId` — a cross-user leak in
  vector search is a silent, hard-to-notice privacy bug; verify the filter is applied,
  not just present in the schema.
- AI tool handlers call existing `*.service.js` functions from other modules, never a
  model or the vector DB SDK directly — same cross-module isolation rule as everywhere
  else, including for AI tools.

### Security & Deployment (Phases 13, 16)
- Every mutating route needs both `authMiddleware` and the correct `restrictTo(...)`.
- Zod validators use `.strict()` to reject unknown fields (mass-assignment guard).
- Secrets only in env vars / platform variables UI — never committed, never logged
  (grep for raw `console.log(user)`-style logging of auth documents before merging).
- MongoDB must be a replica set in every environment (required for Phase 5
  transactions) — this is non-negotiable at deploy time, not an optimization.

## Skill usage — when to invoke which installed skill
This project has these skills available (superpowers + custom-installed). Use them
proactively per situation, not just when explicitly asked:

| Situation | Skill to use |
|---|---|
| Starting any new phase or non-trivial feature | `brainstorming` — surface ambiguity/edge cases before writing a single line, especially for anything touching money, scheduling, or trust/safety. |
| Any new code in payments, escrow, cancellation, scheduling, or reviews | `test-driven-development` — write the failing test first, no exceptions in these modules. |
| Any pre-existing code in these modules with weak/missing coverage | The installed test-generator skill — generate the test-case list first, get it approved, then generate the tests. Do not skip straight to test code. |
| Any test failure, especially in booking/payment/scheduling | `systematic-debugging` — reproduce → isolate → identify → verify, never a guess-and-patch fix. |
| Designing or changing a Mongoose schema (esp. Payment, Booking, Payout, WardrobeItem) | The installed database-schema-review skill — check relationships, indexes, and constraints before implementation, not after. |
| Adding or changing a REST endpoint, especially offer-accept, payment-callback, escrow-release, or check-in routes | The installed api-design-review skill — validate resource modeling, versioning, and error handling before implementation. |
| Any claim that a step/phase is "done" | `verification-before-completion` — mandatory, no exceptions, in every module listed in the Verification Requirement below. |
| Before merging/finishing a step | `requesting-code-review` (self-check against `02_PROJECT_RULES.md` and this file) before presenting the step for approval. |
| Before starting Phases 12, 13, 14, 15, or 16 | Check `docs/RECOMMENDED_SKILLS_ROADMAP.md` and **prompt the user to install the recommended skill** before writing code for that phase. |
| Independent, parallelizable work (e.g. researching Paymob API details while writing a validator) | `dispatching-parallel-agents` / `subagent-driven-development`. |

This table exists because skill descriptions alone leave activation to the model's
judgment — for money-and-trust-critical modules in this project, that judgment call
should already be made, not left probabilistic.

## Pre-Phase Skill Installation Reminder Rule
Before beginning implementation on:
- **Phase 12:** Check for `data-pipeline-builder` / `bullmq-redis-patterns`
- **Phase 13:** Check for `security-reviewer` / `security-pentest-planner`
- **Phase 14 & 15:** Check for `rag-engineer` / `langchain-architect`
- **Phase 16:** Check for `devops-engineer` / `docker-debugger`
If the skill is missing from `~/.gemini/config/skills/`, remind and prompt the user to install it before beginning step 1 of that phase.

## Verification requirement (ties to `verification-before-completion`)
For any work touching auth, verification, payments/escrow, cancellation, scheduling,
chat access, reviews, payouts, or admin/dispute actions: run the full test suite and
show passing output before reporting a step or phase as done. Code inspection alone is
not sufficient evidence for these modules.
