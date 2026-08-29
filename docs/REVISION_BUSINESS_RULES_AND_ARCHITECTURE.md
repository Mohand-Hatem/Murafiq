# Murafiq — Business Rules & Architecture Revision

## Why this is a *revision*, not "Phase 17"

It is not a phase, and it does not come after Phase 16.

The `PHASE_XX_*` files are a **build sequence** — each one adds a module that did not exist, in
dependency order. This document is a **cross-cutting revision** of business rules across modules that
are *already built*, in the same spirit as the existing `HARDENING_*` docs. Numbering it 17 would
falsely imply it waits for Phases 14, 15, and 16. It does not.

**How it relates to the unfinished phases:**

| Phase | State | Relationship to this revision |
|---|---|---|
| 1–13 | ✅ Built | **Directly revised.** Requests, offers, bookings, payments, chat, admin, payouts all change. This is the bulk of the work. |
| 14 — Wardrobe | ⛔ Not built | **Not blocked, not blocking.** This revision *defines* the per-plan photo cap (`wardrobe.photos.max`) as an entitlement; Phase 14 will *enforce* it when it is built. Nothing here waits on it. |
| 15 — AI | ⛔ Not built | Same pattern: `ai.messages.daily` is defined here, enforced when Phase 15 lands. |
| 16 — Deployment | ⚠️ Decision recorded | Orthogonal. Unaffected either way. |

So this revision can start **now**, in parallel with or ahead of 14/15/16. The only thing it hands
forward is two entitlement keys that sit unused until their phases exist — which is deliberate, not a
gap. See §B.7.

**Internal stages are labelled `R0`–`R12`** (see §P), not phase numbers, for exactly this reason.

---


> **Status: PLANNING ONLY — nothing in this document is built.**
> No code, schema, index, or endpoint was created or modified in producing it. Every claim about
> the *current* system in §B was verified by direct code inspection against the working tree on
> branch `Phase-modify` (commit `b5cb194`) on 2026-08-27, with file:line citations.
>
> Implementation is blocked on the §R Open Questions. Do not begin Stage R0 until items
> 1–5, 15, 17, and 23 are answered by the product owner.

## Decisions Log — 2026-08-27

The product owner answered the blocking questions and delegated the remainder. Values below are
**final** unless explicitly reopened. `[PO]` = decided by the product owner. `[DELEGATED]` = the PO
asked for the recommended value and it was applied.

| Item | Decision | Source |
|---|---|---|
| Enterprise client requests/day | **5** | `[PO]` — chosen over the recommended 8 |
| Stylist Pro yearly | **$30** (= 12 × $2.50, no annual discount) | `[PO]` |
| Stylist Enterprise yearly | **$60** (= 12 × $5, no annual discount) | `[PO]` |
| Stylist Basic | **$1/mo, $12/yr, 6 offers/day** | `[PO]` monthly; yearly `[DELEGATED]` — the original `$6` was a typo, corrected to match the 12× rule set by Pro and Enterprise |
| Max active offers | **Equal to each tier's daily quota** — Free 3, Basic 6, Pro 10, Enterprise 20 | `[PO]` |
| Client no-show split | **Client refunded 60% · Stylist paid 20% · Platform 20%** | `[PO]` — final, after two rounds |
| Coupon | **10% discount, capped at 150 EGP, 14-day expiry, single-use, no minimum booking value, not stackable** | expiry + cap `[DELEGATED]`; 10% `[PO]` |
| Moderation classifier | **OpenAI moderation endpoint — CONDITIONALLY APPROVED.** Approved *only if it is genuinely free.* Ships behind `MODERATION_PROVIDER`, default `none`. **Must not be enabled until current pricing is verified** — see the gate in §I.2. | `[PO]` — conditional |
| CRITICAL lexicon | Engineering drafts ~30 candidate terms from public sources (LDNOOBW `ar`/`en`); **no term is active until approved.** No term moves money until approved. | `[DELEGATED]` |
| Moderation review access | **`operator` role reviews moderation events; `admin` only for approving CRITICAL terms and any money-moving action.** Maps the PO's "admin or moderators" onto the roles that already exist — no new role. | `[PO]` |
| User-reported abuse | **Required, not optional.** A "Report message" action routes to the review queue. Stays necessary even with a classifier — it catches what automation misses. | `[DELEGATED]` — compensating control |
| All other §R items | Defaulted to the recommendation stated in §R | `[DELEGATED]` |

### Deferred out of v1 — decided 2026-08-28, not open questions

Both items below were previously tracked as blockers. Verification against the code showed neither
blocks anything, and both are now **deliberately deferred**. Do not reopen them as questions.

**1. Automatic CRITICAL-term enforcement — NOT IN v1.**
Verified absent: there is no `BlockedTerm` model, no CRITICAL word list, and no path from a word
match to a refund (`grep` for `processRefund` / `cancelBooking` / `isFrozen` across
`src/modules/moderation/` returns nothing). `CRITICAL` exists in the code only as a **severity label
on a strike count** (`moderation.service.js:69` — third strike), never as a match tier; `scanText`
hardcodes `severity: 'MEDIUM'` on every hit.

So the thing that required a named human approver — a term that moves money with no admin in the
loop — **does not exist, and nothing is waiting on approval.**

*Rationale for deferring rather than building it:* automatic money movement from a word match is the
riskiest element of the whole moderation design. A malicious client can bait the counterparty into a
flagged word and self-serve a refund. The shipped 3-strike ladder (WARN → RESTRICT → SUSPEND, each
now revoking sessions) plus the user-report queue covers the abuse that actually occurs, without that
exposure.

*Preconditions if it is ever revived:* a `BlockedTerm` model carrying `approvedBy`/`approvedAt` with
the scanner ignoring unapproved rows; an admin approval screen; **`admin` role only** for CRITICAL
terms (never `operator`, since this is the tier that moves money); and real false-positive data from
the §O.9 observe-only window. Seed candidates from LDNOOBW (`en`/`ar`) and published Arabic
offensive-language sets — never hand-written from scratch.

**2. The `firestore.rules` cutover is a deployment note, not a task.**
Verified: this repo has **no `firebase.json`, no `.firebaserc`, and no CI step that deploys rules**.
`firestore.rules` is source only; it has never been deployed and cannot be deployed from here.
Editing it changed a file, not the Firebase project.

Murafiq is pre-release with no mobile client in existence, so the §O.8 four-step adoption sequence —
which exists for platforms with users already on the direct-write path — **does not apply.** There is
no legacy traffic to migrate.

*The only thing to carry forward:* when the mobile client is built it must send messages via
`POST /api/v1/chat/:conversationId/messages`, **not** by writing to Firestore. Firestore remains the
realtime **read** path (`onSnapshot`), unchanged. Building it the Firestore-write way first would
manufacture the exact migration problem this project currently does not have.

**3. External moderation classifier — `MODERATION_PROVIDER` stays `none` [PO, 2026-08-28].**
The 4-point gate is analysed in full in **`docs/REVISION_MODERATION_CLASSIFIER_GATE.md`**. Summary of
the findings: cost is almost certainly a non-issue and was never the real question; rate limits
cannot be sized until chat volume is measured; **Egyptian PDPL cross-border transfer is the actual
gate and needs legal sign-off**; and the content that would be transmitted is unusually sensitive
(meeting addresses, phone numbers, appearance discussion between two people about to meet in person).

The decisive structural finding: a cheap "only escalate what already matched locally" design cannot
see threats or harassment, because no local rule fires on them — so the only configuration that
closes the coverage gap is also the one that transmits every private message. **Recommendation:
remain on the deterministic pipeline for v1 and revisit once the observe-only window has produced a
real false-positive rate.** The PO retains the decision.

**Nothing in this document is now blocked on a human decision** — the classifier is a deliberate
future decision, not an outstanding one.

---

**Related docs:** `docs/03_SKELETON_STATUS.md` (what is actually built today) · `AGENTS.md` (invariants — §J and §G.1 below propose two explicit amendments to it) · `docs/MONEY_AND_LEDGER.md` (contains a policy the code has never implemented — see §B.5).

---

## Context

Murafiq is a live, working modular monolith (Phases 0–13 built, per `docs/03_SKELETON_STATUS.md`). The product owner has issued a new set of business requirements covering chat trust & safety, dual subscription systems, request/offer lifecycle changes, a redesigned cancellation/refund/penalty model, no-show handling, a stylist reliability system, and coupons.

The requirements document was written against assumptions that do not match the codebase — most importantly it assumes **Prisma/SQL** and **Socket.IO**. Neither exists here. Several requirements also directly contradict invariants that are currently enforced at the **database index level**, and one requirement is silently defeated by an existing query filter. This document establishes what is actually built, where the new rules collide with it, and the safest ordered path to implement them.

**Three architecture forks were confirmed with the product owner before writing:**

| Fork | Decision |
|---|---|
| Subscription billing currency | **EGP via the existing Paymob provider.** USD figures in the requirements are display/marketing labels only. |
| Chat moderation enforcement point | **Backend proxy.** All messages route through the Node API; direct Firestore message writes are disabled. |
| "Kick the user off sockets" | **Revoke Firebase custom-token sessions + JWT.** No Socket.IO is introduced. |

---

# A. Executive Summary

The proposed system adds six new capabilities to the existing monolith and reshapes three existing ones.

**New modules** (none of these exist today — verified by grep across `src/`):

1. **`subscriptions`** — Plan / Subscription / Entitlement / UsageCounter. One `entitlementService.check()` call site pattern; no `user.plan === 'PRO'` checks anywhere.
2. **`ledger`** — append-only, immutable, idempotency-keyed financial journal. Becomes the audit source of truth behind Payment/Payout, which stay as they are.
3. **`moderation`** — message scanning pipeline (normalize → pattern → domain → classify), ModerationEvent + PolicyViolation records, and enforcement (session revocation, restriction, booking termination).
4. **`coupons`** — issuance, validation, redemption. Seeded by no-show compensation, extensible to marketing.
5. **`reliability`** — stylist trust score derived from an event stream, separate from `rating`.
6. **`penalties`** — stylist debt balance, netted against future payout batches.

**Reshaped existing behaviour:**

- **Request lifecycle** — `expired` (terminal) becomes `PAUSED` (reactivatable); `offered` is deleted as a status; requests become immutable after the first offer.
- **Offer lifecycle** — the `{requestId, stylistId}` unique index and the cross-request "one active offer per stylist–client pair" rule are both removed; the 24h auto-expiry is removed; offers close when the parent request reaches a terminal state.
- **Cancellation & refunds** — percentages change (97/3 and 80/20 for client; stylist penalty ledger instead of client-side cost), no-show becomes a first-class booking outcome rather than a dispute type.

**Architecture stays a modular monolith.** No microservices, no new datastore, no Redis for v1 (Redis/BullMQ remains deferred to Phase 14 per `HARDENING_07`). Background work continues on in-process `node-cron` with the existing single-instance PM2 pin.

---

# B. Current Architecture Assessment

## B.1 Stack — what the requirements assume vs. what exists

| Requirements assume | Reality |
|---|---|
| Prisma / relational DB, migrations | **Mongoose 9 + MongoDB replica set.** No Prisma. No migration files — schema evolves via model edits + one-off scripts (precedent: `scripts/backfill-broadcast-visibility.js`). |
| Socket.IO connections to disconnect | **No Socket.IO dependency at all.** Not in `package.json`, not in `src/server.js`. Realtime = Firestore listeners (chat) + FCM (push). |
| Backend receives every chat message | **Chat messages are written client→Firestore directly.** `firestore.rules:42` grants participants `create` on `conversations/{id}/messages`. `POST /chat/:conversationId/messages` exists but is a *fallback path*, not the enforced one. |
| Unique constraints to "remove" | Correct — but they are **Mongoose indexes**, and dropping them requires an explicit `dropIndex`/`syncIndexes()` step, not a migration file. |

## B.2 Layering (keep as-is)

`Route → Validator (Zod, `.strict()`) → Controller → Service → Repository → Model`, per `AGENTS.md`. Swagger lives in `<module>.swagger.js`. `ApiResponse` / `ApiError` / `asyncHandler` are `globalThis` bare globals set by `src/common/globals.js` — **do not add imports for these three** in new files. Cross-module access is service-to-service only; no cross-module model imports. Side effects go through `src/common/events/event-bus.js`; the core write stays inside one Mongoose session.

This layering is sound and every new module below follows it unchanged.

## B.3 Requests — how it works today

`src/modules/requests/request.model.js`
- `status: ['pending','offered','accepted','rejected','expired','cancelled']`
- `visibility: 'direct' | 'broadcast'`; `stylistId` required only for `direct`
- `expiresAt` set at creation to **now + 48h** (`request.service.js:74`)

`src/modules/requests/request.service.js`
- `createRequest` gates on `verification.status === 'verified'`, then counts **all** requests created in the current Cairo business day (`countDailyClientRequests`, `request.repository.js:64`) against `DEFAULT_CAPS.CLIENT_DAILY_REQUESTS_VERIFIED = 5` / `_UNVERIFIED = 2`.
- Expiry is **lazy only** — `expireOldRequests()` runs on `getMine`/`getIncoming` reads (`request.service.js:91,100`) and flips `pending → expired`. **`expired` is terminal.** There is no reactivation path and no cron sweep for requests.
- `cancelRequest` only works from `pending`. `declineRequest` (stylist, direct only) sets `rejected`.
- **There is no edit endpoint at all.** `request.routes.js` exposes create / mine / cancel / feed / incoming / decline — no `PATCH /requests/:id`.

**Three defects relative to the new intent:**

1. **The broadcast feed silently kills multi-offer bidding.** `request-feed.service.js:12-16` matches `status: 'pending'` only. `offer.service.js:93` flips the request to `'offered'` the moment the *first* offer lands. The request therefore disappears from every other stylist's feed after one bid. The system advertises competitive bidding but structurally delivers first-come-first-served.
2. **Quota counts cancelled and expired requests.** `countDailyClientRequests` filters on `createdAt` only. Under the new **Free = 1 request/day** rule, a client who cancels a typo'd request is locked out for 24 hours. This is a support-ticket generator at 5/day; at 1/day it is a churn event.
3. **`offered` is a status masquerading as a derived fact.** It encodes "has ≥1 offer", which is a count, and it forces `rejectOffer` to write the request back to `'pending'` (`offer.service.js:203`) — wrong once a request can hold four simultaneous offers.

## B.4 Offers — how it works today

`src/modules/offers/offer.model.js`
- `status: ['pending','accepted','rejected','expired']`
- **`offerSchema.index({ requestId: 1, stylistId: 1 }, { unique: true })`** — hard DB block on a second offer to the same request.
- `expiresAt` = now + 24h (`offer.service.js:71`), swept every 5 minutes by `src/jobs/offer-expiry.cron.js`.

`offer.service.js`
- `findActiveForClient` (`offer.repository.js:42`) enforces the cross-request rule documented in `AGENTS.md`: *"One active (`pending`) offer per stylist–client pair at a time, across all of that client's requests."* → `409` at `offer.service.js:66`.
- Daily cap applies **only to broadcast** offers (`offer.service.js:42`, and `countDailyStylistOffers` filters `requestVisibility: 'broadcast'`). Direct offers are uncapped.
- `acceptOffer` is genuinely well-built: CAS lock on the parent request (`requestRepository.lockAndAccept`), unique indexes on `Booking.offerId`/`Booking.requestId`/`ScheduleBlock` as defence-in-depth, and a bounded retry envelope that distinguishes real `ApiError`s from MongoDB `WriteConflict`/`TransientTransactionError`. **Keep this pattern; extend it, do not rewrite it.**

**Requirement §7 collides with three separate enforcement layers**: the unique index, `findActiveForClient`, and the `AGENTS.md` invariant. All three must be removed together, or the rule half-applies.

## B.5 Bookings, payments, payouts

- `booking.model.js` status: `['confirmed','in-progress','completed','cancelled','disputed']`. `cancelledBy: 'client'|'stylist'|'admin'` is a separate field. `completedAt` is set exactly once and correctly anchors both the dispute window and the payout hold. **No no-show status exists.**
- `statuses.constant.js` `BOOKING_STATUS` still contains `PENDING`, which the model enum does not allow — **dead drift**.
- **Cancellation policy today** (`statuses.constant.js:25`): `FULL_REFUND_HOURS: 24`, `PARTIAL_REFUND_PERCENTAGE: 75`. `booking.service.js:500-511`: client cancelling `< 24h` → 75% refund; `≥ 24h` → 100%; stylist or admin → always 100%. **The boundary is already correct** — exactly 24h00m falls into the client-favourable tier. Only the percentages change.
- **`docs/MONEY_AND_LEDGER.md` documents a completely different policy** (100% / 50% at 12–24h / 0% under 12h) that the code has never implemented. Documentation drift that must be corrected in the same phase.
- **Refunds are a status flip on the Payment document**, not a ledger write. `paymentService.processRefund` sets `status`, `refundAmount`, `platformFeeAmount`, `stylistPayoutAmount: 0`. There is **no idempotency key** and no record of *why* a given amount was chosen beyond a free-text `refundReason`.
- **Latent bug:** `payment.service.js:238` writes `refundedAt: new Date()`, but `refundedAt` is **not a field on `paymentSchema`**. Mongoose strict mode drops it silently — every refund timestamp in production has been lost. (Verify with a `db.payments.findOne({status:'refunded'})` before the fix.)
- `processRefund` correctly refuses to refund a booking whose `payoutStatus !== 'unpaid'` (`payment.service.js:215`) — good instinct, and the ledger below makes this recoverable rather than a manual dead end.
- **Payouts** are admin-driven batches with a 48h post-completion hold. No concept of deductions.

## B.6 Chat, auth, and moderation surface

- **Chat is Firestore.** `conversationId === bookingId`. Created closed at booking time; opened by the `PaymentSucceeded` listener; locked on completion/cancellation. `chat.service.js` is the only file allowed to touch `firebase-admin`.
- **Zero moderation exists.** No filter, no scan, no ModerationEvent, no PolicyViolation, nothing in `src/modules/safety/` (empty `.gitkeep`).
- **Auth is a single-session model.** `User.refreshTokenHash` is one hashed token — a new login silently evicts the previous device. Logout-all is therefore free, but **there is no access-token revocation**: `auth.middleware.js` only calls `jwt.verify`. A banned user keeps a working access token until it expires.
- `AuditLog` exists (`actorId`, `actorRole`, `action`, `targetType`, `targetId`, `metadata`, `ip`), written by a single event-bus listener via `AUDIT_EVENT_MAP`. **Reuse it — do not build a parallel security log.** Add a `severity` field and new event mappings instead.

## B.7 What does not exist and is assumed by the requirements

| Requirement references | Status |
|---|---|
| Wardrobe photo limits (§4) | **Phase 14 not built.** No wardrobe module, no `WardrobeItem` model. `upload.service.js:11` allows a `wardrobe` folder; nothing consumes it. |
| AI chatbot message quotas (§4) | **Phase 15 not built.** `src/modules/ai/` is an empty `.gitkeep`. |
| Subscriptions, entitlements, usage (§3–6) | Not built. `AGENTS.md:75` lists "Subscription plans" under *"genuinely absent — don't half-build these."* |
| Coupons (§16) | Not built, same list. |
| Financial ledger (§15) | Not built. |
| Reliability score (§14) | Only `StylistProfile.completedSessions` / `cancelledSessions` counters and a `logger.warn` at ≥3 cancellations (`stylist.listener.js:45`). |

**Consequence:** wardrobe and AI-message entitlements can be *defined* now but cannot be *enforced* until Phases 14/15 ship. The entitlement service must return them and the enforcement call sites must simply not exist yet — that is correct and expected, not a gap.

---

# C. Canonical Business Rules

Rules are tagged **[PO]** (explicitly requested by the product owner) or **[REC]** (recommendation).

> **Read this before interpreting the `[OPEN]` tags below.** As of the Decisions Log at the top of
> this document, the product owner has answered every blocking question and **delegated the rest to
> the stated recommendation.** A remaining `` `[OPEN]` `` tag therefore no longer means "blocked" — it
> means *"the recommended value is applied; this is a tunable constant, not a decision anyone is
> waiting on."* Every one of them is a named constant in `common/constants/`, changeable in one line
> without touching logic. Implement the recommended value and move on.
>
> **As of 2026-08-28 there are no unresolved items.** The two that remained — the CRITICAL lexicon
> approver and the `firestore.rules` cutover — were both verified against the code and deliberately
> deferred out of v1. See "Deferred out of v1" at the top of this document.

## C.1 Client plans

| Plan | Monthly | Yearly | AI msgs/day | Wardrobe photos | Requests/day |
|---|---|---|---|---|---|
| Free | $0 | $0 | 3 | 7 | 1 |
| Basic | $1 | $12 | 10 | 25 | 2 |
| Mid | $3 | $35 | 35 | 45 | 3 |
| Pro | $5 | $58 | 80 | 100 | 4 |
| Enterprise | $10 | $115 | 150 | 250 | **5** |

All **[PO]**, including the Enterprise requests/day.
- **Enterprise = 5 requests/day [PO, DECIDED].** 8 was recommended (the other tiers step +1 each, but Enterprise doubles on every other metric, so +1 makes it the weakest value step in the ladder). The PO chose 5 after seeing that rationale. Implement 5. Revisit only if Enterprise conversion underperforms.
- **[REC] Prices are stored and charged in EGP**, derived from these USD figures at an admin-editable `Plan.priceMinor` value. USD is a display label. (Confirmed with PO.)
- **[REC] Yearly is charged as a single up-front payment**, not 12 instalments — Paymob recurring billing is not currently integrated and one-shot annual avoids that entire dependency for v1.

## C.2 Stylist plans

| Plan | Monthly | Yearly | Offers/day | Max active offers |
|---|---|---|---|---|
| Free | $0 | $0 | 3 | **3** |
| Basic | $1 | **$12** | 6 | **6** |
| Pro | $2.50 | **$30** | 10 | **10** |
| Enterprise | $5 | **$60** | 20 | **20** |

- **Yearly = 12 × monthly, no annual discount [PO, DECIDED].** The original spec listed stylist Basic at `$6/yr`, which implied a 50% annual discount while every client plan implied ~0–4%. The PO set Pro at $30 (= 12 × $2.50) and Enterprise at $60 (= 12 × $5), confirming the 12× rule; **`$6` was therefore a typo and Basic yearly is $12.** Both ladders are now internally consistent.
  - *Note for the PO, not a blocker:* a yearly plan priced at exactly 12× monthly gives the buyer no reason to prepay. If annual prepayment is wanted for cash-flow reasons, a 10–15% discount is the usual lever. Ship 12× as decided; revisit if annual uptake is near zero.

- **`maxActiveOffers` = each tier's daily quota [PO, DECIDED]** — Free 3, Basic 6, Pro 10, Enterprise 20. The two remain **separate mechanisms** as §7 requires (daily quota is a counter that resets at Cairo midnight; active limit is a live `countDocuments` of `PENDING` offers); the numbers simply coincide. Because they are separate, either can be retuned later without touching the other.

- **[REC] Daily offer quota should count BOTH direct and broadcast offers.** Today only broadcast counts (`offer.repository.js:51`). Once plan tiers sell "offers/day" as the headline feature, an uncapped direct channel makes the meter meaningless — a stylist simply asks clients to send direct requests.

## C.3 Requests/day: plan quota vs. verification cap

The current cap keys off `verification.status` (verified 5 / unverified 2). The new cap keys off plan. These are different axes and both are legitimate.

- **[REC] Verification stays a hard gate, not a cap.** Unverified users already cannot create requests at all (`request.service.js:14`), so `CLIENT_DAILY_REQUESTS_UNVERIFIED` is currently dead configuration. Delete it; the effective daily limit becomes purely the plan entitlement.

## C.4 Quota accounting

- **[REC] A request consumes quota at creation and is refunded if the client cancels it within 15 minutes with zero offers received.** Fixes B.3 defect #2 without opening a create-cancel-create farming loop. `[OPEN]` on the 15-minute value.
- **[PO] Reactivating a PAUSED request does not consume a new day's quota** (§8: "this paused request should become the only request that can be reactivated/used under the Free plan limitation").
- **[REC] Reactivation instead consumes an *active-request slot*.** A Free client holds at most 1 OPEN request at any time. This is the correct reading of §8 and it is a persistent capacity limit, not a daily counter — see §E.
- **[REC] Offer quota consumes at send. Never refunded**, including when the client accepts a competitor. Refunding would make the meter unpredictable for the stylist and is trivially gameable.

## C.5 Request editing and lifecycle

- **[PO]** Editable only while zero offers exist. After the first offer, immutable.
- **[REC] "Immutable" has three exceptions:** the client may still (a) close/cancel the request, (b) accept an offer, (c) add images. Everything price-, time-, or scope-bearing is frozen, because stylists priced their bids against it.
- **[PO]** Client may close the request at any time.
- **[PO]** 48 hours open with **zero offers** → auto-PAUSE. Client may reactivate.
- **[REC] The 48h timer runs from `createdAt` and an edit does NOT reset it.** Resetting on edit gives a client an unbounded way to hold a feed slot forever by touching the description every 47 hours. Reactivation *does* start a fresh 48h window (that is what reactivation means).
- **[REC] Receiving any offer permanently cancels the auto-pause timer.** §8 asks only about zero-offer inactivity. A request with a live offer is not inactive.
- **[REC] Reactivation is capped at 3 times per request.** After the third pause, the request goes to `CLOSED` (terminal) and the client creates a new one. Prevents a single stale request cycling through the feed indefinitely. `[OPEN]` on the value 3.

## C.6 Offer lifecycle

- **[PO]** A stylist may hold multiple simultaneous offers to the same client, and multiple offers on the same request.
- **[PO]** An offer stays active until: another offer is accepted, the request is deleted, or the request is closed.
- **[REC] Add two more closing conditions:** the stylist withdraws it, or the client explicitly rejects that one offer. Both already exist in the code (`rejectOffer`) and both are obviously correct.
- **[REC] Remove the 24h auto-expiry entirely** (§9 explicitly asks for this), but **keep a 30-day long-stop** so pending offers on abandoned requests do not accumulate forever against a stylist's `maxActiveOffers`. `[OPEN]` on 30 days.
- **[REC] Add a per-request cap: 3 offers from one stylist to one request.** §7 asks for *multiple*, not *unlimited*. Without a cap, one stylist can flood a client's comparison view and crowd out competitors — the exact failure mode the broadcast feed exists to prevent.

## C.7 Cancellation policy matrix

See §H for the full matrix. Headline:

- **[PO]** Client cancels **≥ 24h** before start → platform retains 3%, client refunded 97%.
- **[PO]** Client cancels **< 24h** → platform retains 20%, client refunded 80%.
- **[PO]** Boundary: exactly 24h00m is the *client-favourable* tier. **This already matches the code** (`hoursUntilSession < FULL_REFUND_HOURS`); only the percentages change.
- **[PO]** Stylist cancels ≥ 24h → client fully refunded, stylist incurs a **3% penalty debt**.
- **[PO]** Stylist cancels < 24h → client fully refunded, stylist incurs a **20% penalty debt**, zero payout.
- **[PO]** Stylist no-show → client refunded **100%** + a **10% coupon**; stylist gets zero payout, a **10% penalty**, and a reliability hit.

## C.8 Chat safety

- **[PO]** Block, record, audit, revoke session, restrict account, terminate the affected booking, refund the client, withhold stylist payout — **for confirmed critical violations only**.
- **[REC] Three severity bands, and only the top band triggers financial consequences** (§2 explicitly warns against automatic penalties from a naive word match):

| Band | Trigger | Action |
|---|---|---|
| **BLOCK_ONLY** | Contact info (phone/email/handle), obfuscated or not. Blocked-domain link. | Message rejected with a clear reason. Violation counted. **No session kill, no financial action.** Escalates to RESTRICT at 3 in 30 days. |
| **RESTRICT** | Explicit sexual content, solicitation, adult URLs — matched against the curated sexual-content list and the blocked-domain list. | Message blocked. Session revoked. Account restricted (chat-disabled) pending review. Booking **frozen**, not cancelled. Payout held. **Refund/termination require admin confirmation.** |
| **CRITICAL** | Admin-confirmed RESTRICT, or a match on an explicitly curated CRITICAL pattern set (e.g. CSAM indicators, trafficking terms). | Full §2 chain executed automatically, including refund and payout forfeiture. Immediate admin page. |

Rationale: the requirement's own §2 says not to trigger automatic money movement from a word match. Attaching a refund to a regex is a fraud vector — a malicious client can trigger a self-service full refund by baiting a stylist into a flagged word. **Money moves only on an admin-confirmed or curated-CRITICAL match.**

- **[REC] Ambiguous matches are not blocked.** The message sends, a `ModerationEvent` with `verdict: 'SUSPECT'` is recorded, and it lands in an admin review queue. False-positive rate on obfuscated-contact regex is high enough that blocking on suspicion will damage legitimate conversations.

---

# D. Recommended Architecture

Modular monolith, unchanged. Six new modules under `src/modules/`, each following `Route → Validator → Controller → Service → Repository → Model`.

```
src/modules/
  subscriptions/       plan.model, subscription.model, usage-counter.model
                       entitlement.service   ← THE ONLY quota decision point
                       subscription.service  ← purchase/renew/cancel/upgrade/downgrade
                       usage.service         ← atomic consume/release
  ledger/              ledger-entry.model (append-only, immutable)
                       ledger.service        ← post(), balanceFor(), reconcile()
  moderation/          moderation-event.model, policy-violation.model
                       scanner/  normalize.js, contact.rule.js, adult.rule.js,
                                 domain.rule.js, classifier.provider.js
                       moderation.service    ← scan() → verdict
                       enforcement.service   ← revoke/restrict/freeze/refund chain
  coupons/             coupon.model
                       coupon.service        ← issue/validate/redeem
  reliability/         reliability-event.model
                       reliability.service   ← recompute(stylistId), tier(stylistId)
  penalties/           penalty.model
                       penalty.service       ← assess(), outstandingFor(), settle()
```

**Module responsibilities and boundaries:**

- **`entitlement.service`** is the single answer to *"is this user allowed to do X, and how much is left?"* Every quota check in the app becomes exactly one of:
  ```
  await entitlements.consume(userId, 'requests.daily')   // throws 429 if exhausted
  await entitlements.capacity(userId, 'offers.active')   // returns { limit, used }
  ```
  Nothing outside this module reads `Plan` or `Subscription`. This is the direct answer to §3's "no `if (user.plan === 'PRO')` scattered through the app."

- **`ledger.service`** is the only writer of `LedgerEntry`. Payment/Payout services *call* it; they do not stop being the operational records. The ledger is the auditable derivation of every EGP that moved.

- **`enforcement.service`** owns the §2 consequence chain and is the only caller that can revoke a session + freeze a booking + trigger a refund atomically. It is invoked by `moderation.service` and by admin actions — never inline from a controller.

- **`penalty.service`** is queried by `payout.service.createBatchPayouts` at batch time. Penalties are never applied by mutating a Payment.

**Cross-cutting:** all six emit domain events; the existing `audit-log.listener.js` `AUDIT_EVENT_MAP` gains entries for each. No new audit mechanism.

---

# E. Subscription & Entitlement Architecture

Four cleanly separated concepts, per §6.

## E.1 `Plan` — what a plan provides (config, not user state)

Seeded catalogue, versioned, never mutated in place.

```
Plan {
  code            'client.free' | 'client.basic' | ... | 'stylist.pro'
  audience        'client' | 'stylist'
  version         Number                    // bump on any entitlement change
  isActive        Boolean
  priceMonthlyMinor  Number                 // EGP piastres
  priceYearlyMinor   Number | null          // null = not offered
  displayPriceUsd    { monthly, yearly }    // marketing label only
  entitlements    { <key>: <numeric limit | boolean> }
  sortOrder       Number
}
```

**Why versioned instead of edited:** a user on `client.pro v1` keeps v1's entitlements until their period ends. Editing a Plan in place silently changes what thousands of paying users are entitled to, mid-period. `Subscription` pins `{ planCode, planVersion }`.

**Entitlement keys** (a flat, stable namespace — this is the contract everything else codes against):

| Key | Kind | Audience |
|---|---|---|
| `requests.daily` | daily quota | client |
| `requests.active` | persistent capacity | client |
| `ai.messages.daily` | daily quota | client |
| `wardrobe.photos.max` | persistent capacity | client |
| `offers.daily` | daily quota | stylist |
| `offers.active` | persistent capacity | stylist |
| `feed.priority` | boolean feature | stylist |

`wardrobe.photos.max` and `ai.messages.daily` are **defined now, enforced when Phases 14/15 ship.** No enforcement call site exists until then. This is deliberate.

## E.2 `Subscription` — what this user bought

```
Subscription {
  userId          unique per audience
  planCode, planVersion
  status          'active' | 'past_due' | 'cancelled' | 'expired'
  billingPeriod   'monthly' | 'yearly'
  currentPeriodStart, currentPeriodEnd      Date
  cancelAtPeriodEnd  Boolean
  paymentId       ref Payment               // the charge that opened this period
  providerRef     String                    // Paymob subscription/txn id
  gracePeriodEnd  Date | null
}
```

- **Every user has exactly one active Subscription row**, including free users. A free user gets an auto-provisioned `client.free` / `stylist.free` subscription at registration with `currentPeriodEnd = null` (never expires). This removes every `if (!subscription)` null-branch from the entitlement path.
- **Downgrade to Free on expiry, never deletion.**

## E.3 `UsageCounter` — daily consumption

```
UsageCounter {
  subjectId     ObjectId
  metric        'requests.daily' | 'offers.daily' | 'ai.messages.daily'
  periodKey     '2026-08-27'                // Cairo calendar date, string
  used          Number
  limitSnapshot Number                      // limit at first consume, for audit
}
unique index: { subjectId, metric, periodKey }
TTL index:    { createdAt } expireAfterSeconds: 60 * 60 * 24 * 40
```

**Reset is implicit, not a job.** `periodKey` is derived from `getBusinessDayRange()` (`src/common/utils/businessDay.util.js`), which already computes Cairo-local day boundaries correctly. A new day is a new document; the old one is reaped by the TTL index. **No "usage reset" cron is required** — §22's suggested reset job is unnecessary and I recommend against it. It would be a nightly mass-write over every active user for zero benefit.

**Timezone:** the platform business day is Africa/Cairo, fixed, for all users (`BUSINESS_TIMEZONE`). Murafiq is a single-market Egyptian product; per-user timezones would let a user harvest two daily quotas by changing a device setting. **[REC] Do not make the quota day user-timezone-relative.** `[OPEN]` if international expansion is imminent.

## E.4 Persistent capacity — NOT counters

`requests.active`, `offers.active`, `wardrobe.photos.max` are **computed live**, never stored as a counter:

```
used = await Request.countDocuments({ clientId, status: 'OPEN' })
used = await Offer.countDocuments({ stylistId, status: 'PENDING' })
```

Counters drift the moment any status transition happens outside the increment path (a cron sweep, an admin action, a failed transaction). A live `countDocuments` against an existing index is cheap and cannot drift. This is the correct answer to §6.E.

## E.5 Upgrade / downgrade

- **Upgrade:** effective immediately. Charge the prorated difference for the remainder of the period. New entitlements apply on the next `consume()` call — **already-consumed usage is not refunded**, so a client who used their 1 Free request and upgrades to Pro (4/day) gets 3 more today, not 4.
- **Downgrade:** **[REC] takes effect at `currentPeriodEnd`, never immediately.** The user paid for the higher tier through the end of the period. This also makes the over-capacity edge cases (§N) rare rather than routine.
- **Over-capacity after downgrade** (more wardrobe photos / active requests / active offers than the new plan allows): **[REC] grandfather, block additions.** Never auto-delete user data or auto-close a live offer. The user sees `12 / 7 photos — remove 5 to add more`. Deleting a paying-customer's content on a billing event is the single fastest way to generate a chargeback.

---

# F. Request / Offer / Booking State Machines

## F.1 Request

**Recommended states** (§8 asked for the cleanest set; this is it):

```
                    ┌──────────── reactivate (max 3×) ────────────┐
                    ▼                                             │
   [create] ──► OPEN ──── 48h, zero offers ────────────────► PAUSED
                 │ │                                             │
                 │ └── client closes ──► CLOSED ◄── 4th pause ───┘
                 │
                 ├── offer accepted ──► FULFILLED     (terminal)
                 ├── client cancels ──► CANCELLED     (terminal)
                 └── stylist declines (direct only) ──► DECLINED (terminal)
```

| Recommended | Replaces | Terminal? |
|---|---|---|
| `OPEN` | `pending` **and** `offered` | no |
| `PAUSED` | `expired` (which was terminal) | no |
| `CLOSED` | — (new: client-closed, or pause limit hit) | yes |
| `FULFILLED` | `accepted` | yes |
| `CANCELLED` | `cancelled` | yes |
| `DECLINED` | `rejected` | yes |

**Key changes:**
- **`offered` is deleted.** Replaced by two derived fields on the Request: `offerCount` (Number) and `firstOfferAt` (Date). This is what unblocks the broadcast feed (B.3 defect #1) — the feed matches `status: 'OPEN'`, which no longer flips away on first bid. `firstOfferAt` is also exactly the flag the edit-immutability rule needs.
- **`expired` → `PAUSED`, non-terminal.** Direct implementation of §8.
- **`CLOSED` vs `CANCELLED`:** CLOSED = the client is done with it (found someone, changed their mind) and it may hold historical offers. CANCELLED = withdrawn, treated as if it barely existed for quota purposes. Worth distinguishing for analytics; if the PO prefers one state, merge into `CLOSED`. `[OPEN]`

## F.2 Offer

```
   [create] ──► PENDING ──┬── client accepts ────────────► ACCEPTED   (terminal)
                          ├── client rejects this one ───► REJECTED   (terminal)
                          ├── stylist withdraws ─────────► WITHDRAWN  (terminal)
                          ├── sibling offer accepted ────► CLOSED     (terminal)
                          ├── request CLOSED/CANCELLED ──► CLOSED     (terminal)
                          └── 30-day long-stop ──────────► EXPIRED    (terminal)
```

- **`CLOSED` is new and distinct from `REJECTED`.** Today `rejectSiblingOffers` writes `'rejected'` to every losing offer (`offer.repository.js:83`). That conflates "this client looked at your bid and said no" with "someone else won" — materially different signals for a stylist's dashboard and for any future reliability/acceptance-rate metric. Separate them.
- `WITHDRAWN` is new (stylist-initiated retraction), and required so a stylist can free an `offers.active` slot.
- `EXPIRED` survives only as the 30-day long-stop; the 24h expiry is removed and `offer-expiry.cron.js`'s window constant changes.

## F.3 Booking

```
   [from accepted offer] ──► CONFIRMED
                                │
              ┌─────────────────┼─────────────────────────────┐
              ▼                 ▼                             ▼
        IN_PROGRESS      CANCELLED (cancelledBy: client|stylist|admin)
              │                                        NO_SHOW_STYLIST
              ├── both confirm ──► COMPLETED           NO_SHOW_CLIENT
              └── dispute filed ──► DISPUTED ──► COMPLETED | CANCELLED
```

- **Keep the existing five statuses.** They are sound and heavily tested. Do **not** split `CANCELLED` into `CANCELLED_BY_CLIENT` / `CANCELLED_BY_STYLIST` as §18 suggests — `cancelledBy` already exists as a field and splitting the enum would break every existing query, index, and test for zero gain.
- **Add exactly two statuses: `NO_SHOW_STYLIST`, `NO_SHOW_CLIENT`.** These are *not* cancellations: different refund maths, different payout treatment, different reliability weight, different coupon issuance. Encoding them as `cancelled + reason` (which is what happens today, via a dispute of `type: 'no_show'`) makes them unqueryable and unauditable.
- **Delete `BOOKING_STATUS.PENDING`** from `statuses.constant.js` — it has never been a valid model value.
- **Freezing:** a moderation RESTRICT does not need a status. Add `isFrozen: Boolean` + `frozenReason`. A frozen booking blocks check-in, completion, and payout, but its status is untouched so the admin can still resolve it to any legitimate outcome.

---

# G. Payment / Escrow / Refund Architecture

## G.1 The ledger

**Recommendation: yes, introduce a ledger.** Payment/Payout remain as the operational records (they hold provider IDs, retry state, batch membership). `LedgerEntry` becomes the immutable financial truth.

```
LedgerEntry {
  entryType      'PAYMENT' | 'ESCROW_HOLD' | 'ESCROW_RELEASE' | 'REFUND'
                 | 'CANCELLATION_FEE' | 'PLATFORM_FEE' | 'STYLIST_PAYOUT'
                 | 'STYLIST_PENALTY' | 'PENALTY_SETTLEMENT'
                 | 'COUPON_CREDIT' | 'SUBSCRIPTION_CHARGE' | 'ADJUSTMENT'
  amountMinor    Number    // EGP piastres, integer, signed
  currency       'EGP'
  account        'CLIENT' | 'STYLIST' | 'PLATFORM' | 'ESCROW' | 'PROVIDER'
  direction      'DEBIT' | 'CREDIT'
  subjectId      ObjectId  // the user this affects
  bookingId      ObjectId | null
  paymentId      ObjectId | null
  payoutId       ObjectId | null
  correlationId  String    // groups all entries of one business operation
  idempotencyKey String    // UNIQUE
  reason         String
  metadata       Mixed
  createdAt      Date
}
unique index: { idempotencyKey }
index: { bookingId, createdAt }, { subjectId, entryType, createdAt }, { correlationId }
```

**Immutability is enforced, not just intended:** a `pre('findOneAndUpdate')` / `pre('updateOne')` hook on the schema throws. Corrections are new `ADJUSTMENT` entries that reference the original via `correlationId`. Never an edit, never a delete.

**Money representation — [REC], and this differs from a current documented invariant.**
Store `amountMinor` as **integer piastres** in the ledger. `AGENTS.md:82` currently states piastres conversion happens *only* inside `paymob.provider.js`. That invariant is right for single-value arithmetic (`round2` handles it), but wrong for a ledger: the ledger's whole purpose is `sum(entries) === 0` reconciliation across thousands of rows, and repeated float addition is exactly where drift appears. Payment/Booking keep decimal EGP unchanged; conversion happens at the single `ledger.service.post()` boundary. **This requires an explicit amendment to `AGENTS.md` as part of the implementing phase — do not introduce it silently.**

## G.2 Idempotency

Every ledger post carries a deterministic key: `refund:${bookingId}:${reason}`, `penalty:${bookingId}:${type}`, `payout:${payoutId}`, `webhook:${provider}:${providerTransactionId}`. The unique index makes a duplicate post a caught `E11000`, translated to "already processed, returning existing" — not an error to the caller. This is the answer to §15's duplicate-refund and duplicate-webhook questions, and it is the *only* mechanism needed for both.

## G.3 Refund flow (redesigned)

```
1. Backend computes refund tier from booking.scheduledDate + scheduledStartMinute.
   NEVER from a client-supplied percentage. (§10 — currently already true; keep it.)
2. ledger.post(REFUND, correlationId, idempotencyKey) — inside the transaction.
3. paymentService calls provider.refund().
4. On provider success: Payment status/refundAmount updated, plus `refundedAt`
   (which must be ADDED to paymentSchema — see B.5, it is silently dropped today).
5. On provider failure: ledger entry stays, Payment.refundError set, booking enters
   a `refund_pending` retry queue. The ledger already records the intent, so the
   retry is idempotent by construction.
```

**Refund when payout already went out** (`payment.service.js:215` currently hard-blocks this): with a ledger, the correct behaviour becomes possible — post the REFUND against PLATFORM, post a `STYLIST_PENALTY` for the over-disbursed amount, and let it net against the stylist's next payout. Keep the hard block for v1; enable this in the phase that lands penalties.

## G.4 Reconciliation

A daily read-only job asserts, for every booking touched in the last 24h:
`sum(CLIENT debits) + sum(COUPON_CREDIT) === sum(PLATFORM credits) + sum(STYLIST credits) + sum(REFUND credits)`.
Any non-zero delta pages an admin. This is the entire reconciliation story and it is cheap because it is one aggregation over an indexed date range.

---

# H. Cancellation / No-Show Policy Matrix

`P` = booking price. All percentages of `P`. `H` = hours between now and scheduled start.

| Event | Client refund | Platform retains | Stylist payout | Stylist penalty debt | Coupon | Reliability |
|---|---|---|---|---|---|---|
| **Client cancels, H ≥ 24** | 97% | 3% | 0 | — | — | — |
| **Client cancels, H < 24** | 80% | 20% | 0 | — | — | client cancel-rate ↑ |
| **Stylist cancels, H ≥ 24** | 100% | 0% | 0 | **3%** | — | ↓ |
| **Stylist cancels, H < 24** | 100% | 0% | 0 | **20%** | **[REC] 10%** | ↓↓ |
| **Stylist no-show** | 100% | 0% | 0 | **10%** | **10%** | ↓↓↓ |
| **Client no-show** | **60%** | **20%** | **20%** | — | — | client no-show ↑ |
| **Admin cancels (platform fault)** | 100% | 0% | **[REC] full, platform-funded** | — | — | — |

**Notes and recommendations:**

- **Boundary:** `H >= 24` → tier A. Exactly 24h00m is client-favourable. 23h59m → tier B. **[PO]**, and already correct in code.
- **`H` is computed backend-side** from `booking.scheduledDate` + `scheduledStartMinute` in Cairo time — the existing `getBusinessDayRange(scheduledDate).startOfDay + startMinute` logic (`booking.service.js:501`) is already correct. **[PO §10: frontend must never compute this.]**
- **[REC] Late stylist cancellation should also issue the 10% coupon.** §13 gives a coupon for no-show only, but from the client's side a stylist cancelling 2 hours before the appointment is *worse* than a no-show — they have already blocked out their day. Compensating one and not the other is arbitrary.
- **Client no-show: 60% refund / stylist 20% / platform 20% [PO, FINAL].** §23 listed this as a gap with no rule. Settled over two rounds: the PO first proposed 70/10/20, a stylist-weighted 20/60/20 was argued for, and the PO landed on **60/20/20** — doubling the stylist's compensation while keeping the policy client-leaning. Implement 60/20/20.
  - **The invariant that matters is preserved:** the platform retains 20%, exactly as in the late-cancellation case. Murafiq never earns more from a no-show than from a cancellation, so there is no financial incentive to make cancelling awkward.
  - **Known trade-off, accepted:** 20% of a booking is thin compensation for a stylist who travelled and lost the slot, and the gap between late-cancelling (80% back) and ghosting (60% back) is 20 points — a real but modest deterrent. **Watch two metrics after launch:** client no-show rate, and stylist acceptance rate for clients with prior no-shows. If either moves badly, shifting toward 40/40/20 is a one-line constant change.

- **Evidence gate is mandatory before any of the above pays out.** Paying a stylist for a booking they did not deliver is only safe behind proof — see the no-show filing rules below. Without the gate this is a way for a stylist to earn by showing up and lying.
- **[REC] No-show requires evidence + a confirmation step, never a bare self-report.** A one-tap "they didn't show" that refunds 100% and penalises the counterparty is a fraud primitive. The gate: no-show may be filed only after `scheduledStart + 30 minutes`, requires the reporter's geolocated check-in (`checkInAt`/`checkInLocation` already exist on the model), gives the accused **2 hours** to respond, and auto-resolves in the reporter's favour on silence. Undisputed → automatic. Disputed → admin arbitration via the existing dispute flow. `[OPEN]` on the 30min / 2h values.
- **Stylist penalty is a debt, never a deduction from the client's price** — §12 is correct and the reasoning is sound (see §G.1/§M).
- **Repeat no-shows:** 3 within 60 days → 7-day suspension from the broadcast feed. 5 within 90 days → account review. `[OPEN]`

## H.1 Stylist penalty ledger — why §12's model is right

§12 asks whether the debt-ledger model is best. **It is, and the alternatives are worse:**

- *Charge the stylist's card immediately* — Murafiq has no stored stylist payment instrument. Paymob integration is collect-only.
- *Deduct from the current booking's escrow* — there is nothing to deduct from; the client is being refunded 100%.
- *Raise the price of a future booking* — §12 correctly rejects this. It makes the stylist's next client pay for a stranger's cancellation, and corrupts the agreed price on a signed booking.

The debt ledger keeps the penalty attached to the party who incurred it, settles it against money the platform already controls (the payout batch), and produces a complete audit trail. The one real gap is a stylist who incurs debt and never earns again — see §N.

```
Penalty {
  stylistId, bookingId
  reasonType     'LATE_CANCEL' | 'EARLY_CANCEL' | 'NO_SHOW' | 'POLICY_VIOLATION'
  assessedMinor  Number
  settledMinor   Number     default 0
  status         'OUTSTANDING' | 'PARTIALLY_SETTLED' | 'SETTLED' | 'WAIVED'
  waivedBy, waivedReason
}
unique index: { bookingId, reasonType }        // idempotent assessment
index: { stylistId, status }
```

Settlement happens inside `payout.service.createBatchPayouts`: compute `eligibleTotal`, subtract `outstandingFor(stylistId)` capped at `eligibleTotal`, post `PENALTY_SETTLEMENT` ledger entries, then create the Payout for the net. **Never let a batch go negative.** Residual debt stays OUTSTANDING for the next batch.

---

# I. Chat Moderation & Security Architecture

## I.1 The enforcement point (confirmed decision)

**Today:** `firestore.rules:42` lets participants write messages straight to Firestore. The Node backend never sees them, so no server-side moderation is possible at all.

**Change:**
1. `firestore.rules` → `allow create: if false` on `conversations/{id}/messages`. Firestore becomes read + read-receipt-update only.
2. All sends go through the existing `POST /api/v1/chat/:conversationId/messages`, which already validates participation, `isOpen`, and `isLocked` (`chat.service.js:199`). Insert the moderation call before the Firestore write.
3. Firestore remains the realtime **read** path — the client's `onSnapshot` listener is unchanged, so perceived latency is one server round-trip on send, not a rearchitecture.

This requires a **coordinated mobile-client release**. The rules change must ship *after* the client that stops writing directly, or every send breaks. See §O.

## I.2 Detection pipeline

Layered, in order, short-circuiting on first CRITICAL. §2 explicitly rejects a plain word list, and this is not one.

```
raw message
  │
  ├─ 1. NORMALIZE
  │     unicode NFKC · confusable/homoglyph fold (Cyrillic а → Latin a)
  │     leet fold (0→o, 1→l, 3→e, @→a) · strip zero-width chars
  │     collapse whitespace/separators between digits
  │     Arabic-Indic digits (٠١٢٣) → ASCII · Arabic diacritic strip
  │
  ├─ 2. CONTACT RULES  (regex over the normalized form)
  │     Egyptian mobile: (\+?20|0)1[0125]\d{8}  — after separator collapse,
  │       which is what defeats "0 1 0 - 1 2 3 …"
  │     spelled-out digits: (zero|one|…|صفر|واحد|…){7,}
  │     email: standard, plus "name at gmail dot com" / "at" / "[at]" / "(at)"
  │     social handles: @handle, "wa.me/", "t.me/", "snap:", "insta"
  │     ► verdict BLOCK_ONLY
  │
  ├─ 3. DOMAIN RULES
  │     extract URLs (incl. bare domains, shorteners resolved to a denylist)
  │     BlockedDomain collection: adult, competitor, off-platform payment
  │     ► verdict BLOCK_ONLY (competitor/payment) or RESTRICT (adult)
  │
  ├─ 4. LEXICON  (curated, bilingual AR/EN, severity-weighted — NOT the whole system)
  │     tier A: explicit sexual terms → RESTRICT
  │     tier B: curated CRITICAL set → CRITICAL
  │
  └─ 5. CLASSIFIER  (provider interface — mirrors payments mock/paymob and mail
                     resend/sendgrid; selected by MODERATION_PROVIDER, default `none`)
        `none`   → returns { score: null }; layers 1–4 decide alone. SHIPPED DEFAULT.
        `openai` → OpenAI moderation endpoint (`omni-moderation-latest`).
                   Returns scored labels: harassment, harassment/threatening,
                   violence, hate, sexual, self-harm. Multilingual incl. Arabic.
                   Used to (a) raise BLOCK_ONLY→RESTRICT on high confidence,
                           (b) downgrade a list hit to SUSPECT on low confidence.
        ►► MUST fail OPEN (allow + record SUSPECT) on error or timeout.
           Hard 2s timeout. An outage must never silently block a marketplace's chat.
```

### Classifier: conditional approval and its verification gate

The PO approved OpenAI **only on the condition that it is genuinely free.** That condition must be
checked by a human, not assumed:

> **GATE — do not enable `MODERATION_PROVIDER=openai` until all four are confirmed:**
> 1. The moderation endpoint is still **free of charge** on OpenAI's current pricing page. *(It has
>    historically been offered at no cost, unlike completions — but this document's author cannot
>    verify live pricing, and "it was free" is not evidence that it is free today.)*
> 2. Its **rate limits** are sufficient for peak message volume. Free endpoints still have quotas.
> 3. Sending **chat content to a third party** is acceptable — this is a data-residency decision, not
>    a technical one, and it is the reason to keep `none` viable regardless of price.
> 4. The **fail-open path is tested**: kill the API key, confirm messages still send and record
>    `SUSPECT`.
>
> Until all four pass, ship `none`. The system is designed to be fully functional without it.

**Layers 1–4 are 100% local and cost nothing** — and they cover the majority of §2's real requirement.
Contact-information leakage and obfuscation is deterministic string work; blocked domains are a DB
lookup. Neither needs ML. **The classifier is an enhancement, never a dependency.**

**What each configuration actually gives you:**

| Capability | Layers 1–4 only (`none`) | With `openai` |
|---|---|---|
| Phone / email / handle, incl. obfuscation | **Strong** — deterministic | Strong (unchanged) |
| Adult URLs, blocked domains | **Strong** — denylist | Strong (unchanged) |
| Explicit sexual vocabulary | **Good** — curated bilingual list | **Strong** |
| Threats, insults, harassment | **Weak** — lists miss phrasing, sarcasm, implication | **Good** |
| Novel / coded phrasing | **Weak** — a list only knows what is on it | **Moderate** |
| False-positive control | **Poor** — no confidence score to downgrade a hit to SUSPECT | **Good** |

**Compensating control — mandatory in BOTH configurations:** ship a **"Report message"** action in the
chat UI that files a `ModerationEvent` with `source: 'USER_REPORT'` into the review queue. It is the
only cover for threats and harassment when running `none`, and it still catches what the classifier
misses when running `openai`. It costs nothing per message. Treat it as part of the moderation
deliverable, not a later nice-to-have.

**Configurability** (§2 asks for this explicitly): `BlockedDomain` and the lexicon live in Mongo, admin-editable, hot-reloaded on a short TTL cache. Severity thresholds live in `common/constants/moderation.constant.js` as named constants. Adding a rule is a DB row, not a deploy.

## I.3 Records

```
ModerationEvent {                          // every scan that wasn't clean
  userId, conversationId, bookingId
  ruleHits          [{ rule, severity, matchedSpan }]
  verdict           'CLEAN' | 'SUSPECT' | 'BLOCK_ONLY' | 'RESTRICT' | 'CRITICAL'
  action            'ALLOWED' | 'BLOCKED' | 'ENFORCED'
  messageHash       String    // sha256 — NOT the plaintext
  redactedExcerpt   String    // matched span + small window, for admin review
  classifierScore   Number | null
  reviewedBy, reviewOutcome, reviewedAt    // admin confirm / overturn
}
index: { userId, createdAt }, { verdict, reviewedAt }

PolicyViolation {                          // confirmed violations only
  userId, severity, sourceEventId
  consequence  'WARNING'|'CHAT_RESTRICTED'|'SUSPENDED'|'BANNED'
  bookingId, expiresAt
}
index: { userId, createdAt }
```

**[REC] Store a hash + a redacted excerpt, never the full blocked message.** For CRITICAL bands the content is often material the platform must not retain. The excerpt gives admins what they need to confirm or overturn.

## I.4 Enforcement chain (RESTRICT / CRITICAL)

Executed by `enforcement.service`, in one transaction where the DB permits, in this order:

1. **Block the message** — never written to Firestore.
2. **Record** `ModerationEvent` + `PolicyViolation`.
3. **Audit** — emit `MODERATION_VIOLATION`; the existing `audit-log.listener.js` `AUDIT_EVENT_MAP` gains this entry. **No parallel security log is built** (§17 lists `SecurityAuditLog` as a separate concept; the existing `AuditLog` already covers it — add a `severity` field instead).
4. **Revoke sessions** (the confirmed §17 answer, no Socket.IO):
   - `auth.revokeRefreshTokens(uid)` via firebase-admin → Firestore listeners drop within ~1 minute and no new custom token can be minted.
   - Clear `User.refreshTokenHash` → refresh flow dies immediately.
   - **New:** add `User.tokenVersion` (Number). `generateTokens.js` embeds it; `auth.middleware.js` compares it against a small in-process TTL cache of `{userId → tokenVersion}`. Bumping it kills every outstanding access token **without** a DB read per request. This closes the current hole where a banned user keeps a valid access JWT until expiry.
5. **Restrict the account** — `accountStatus` gains `'restricted'` (chat-disabled, existing bookings honoured) alongside the existing `active`/`suspended`/`deleted`.
6. **Freeze the booking** — `isFrozen: true`. Blocks check-in, completion, and payout eligibility. Does **not** change status.
7. **Hold payout** — a frozen booking is excluded from `payoutRepository.getEligibleBookingsForStylist`.
8. **Refund + booking termination** — **CRITICAL only, or admin-confirmed RESTRICT.** Never from a bare BLOCK_ONLY. This is the §2 safeguard against naive-match financial penalties.

**Violations after the service completes:** steps 1–5 apply; steps 6–8 do not. Money that has already been earned for a delivered service is not clawed back for a later chat violation. `[OPEN]` — confirm with PO.

---

# J. Database Changes

MongoDB, so all changes are additive except two index drops. No migration files exist in this project; follow the `scripts/backfill-broadcast-visibility.js` precedent — one idempotent, re-runnable script per change, ending with the relevant `Model.syncIndexes()`.

## J.1 New collections

`Plan`, `Subscription`, `UsageCounter`, `LedgerEntry`, `Penalty`, `Coupon`, `ModerationEvent`, `PolicyViolation`, `BlockedDomain`, `ReliabilityEvent`. Fields as specified in §E, §G, §H.1, §I.3, §L.

## J.2 Modified collections

**`Request`** (`request.model.js`)
- `status` enum → `['OPEN','PAUSED','CLOSED','FULFILLED','CANCELLED','DECLINED']`
- **add** `offerCount: { type: Number, default: 0 }`
- **add** `firstOfferAt: Date`
- **add** `pauseCount: { type: Number, default: 0 }`, `pausedAt: Date`, `reactivatedAt: Date`
- **add** `autoPauseAt: Date` (replaces the semantic of `expiresAt`; keep the field name or rename — renaming requires a backfill, keeping it requires a doc comment. **[REC] rename to `autoPauseAt`**, the old name now actively misleads)
- **add index** `{ status: 1, autoPauseAt: 1 }` — drives the auto-pause sweep
- **add index** `{ clientId: 1, status: 1 }` — drives the `requests.active` capacity count
- **existing** `{ visibility, status, 'meetingLocation.governorate', createdAt }` stays valid

**`Offer`** (`offer.model.js`)
- **DROP** `offerSchema.index({ requestId: 1, stylistId: 1 }, { unique: true })` — **the single most important change in §7.** Requires an explicit `Offer.collection.dropIndex('requestId_1_stylistId_1')` in the migration script; `syncIndexes()` alone will handle it but be explicit.
- **add** non-unique `{ requestId: 1, stylistId: 1, status: 1 }` — still needed for the per-request cap check and the feed's `myOffer` lookup (`request-feed.service.js:74`)
- `status` enum → `['PENDING','ACCEPTED','REJECTED','WITHDRAWN','CLOSED','EXPIRED']`
- **add index** `{ stylistId: 1, status: 1 }` — drives `offers.active` capacity
- **existing** `{ stylistId, clientId, status }` stays but its *purpose* changes from enforcing uniqueness to plain lookup

**`Booking`** (`booking.model.js`)
- `status` enum **+=** `['no-show-stylist','no-show-client']`
- **add** `isFrozen: Boolean`, `frozenReason: String`, `frozenAt: Date`
- **add** `noShowDetails: { reportedBy, reportedAt, respondedAt, response, confirmedBy, confirmedAt, evidence: [String] }`
- **add index** `{ isFrozen: 1, payoutStatus: 1 }` — payout eligibility filter

**`Payment`** (`payment.model.js`)
- **add `refundedAt: Date`** — this field is written today (`payment.service.js:238`) and **silently discarded** by Mongoose strict mode. Every refund timestamp in the current production database is lost. Standalone bug fix, ship it early.
- **add** `refundTier: String` — which policy branch produced this refund, for audit
- **add** `idempotencyKey: String, unique: true, sparse: true`

**`User`** (`user.model.js`)
- **add** `tokenVersion: { type: Number, default: 0 }` — access-token revocation (§I.4)
- `accountStatus` enum **+=** `'restricted'`
- **add** `chatRestrictedUntil: Date`

**`StylistProfile`** (`stylist-profile.model.js`)
- **add** `reliabilityScore: { type: Number, default: 100 }`, `reliabilityTier: String`
- **add** `noShowCount`, `lateCancelCount` (alongside the existing `cancelledSessions`)
- **add index** `{ reliabilityScore: -1 }` — feed ranking

**`AuditLog`** (`audit-log.model.js`)
- **add** `severity: { type: String, enum: ['info','warn','critical'], default: 'info' }`
- No structural change otherwise. **This is the `SecurityAuditLog` from §17** — do not build a second one.

**`statuses.constant.js`**
- Delete `BOOKING_STATUS.PENDING` (dead — not in the model enum)
- Replace `CANCELLATION_POLICY` with the new named constants: `CLIENT_CANCEL_THRESHOLD_HOURS: 24`, `CLIENT_EARLY_PLATFORM_FEE_PCT: 3`, `CLIENT_LATE_PLATFORM_FEE_PCT: 20`, `STYLIST_EARLY_PENALTY_PCT: 3`, `STYLIST_LATE_PENALTY_PCT: 20`, `STYLIST_NO_SHOW_PENALTY_PCT: 10`

**`defaults.constant.js`**
- `DEFAULT_CAPS` becomes a **fallback only**, used when no Subscription row exists. Real limits come from `entitlement.service`. Delete `CLIENT_DAILY_REQUESTS_UNVERIFIED` (dead — unverified users cannot create requests at all).

## J.3 Data migration strategy

**Ordering rule: enum widening ships in a deploy BEFORE any code writes the new values.** Mongoose validates enums on write; a rolling deploy where instance A writes `'OPEN'` while instance B still has the old enum causes validation failures on read-modify-write paths.

| Step | Action | Reversible? |
|---|---|---|
| 1 | Deploy widened enums (old + new values both accepted). No behaviour change. | yes |
| 2 | Backfill script: `pending`/`offered` → `OPEN`; `expired` → `PAUSED`; `accepted` → `FULFILLED`; `cancelled` → `CANCELLED`; `rejected` → `DECLINED`. Set `offerCount` from `Offer.countDocuments({requestId})`, `firstOfferAt` from the earliest offer's `createdAt`. Set `autoPauseAt` from `expiresAt`. | yes (inverse map) |
| 3 | Backfill Offer statuses: `pending`→`PENDING`, `accepted`→`ACCEPTED`, `expired`→`EXPIRED`. **`rejected` is ambiguous** — a rejected offer whose request is `FULFILLED` and whose `requestId` has an `ACCEPTED` sibling → `CLOSED`; otherwise → `REJECTED`. | yes |
| 4 | Drop the `{requestId, stylistId}` unique index; `Offer.syncIndexes()`. | **no** — recreating it would fail once duplicates exist |
| 5 | Seed `Plan` catalogue. Auto-provision a free `Subscription` for every existing user (`client.free` / `stylist.free`). | yes |
| 6 | Ledger opening balances: one `ADJUSTMENT` entry per historical Payment/Payout representing its settled state, `correlationId: 'MIGRATION_OPENING_BALANCE'`. Do **not** attempt to replay history. | yes (delete by correlationId) |
| 7 | Deploy code that writes only new values. | yes |
| 8 | Narrow the enums to new values only. | yes |

**Step 4 is the only irreversible step.** Run it in its own deploy window, after step 3 has been verified.

---

# K. API Changes

## K.1 Requests

| Endpoint | Change |
|---|---|
| `POST /requests` | **modify** — quota via `entitlements.consume('requests.daily')`; also check `requests.active` capacity |
| `PATCH /requests/:id` | **NEW** — edit. `409` if `firstOfferAt` is set. Does not reset `autoPauseAt`. |
| `PATCH /requests/:id/close` | **NEW** — client closes at any time (§8) |
| `PATCH /requests/:id/reactivate` | **NEW** — `PAUSED → OPEN`, new 48h window, `pauseCount++`, `409` past the reactivation limit |
| `PATCH /requests/:id/cancel` | **modify** — allowed from `OPEN` and `PAUSED` (today: `pending` only); quota refund if within grace window and zero offers |
| `GET /requests/feed` | **modify** — match `status: 'OPEN'` (unblocks multi-offer bidding); optionally rank by stylist `feed.priority` entitlement |
| `GET /requests/mine`, `/incoming` | **modify** — drop the lazy `expireOldRequests()` call; the cron sweep owns this now |

## K.2 Offers

| Endpoint | Change |
|---|---|
| `POST /offers/requests/:id` | **modify** — remove the `findActiveForClient` 409; quota via `entitlements.consume('offers.daily')` (now counting direct too); check `offers.active` capacity; enforce the per-request cap of 3 |
| `PATCH /offers/:id/accept` | **modify** — sibling offers → `CLOSED` not `REJECTED`; request → `FULFILLED`. **Keep the existing CAS lock + retry envelope verbatim.** |
| `PATCH /offers/:id/reject` | **modify** — must **not** reset the request to `pending` (`offer.service.js:203`); the request stays `OPEN` |
| `PATCH /offers/:id/withdraw` | **NEW** — stylist retracts, frees an active slot |
| `GET /offers/mine` | **NEW** — stylist's own offers + active-slot usage |

## K.3 Subscriptions (all new)

`GET /subscriptions/plans` · `GET /subscriptions/me` · `GET /subscriptions/me/entitlements` · `GET /subscriptions/me/usage` · `POST /subscriptions/subscribe` · `POST /subscriptions/change-plan` · `POST /subscriptions/cancel` · `POST /subscriptions/webhook` (Paymob, signature-verified, idempotency-keyed).

## K.4 Chat

| Endpoint | Change |
|---|---|
| `POST /chat/:conversationId/messages` | **modify** — becomes the *only* write path. Moderation runs before the Firestore write. Returns `422` + a machine-readable `violationCode` on block. |
| `GET /chat/:conversationId/messages` | unchanged |
| `POST /chat/token` | **modify** — refuse for `restricted`/`suspended` accounts |

## K.5 Bookings

| Endpoint | Change |
|---|---|
| `PATCH /bookings/:id/cancel` | **modify** — new percentages; CAS guard against a simultaneous counterparty cancel; stylist path posts a Penalty instead of touching the client's price |
| `POST /bookings/:id/no-show` | **NEW** — file a no-show (replaces `dispute type:'no_show'`) |
| `POST /bookings/:id/no-show/respond` | **NEW** — accused party's rebuttal window |
| `GET /bookings/:id/cancellation-quote` | **NEW** — backend-computed refund preview so the client app can *display* the number without calculating it (§10) |

## K.6 Coupons, reliability, moderation admin

`POST /admin/coupons` · `GET /coupons/mine` · `POST /coupons/validate` (returns computed discount for a given booking price) · `GET /stylists/:id/reliability` · `GET /admin/moderation/events` · `PATCH /admin/moderation/events/:id/review` · `POST /admin/users/:id/restrict` · `GET /admin/ledger` · `GET /admin/ledger/reconciliation`.

**Deprecate:** nothing is removed outright. `POST /bookings/:id/dispute` with `type: 'no_show'` continues to work but is marked deprecated in Swagger and routes internally to the new no-show flow for one release.

---

# L. Background Jobs

Stay on in-process `node-cron`, following `src/jobs/offer-expiry.cron.js` exactly: idempotent registration guard, `NODE_ENV === 'test'` early return, and the PM2 `instances: 1` pin. **Redis/BullMQ remains deferred to Phase 14** per `HARDENING_07` — none of the jobs below justify pulling it forward.

| Job | Schedule | Why it must exist |
|---|---|---|
| **Request auto-pause** | `*/10 * * * *` | §8's 48h rule. Must be a sweep — today's lazy `expireOldRequests()` only fires when *someone reads a list*, so an abandoned request stays in the feed indefinitely. |
| **Offer long-stop expiry** | `0 * * * *` | Existing cron, window changed 24h → 30d. |
| **Subscription renewal/expiry** | `0 2 * * *` | Period end → charge or downgrade to Free. Cannot be lazy: entitlements must be correct *before* the user's first action of the day. |
| **Payment reconciliation** | `*/15 * * * *` | Payments `pending` > 30 min → query the provider. Closes the "payment succeeded but the webhook never arrived" gap (§23). |
| **Refund retry** | `*/30 * * * *` | Retries entries where `Payment.refundError` is set. Idempotent by ledger key. |
| **Ledger reconciliation** | `0 3 * * *` | §G.4. Read-only; alerts on non-zero delta. |
| **No-show auto-resolution** | `*/15 * * * *` | Response window elapsed → resolve in the reporter's favour. |

**Deliberately NOT jobs:**
- **Usage reset** — `periodKey` + TTL index makes it implicit (§E.3).
- **Coupon expiry** — checked lazily at redemption; a TTL index reaps the rows. A sweep would write to thousands of documents to change a field nobody reads.
- **Reliability recompute** — event-driven off `BOOKING_CANCELLED` / `SESSION_COMPLETED` / no-show events. A nightly recompute over every stylist is wasteful and adds up to 24h of staleness.
- **Moderation escalation** — evaluated synchronously at violation time against the user's rolling violation count.

---

# M. Concurrency, Transactions, Idempotency

MongoDB replica set is already mandatory (`AGENTS.md:227`), so multi-document transactions are available. **No distributed lock is needed anywhere in this design** — every case below is solved by a CAS update, a unique index, or a transaction.

| Race | Protection |
|---|---|
| **Daily quota double-spend** | Atomic conditional upsert: `findOneAndUpdate({ subjectId, metric, periodKey, used: { $lt: limit } }, { $inc: { used: 1 } }, { upsert: true })`. When the doc exists and `used >= limit`, the filter misses, the upsert attempts an insert, and the unique index on `{subjectId, metric, periodKey}` throws `E11000` — **caught and translated to `429 Quota exceeded`**. Single round trip, no read-then-write window. |
| **Active-offer / active-request capacity** | Count + insert inside one transaction, with the count re-read inside the transaction. Slightly weaker than a unique index but the failure mode (one offer over the cap) is benign; a hard index is not worth the schema contortion. |
| **Two clients accept competing offers** | **Already solved.** CAS lock (`requestRepository.lockAndAccept` filters `status: {$in:['pending','offered']}`) + unique indexes on `Booking.offerId`, `Booking.requestId`, `ScheduleBlock{stylistId,date,startMinute}`, plus the transient-error retry envelope in `offer.service.js:161`. **Preserve this exactly** — only update the status values in the CAS filter. |
| **Client and stylist cancel simultaneously** | CAS: `findOneAndUpdate({ _id, status: { $in: ['confirmed','in-progress'] }, isFrozen: { $ne: true } }, { $set: { status: 'cancelled', cancelledBy } })`. First writer wins; the loser gets `409` and **no second refund is computed**. |
| **Duplicate refund** | `LedgerEntry.idempotencyKey` unique index. Second attempt returns the existing entry. Also add `Payment.idempotencyKey`. |
| **Duplicate payment webhook** | Already partly handled (early return on `status === PAID`, `payment.service.js:136`) but **failed webhooks re-emit `PAYMENT_FAILED` on every delivery**. Add a `ProcessedWebhook` collection keyed on `{provider, providerEventId}`, unique. |
| **Completed vs no-show at the same time** | CAS on status. Also: no-show cannot be filed before `scheduledStart + 30min`, and completion requires *both* confirmations — the windows barely overlap. |
| **Penalty settled twice** | `Penalty` unique on `{bookingId, reasonType}` for assessment; `PENALTY_SETTLEMENT` ledger entries keyed on `{penaltyId, payoutId}` for settlement. Settlement happens inside the existing `createBatchPayouts` transaction. |
| **Coupon redeemed twice** | CAS: `findOneAndUpdate({ _id, status: 'ISSUED' }, { $set: { status: 'REDEEMED', redeemedOnBookingId } })`. |
| **Subscription charged twice** | Provider `idempotencyKey` on the charge + unique `{userId, currentPeriodStart}` on Subscription. |

---

# N. Edge Cases

Every scenario from §23, plus gaps found while reading the code.

| # | Scenario | Recommended rule |
|---|---|---|
| 1 | Client cancels after stylist already cancelled | Booking already terminal → `409`. Stylist's penalty stands; client's refund is already 100%. |
| 2 | Stylist cancels after client initiated | CAS decides. Whoever's write lands first owns the outcome; the loser gets `409`. No double-refund is possible because the refund is computed once, after the CAS. |
| 3 | Cancellation at exactly 24h00m | Client-favourable tier (97% refund). Already correct in code. |
| 4 | Service already started (`in-progress`) | Cancellation blocked. Route to the dispute flow. `[OPEN]` — confirm no mid-session cancellation is wanted. |
| 5 | Client no-show | **60% refund, stylist paid 20%, platform 20% [PO, FINAL].** Requires stylist check-in + the 2h response window. See §H. |
| 6 | Stylist no-show | 100% refund + 10% coupon; 10% penalty; reliability hit. **[PO]** |
| 7 | Booking dispute | Existing flow, unchanged. Blocks payout. Admin resolves to `completed` or `cancelled` only. |
| 8 | Partial refunds | Supported. Ledger records the exact split. `Payment.status = 'partially_refunded'`. |
| 9 | Failed refund | Ledger entry stands (records intent), `Payment.refundError` set, retry cron picks it up. Idempotent by key — a retry after a silent provider success cannot double-refund. |
| 10 | Payment succeeds, booking creation fails | Cannot happen in the current order — the Payment row is created *inside* the booking transaction (`booking.service.js:113`) and the client pays afterwards. If the provider charges against an orphaned intention, the reconciliation cron detects a paid payment with no `confirmed` booking and auto-refunds. |
| 11 | Booking exists, payment fails | Booking stays `confirmed` but unpaid. Check-in and chat are already gated on `PAYMENT_STATUS.PAID` (`booking.service.js:207`). **[REC]** auto-cancel unpaid bookings after 60 minutes and release the `ScheduleBlock` — today they hold a stylist's slot forever. `[OPEN]` on 60 min. |
| 12 | Subscription expires while a request is active | Active requests are never retroactively closed. The user simply cannot create new ones beyond the Free limit. |
| 13 | Downgrade with excess wardrobe photos | Grandfather. Block new uploads until under the new cap. Never auto-delete. |
| 14 | Downgrade with excess active requests | Grandfather. Block new creation. Existing requests run to completion. |
| 15 | Downgrade with excess active offers | Grandfather. Block new offers. Existing offers stay live — closing them would break bids clients are actively comparing. |
| 16 | Daily quota across timezones | Africa/Cairo, fixed, platform-wide. `getBusinessDayRange()` already correct. |
| 17 | User changes timezone | No effect. Quota day is platform-fixed, deliberately. |
| 18 | Cancel subscription mid-period | Entitlements remain until `currentPeriodEnd`. `cancelAtPeriodEnd: true`. No proration refund. **[REC]** |
| 19 | Failed renewal | `past_due` + a 3-day grace period at current entitlements, then downgrade to Free. `[OPEN]` on 3 days. |
| 20 | Duplicate webhook | `ProcessedWebhook` unique on `{provider, providerEventId}`. |
| 21 | Duplicate refund webhook | Ledger `idempotencyKey`. |
| 22 | Restricted/blocked user with an active booking | Booking is honoured unless the violation is CRITICAL. Chat disabled; the counterparty is notified and may cancel penalty-free. |
| 23 | Chat violation after the booking starts | Full enforcement chain. Refund is prorated by elapsed service time and requires admin confirmation. `[OPEN]` |
| 24 | Chat violation after the service completes | Account consequences only (steps 1–5). **No clawback** of a delivered, paid service. `[OPEN]` |
| 25 | Multiple simultaneous stylist penalty debts | They sum. `outstandingFor()` returns the total; settlement is FIFO by `assessedAt`. |
| 26 | Payout insufficient to cover penalties | Settle up to the payout amount, never below zero. Residual stays `OUTSTANDING`. **[REC]** at 90 days outstanding, or 3× the stylist's monthly average, freeze new offers until settled. `[OPEN]` |
| 27 | Coupon + subscription discount together | Independent axes — a coupon discounts a *booking*, a subscription discounts nothing (it grants quota). No interaction. **[REC] one coupon per booking, never stacked.** |
| 28 | Multiple offers from the same stylist to the same client | **Allowed** (§7). Capped at 3 per request and by `offers.active`. |
| 29 | Offer arrives exactly as the 48h auto-pause runs | The sweep filters `{ status: 'OPEN', autoPauseAt: { $lt: now }, offerCount: 0 }`. The offer-creation transaction sets `offerCount: 1`. Whichever commits first wins; if the pause wins, **the offer still succeeds** (offers are valid on `PAUSED` requests) and the offer handler reactivates the request. No offer is ever lost. |
| 30 | Request edited seconds before the first offer | The edit transaction re-reads `firstOfferAt` inside the transaction. If an offer landed, the edit gets `409`. |
| 31 | Free client with a PAUSED request tries to create a new one | Blocked by `requests.active` capacity (1 for Free). Error message directs them to reactivate or close the paused one. **This is the §8 rule, expressed as capacity rather than as a special case.** |
| 32 | Stylist accepts a booking, then their subscription lapses | Booking honoured. Entitlements only gate *new* offers. |
| 33 | Client pays, then the stylist is banned before the service | Full refund + coupon, funded by the platform; the stylist's penalty is assessed at 100%. `[OPEN]` |

---

# O. Migration & Rollout Strategy

Ship in the order below. Each step is independently deployable and independently revertable except where noted.

1. **Bug fixes first, no new features.** Add `Payment.refundedAt` to the schema; delete `BOOKING_STATUS.PENDING`; correct `docs/MONEY_AND_LEDGER.md` to describe the policy the code actually implements. These are safe, small, and each is verifiable on its own.
2. **Enum widening deploy.** Old + new values both accepted everywhere. Zero behaviour change. Verify with a full test-suite run.
3. **Backfill scripts** (steps 2–3 of §J.3), run against a restored production snapshot first, with row counts asserted before and after.
4. **Index drop** — the one irreversible step. Its own deploy window.
5. **Subscription module, shadow mode.** Seed plans, provision free subscriptions, and have `entitlement.service` **log** what it *would* have decided while `DEFAULT_CAPS` still enforces. Compare for one week. This is the only way to discover that a real user's usage pattern breaks under the new limits *before* it breaks for them.
6. **Cut over enforcement**, one entitlement at a time (`requests.daily` first — smallest blast radius), behind a per-metric feature flag.
7. **Request/offer lifecycle**, then **cancellation/refund**, then **chat moderation**.
8. **Chat moderation ordering is critical and is the one place a wrong order causes an outage:**
   a. Deploy the backend proxy path (both write paths working).
   b. Ship the mobile client that writes via REST instead of Firestore.
   c. Wait for adoption ≥ 95% (measurable — direct Firestore writes are observable).
   d. **Only then** flip `firestore.rules` to `allow create: if false`.
   Force-upgrade any client below the threshold; do not strand them.
9. **Moderation in observe-only mode for two weeks** — scan, record `ModerationEvent`, block nothing. Measure the false-positive rate on real traffic, tune the rules, *then* enable blocking. Enabling a regex-based blocker on live marketplace chat without this measurement is how you silently break legitimate conversations at scale.

---

# P. Implementation Stages

Not to be executed now. **These are stages of this revision (`R0`–`R12`), not project phases** — they
do not extend the `PHASE_XX` sequence and none of them wait on Phases 14, 15, or 16.

| Stage | Scope | Depends on |
|---|---|---|
| **R0 — Corrections** | The §O.1 bug fixes + doc truth-up. No new features. | — |
| **R1 — Domain foundation** | Enum widening, new fields, indexes, backfill scripts, index drop. | R0 |
| **R2 — Ledger** | `LedgerEntry`, `ledger.service`, idempotency, opening-balance backfill, reconciliation job. Payment/Payout write to it in parallel with existing behaviour (dual-write, ledger read-only). | R1 |
| **R3 — Subscriptions & entitlements** | Plan/Subscription/UsageCounter, `entitlement.service`, Paymob subscription flow, shadow mode → cutover. | R1, R2 |
| **R4 — Request lifecycle** | OPEN/PAUSED/reactivate, edit endpoint, auto-pause cron, feed fix, quota integration. **Also closes Phase 12's outstanding OTP-cleanup and session-reminder sweeps** — see below. | R1, R3 |
| **R5 — Offer lifecycle** | Multiple offers, active/daily split, withdraw, `CLOSED` vs `REJECTED`, long-stop expiry. | R4 |
| **R6 — Cancellation, refunds, penalties** | New percentages, `Penalty` model, payout netting, cancellation-quote endpoint. | R2 |
| **R7 — No-show** | New statuses, filing + response flow, auto-resolution job, coupon issuance. | R6, R8 |
| **R8 — Coupons** | `Coupon` model, issue/validate/redeem, booking-price integration. | R2 |
| **R9 — Chat moderation** | Scanner pipeline, ModerationEvent/PolicyViolation, `tokenVersion` revocation, enforcement chain, firestore.rules cutover. Observe-only → enforce. | R1, R6 |
| **R10 — Reliability** | `ReliabilityEvent`, score computation, tiers, feed effects. | R5, R7 |
| **R11 — Admin & ops** | Moderation review queue, ledger explorer, reconciliation dashboard, restriction controls. | all |
| **R12 — Test & rollout** | Full matrix per §Q, load test on the quota path, staged rollout. **Also closes Phase 13's outstanding docs/test audit** — see below. | all |

### Closing Phases 12 and 13 as part of this revision

Phases 12 and 13 are both marked partial in `docs/03_SKELETON_STATUS.md`. **Their leftovers are not
separate work — they land naturally inside this revision and should be finished here**, not scheduled
as their own effort. Doing them separately means opening the same files twice and re-solving the same
problems.

| Outstanding from | Item | Closed by | Why it belongs there |
|---|---|---|---|
| **Phase 12** | OTP-cleanup sweep | **R4** | R4 already adds the request auto-pause cron. Same `src/jobs/` folder, same `node-cron` pattern, same idempotent-registration guard, same PM2 `instances: 1` constraint. `src/jobs/` currently holds exactly one file — build all the sweeps in one sitting. |
| **Phase 12** | Session-reminder sweep | **R4** | Same as above. |
| **Phase 12** | Redis / BullMQ | *Not here* | Already reassigned to Phase 14 by `HARDENING_07` Part 2. This revision deliberately adds **no** queue infrastructure — every job in §L runs on `node-cron`. Leave it in Phase 14. |
| **Phase 13** | Swagger / docs audit pass | **R12** | This revision adds ~15 endpoints, and every one carries a mandatory `@swagger` block as a Definition-of-Done item. The audit pass *is* that work, applied across the whole surface. |
| **Phase 13** | Test coverage audit | **R12** | Same reasoning — §Q's matrix covers the modules Phase 13 was meant to audit. |

**When R4 and R12 are done, Phases 12 and 13 can both be marked ✅ in
`docs/03_SKELETON_STATUS.md`** — updating that file is part of the Definition of Done for both stages.

Phases R2 and R3 can run in parallel after R1. R8 can run in parallel with R6.

**Wardrobe (`wardrobe.photos.max`) and AI (`ai.messages.daily`) entitlements are defined in R3 but have no enforcement call site until Phases 14/15 land.** That is correct and expected.

---

# Q. Testing Strategy

Per `AGENTS.md`, anything touching payments, escrow, cancellation, or scheduling is **test-first, no exceptions**, and a full passing suite must be shown before any step is called done.

**Unit** — refund tier selection at 24h00m00s / 23h59m59s / 24h00m01s; entitlement resolution for every plan × metric; normalization (`٠١٢`, homoglyphs, zero-width, leet, spaced digits, spelled-out digits, `at`/`dot` substitution) with a golden corpus of ~200 AR/EN strings; penalty netting when debt > payout, debt < payout, debt == payout, and debt with a zero payout; `getBusinessDayRange` across a Cairo DST transition.

**Integration** — full lifecycles against the existing `mongodb-memory-server` replica set: create → 4 offers → accept one → verify 3 siblings are `CLOSED` (not `REJECTED`) and the request is `FULFILLED`; 48h pause → reactivate → new window; quota exhaustion returning `429` with the correct `retryAfter`; the complete moderation enforcement chain.

**Transaction** — assert rollback leaves *zero* partial state: kill the session mid-`createBookingFromOffer` and verify no orphan Booking, ScheduleBlock, Payment, or LedgerEntry.

**Race** — extend the existing `tests/integration/booking.broadcast-race.test.js` pattern (which is already the right shape): N parallel `consume()` calls against a limit of 1; simultaneous client+stylist cancel; simultaneous complete + no-show; offer landing at the same instant as the auto-pause sweep. **Use the project's proven sabotage-and-restore proof** — remove each guard, confirm the test fails, restore, confirm it passes. A race test that has never been shown to fail proves nothing.

**Payment** — duplicate webhook (same `providerEventId` twice → one ledger entry); refund retry after a silent provider success; reconciliation detecting a non-zero delta.

**Security** — banned user's access token rejected immediately after `tokenVersion` bump; restricted user cannot obtain a chat token; direct Firestore message write rejected post-cutover (test against the emulator with the real `firestore.rules`).

**E2E** — the four money-critical journeys end to end: happy path (request → offers → accept → pay → complete → payout), client late cancellation, stylist no-show (refund + coupon + penalty + reliability), and a CRITICAL chat violation (block → revoke → freeze → refund).

---

# R. Open Questions

> **Status: all resolved except item 23's named owner.** This section is retained as the decision
> *record* — the question, what was recommended, and what was chosen. Where a recommendation and the
> final decision differ, **the decision wins** and the Decisions Log at the top of this document is
> authoritative. Items struck through are closed.

**Pricing & plans**
1. ~~Enterprise client **requests/day**~~ — recommended 8, **PO chose 5.** Closed.
2. ~~Stylist **Pro yearly**~~ — recommended $28, **PO chose $30** (= 12× monthly). Closed.
3. ~~Stylist **Enterprise yearly**~~ — recommended $55, **PO chose $60** (= 12× monthly). Closed.
4. ~~**Stylist Basic yearly of $6**~~ — confirmed a **typo**; corrected to **$12** to match the 12× rule the PO set in items 2–3. Closed.
5. ~~**`maxActiveOffers` per plan**~~ — recommended 3/8/15/40, **PO chose "same as the daily quota"** → 3/6/10/20. Closed.
6. Confirm the **USD→EGP rate** and who may change it. *(Not blocking: implement as an admin-editable value seeded at deploy time.)*
7. ~~Yearly as one up-front charge vs 12 instalments~~ — **one up-front charge.** Paymob recurring is not integrated and this avoids the dependency entirely. Closed.

**Requests & offers**
8. Quota-refund grace window on cancellation — recommended **15 minutes**, zero offers.
9. Maximum reactivations per request — recommended **3**.
10. Offer long-stop expiry — recommended **30 days**.
11. Maximum offers from one stylist to one request — recommended **3**.
12. Should `requests.daily` count cancelled/expired requests? Recommended **no** (within the grace window).
13. Should the daily offer quota count **direct** offers? Recommended **yes** — currently it does not.
14. Keep `CLOSED` and `CANCELLED` as separate request states, or merge?

**Money**
15. ~~**Client no-show** policy~~ — undefined in the requirements. PO proposed 70/10/20 → 20/60/20 argued → **PO FINAL: client refunded 60% / stylist paid 20% / platform 20%.** Rationale and the post-launch metrics to watch are in §H. Closed.
16. ~~**Late stylist cancellation** — should it also issue the 10% coupon?~~ — **Yes.** Closed.
17. ~~Coupon defaults~~ — **DECIDED: 10% discount, capped at 150 EGP, 14-day expiry, single-use, one per booking, not stackable, no minimum booking value.**
    - **Cap of 150 EGP** — 10% uncapped means a 5,000 EGP booking generates a 500 EGP coupon. Platform exposure per no-show would scale with the *most valuable* bookings, which is backwards. 150 EGP = 10% of a 1,500 EGP booking, so the cap binds only on the top slice and is invisible on a typical one.
    - **14-day expiry** — the PO proposed 2 days. Two days is short enough that most recipients never use it, which turns compensation into a gesture the client notices is empty; the goodwill is worth more than the redemption cost. 14 days keeps urgency without that. *(One-line constant change if the PO wants 2 days back.)*
    - **No minimum booking value** — bookings already carry a 100 EGP schema floor, so a minimum is redundant; the percentage plus the 150 EGP cap already bound exposure.
18. ~~Coupon value: percentage vs fixed amount~~ — **DECIDED: percentage evaluated at redemption time, capped.** Self-adjusting to the booking it is used on, and the cap bounds the downside.
19. **Stylist debt ceiling** before offer suspension — recommended 90 days outstanding or 3× monthly average.
20. Unpaid-booking auto-cancel window — recommended **60 minutes**.
21. Subscription failed-renewal grace — recommended **3 days**.
22. Does the ledger move to **integer piastres** (recommended, and it amends a documented `AGENTS.md` invariant)?

**Trust & safety**
23. **CRITICAL lexicon — CLOSED 2026-08-28. The automatic-enforcement tier is DEFERRED OUT OF v1; no approver is needed.**

    Verified against the code: no `BlockedTerm` model, no CRITICAL word list, and no path from a word
    match to a refund exists. `CRITICAL` appears only as a severity label on a *strike count*
    (`moderation.service.js:69`), never as a match tier. **There is nothing to approve and nothing
    blocked.** What ships instead: the 3-strike ladder (WARN → RESTRICT → SUSPEND, each revoking
    sessions) plus the user-report queue. Rationale and revival preconditions are in "Deferred out of
    v1" at the top of this document.

    The remainder of this item describes the design **if** the tier is ever revived — it is a
    specification, not outstanding work:
    - **Sexual-content list → RESTRICT band.** Larger (~200–400 bilingual terms). Blocks the message and restricts the account, but **requires admin confirmation before any money moves.** Seed from LDNOOBW (`github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words`, has both `en` and `ar` files, free to use) plus published Arabic offensive-language research sets.
    - **CRITICAL list → automatic financial chain, no admin in the loop.** Deliberately tiny, ~30 terms. This is the only list where a match moves money by itself, so it must stay small and be reviewed by a person.
    - **Approval mechanism:** a `BlockedTerm` row carries `approvedBy` / `approvedAt`; **the scanner ignores every unapproved row.** Engineering can seed hundreds of candidates safely because none are active until approved. The owner's job is "review a list once," not "write a policy from scratch."
    - **Threats, insults, and harassment** are not covered by word lists and will not be reliably detected on `MODERATION_PROVIDER=none` — see §I.2. Covered by the classifier when enabled, and by the mandatory **user "Report message"** flow in both configurations.
    - **RESOLVED — who approves [PO]:** "admin or moderators," mapped onto the roles that already exist:

      | Action | Role |
      |---|---|
      | Review moderation events, confirm/overturn a RESTRICT verdict | `operator` **or** `admin` |
      | Approve a term into the **sexual-content** (RESTRICT) list | `operator` **or** `admin` |
      | Approve a term into the **CRITICAL** list | **`admin` only** |
      | Confirm a violation that triggers refund / booking termination | **`admin` only** |

      **Rationale for the split:** CRITICAL terms and violation confirmations move money with no further human in the loop. Everything that moves money stays at the highest privilege level; day-to-day review does not. This also means moderators can work the queue all day without ever being able to trigger a refund.

      ⚠️ **This amends an `AGENTS.md` invariant.** `AGENTS.md:121-122` currently states: *"`operator` role is scoped to exactly 3 verification routes — nothing else. Any other `/admin/*` route must reject an operator token with `403`."* Extending `operator` to the moderation review routes requires updating that line **in the same commit**. No new role is added — `ROLES.OPERATOR` already exists in `roles.constant.js` and `restrictTo(ROLES.ADMIN, ROLES.OPERATOR)` is already the established pattern in `admin.routes.js:25,31,38`.
24. Violation thresholds for escalation — recommended 3 BLOCK_ONLY in 30 days → RESTRICT.
25. Should a **post-completion** chat violation trigger any clawback? Recommended no.
26. Refund treatment for a violation **mid-service** — prorated by elapsed time? Admin-only?
27. Are **image messages** in scope for moderation? (Currently supported via `type` in `sendMessage`.) Image moderation is a materially larger build and is not covered by this plan.
28. **Data residency for the classifier — OPEN, and it is a gate, not a question.** The PO approved OpenAI *conditional on it being free*, which addresses cost but not residency: enabling it sends Egyptian users' private chat content to a US third party. Item 3 of the §I.2 gate must be signed off before `MODERATION_PROVIDER=openai` is switched on. Shipping `none` requires no such sign-off.
29. ~~Classifier fail-open vs fail-closed~~ — **Fail open**, record `SUSPECT`, 2s hard timeout. A moderation outage must never halt the marketplace's chat. Closed.

**Reliability**
30. Reliability score formula weights, tier thresholds, and whether the score is **publicly visible** or internal-only.
31. Repeat no-show thresholds — recommended 3/60 days → 7-day feed suspension; 5/90 days → review.

**Platform**
32. Is per-user timezone support needed, or does Africa/Cairo remain platform-fixed? (Recommended fixed.)
33. Confirm the **mobile client release timeline** — the `firestore.rules` cutover in §O.8 is blocked on it.

---

## Verification

This document is a plan, so verification is review rather than execution. Before implementation begins:

1. **Confirm the code claims.** Each assertion in §B cites a file and line. Spot-check the load-bearing ones:
   ```bash
   node -e "import('./src/modules/offers/offer.model.js').then(m=>console.log(m.default.schema.indexes()))"
   ```
   should show the `{requestId:1, stylistId:1}` unique index that §7 requires removing.
2. **Confirm the silent-drop bug** on a real database:
   ```bash
   node -e "import('./src/modules/payments/payment.model.js').then(m=>console.log('refundedAt' in m.default.schema.paths))"
   ```
   Expected `false` — confirming §B.5.
3. **Establish the baseline** before any change:
   ```bash
   npm test
   ```
   Expected: 51 suites / 214 tests passing, per `docs/03_SKELETON_STATUS.md`. Any deviation means the documented state is already stale and must be re-verified first.
4. **Answer §R** with the product owner. Items 1–5, 15, 17, and 23 block implementation; the rest can be defaulted to the recommendations and revisited.
5. **Approve the three invariant amendments** explicitly — each contradicts a line in `AGENTS.md`, and each must be updated there in the same commit that changes the behaviour:

   | `AGENTS.md` | Current invariant | Amendment | Driven by |
   |---|---|---|---|
   | `:138` | "One active (`pending`) offer per stylist–client pair at a time" | **Removed entirely** | Requirement §7 |
   | `:81-83` | "Piastres conversion happens **only** inside `paymob.provider.js`" | Ledger stores integer piastres; conversion boundary becomes `ledger.service.post()` | §G.1 |
   | `:121-122` | "`operator` is scoped to exactly 3 verification routes — nothing else" | `operator` also reviews moderation events and approves RESTRICT-list terms. **Still barred from CRITICAL terms and money-moving actions.** | §R item 23 |

   An invariant doc that lies is worse than no invariant doc — this is the exact failure mode
   `docs/03_SKELETON_STATUS.md` was created to fix.
