# Murafiq (مُرافِق) — Complete Product & Business Guide

> **The authoritative description of what Murafiq is and what it actually does today.**
>
> Every capability below was verified against the source code on **2026-08-29**, not taken
> from planning documents. Where something is planned but not built, it is in the
> **Upcoming** or **Deferred** sections and labelled as such. Nothing unbuilt is described
> as working.
>
> **Verification at time of writing**
> - `npm test` → **84 suites / 463 tests passing**
> - `npm run lint` → clean
> - `npm run validate:openapi` → **126 documented operations = 126 actual routes**, zero
>   ghosts, zero broken `$ref`s, security schemes declared
> - Application boots
>
> Companion documents: `docs/03_SKELETON_STATUS.md` (live build state) ·
> `docs/END_TO_END_TESTING_GUIDE.md` (workflow-by-workflow API walkthrough) ·
> `docs/REVISION_BUSINESS_RULES_AND_ARCHITECTURE.md` (business-rule specification) ·
> `AGENTS.md` (engineering invariants)

---

# PART I — THE PRODUCT

## 1. What Murafiq is

Murafiq is a **two-sided marketplace for in-person beauty and styling services in Egypt**. Clients
book vetted, independent professionals — hair stylists, makeup artists, personal shoppers, fashion
consultants — for appointments at home, in a hotel, or at an event venue.

The platform's job is to make a transaction between two strangers safe enough to happen:

| The problem | How Murafiq solves it |
|---|---|
| Neither party knows the other | Mandatory government-ID verification for both sides, plus a police-clearance certificate for stylists |
| The client risks paying for nothing | Money is held in escrow and released only after **both** parties confirm the service happened |
| The stylist risks working for nothing | The price is locked at booking; the client's payment is already collected before the stylist travels |
| Either side may not turn up | A no-show is a first-class, evidence-gated outcome with defined financial consequences |
| Users may take the deal off-platform | Contact details are detected and blocked in chat, with an escalating strike system |
| Disputes | Admin arbitration, backed by an immutable financial ledger and a full audit trail |

**Revenue model:** a platform commission on each completed booking (default **15%**, configurable
via `PLATFORM_FEE_PERCENTAGE`), plus **subscription plans** sold separately to clients and stylists.

## 2. The two ways a booking starts

Murafiq deliberately supports both discovery modes, because they suit different clients.

**Direct request** — the client browses or searches stylists, picks one, and sends a request to that
person only. Good for repeat clients and for anyone who cares about a specific professional.

**Broadcast request** — the client describes what they need and publishes it to a feed. Any eligible
stylist in the area can bid. Good for price discovery and for filling last-minute needs.

Broadcast bidding is **sealed**: competing stylists cannot see each other's prices. Only the client
who owns the request sees all the bids, sorted cheapest first. This prevents a race to the bottom
while still giving the client genuine choice.

## 3. Roles

Four roles exist, fixed at registration. There is no dual-role account.

| Role | Who | Capabilities |
|---|---|---|
| **`client`** | The customer | Create/edit/close/reactivate requests, compare and accept offers, pay, chat, check in, confirm completion, cancel, file no-shows and disputes, review, hold coupons, subscribe |
| **`stylist`** | The professional | Maintain a profile and availability, see the broadcast feed, send/withdraw offers, chat, check in, confirm completion, cancel, file no-shows, review, manage payout details, subscribe |
| **`admin`** | Platform staff | Everything operational: verifications, disputes, no-show arbitration, suspensions and restrictions, session revocation, review moderation, payout batches, ledger and reconciliation, audit logs, moderation review, blocked domains |
| **`operator`** | Limited staff | Verification review only — three routes. Deliberately cannot touch money, bookings, or accounts |

---

# PART II — THE COMPLETE LIFECYCLE

## 4. Onboarding and verification

1. Register with email and password, or Google Sign-In (the ID token is verified server-side).
2. Verify email by OTP — six digits, 10-minute expiry, locked after 5 failed attempts.
3. Upload identity documents.
   - **Clients:** national ID front, national ID back, selfie with ID (3 documents)
   - **Stylists:** the same three **plus a police clearance certificate** (4 documents)
4. An admin or operator approves or rejects.

**Verification is a hard gate, not a nicety.** An unverified client cannot create a request; an
unverified stylist cannot send an offer. Both are blocked in the service layer.

Stylists additionally complete a profile — specialty, bio, services, hourly rate (**minimum 100
EGP**), languages, working areas, weekly availability, portfolio, and payout account.

## 5. Request lifecycle

```
                    ┌──────── reactivate ─────────┐
                    ▼                             │
   [create] ──► OPEN ── 48h with zero offers ──► PAUSED
                 │ │                              │
                 │ └─ client closes ─► CLOSED ◄───┘
                 │
                 ├─ an offer is accepted ─► FULFILLED   (terminal)
                 ├─ client cancels ───────► CANCELLED   (terminal)
                 └─ stylist declines ─────► DECLINED    (terminal, direct requests only)
```

**Key rules:**

- **There is no "offered" state.** Whether a request has bids is a *count* (`offerCount`), not a
  status. This matters: encoding it as a status previously removed a broadcast request from every
  other stylist's feed the moment the first bid arrived, silently defeating competitive bidding.
- **48 hours with zero offers → PAUSED, not expired.** The client can reactivate it. A request that
  has received even one offer never auto-pauses.
- **Editing is frozen once the first offer arrives** (`firstOfferAt`). Stylists priced their bids
  against the description; letting it change afterwards would invalidate their bids.
- **Requests consume a daily quota**, refunded if the client cancels within 15 minutes with zero
  offers received — so a typo does not cost a Free client their only request of the day.

## 6. Offer lifecycle

```
   [create] ──► PENDING ─┬─ client accepts ──────► ACCEPTED   (terminal)
                         ├─ client rejects it ───► REJECTED   (terminal)
                         ├─ stylist withdraws ───► WITHDRAWN  (terminal)
                         ├─ a sibling wins ──────► CLOSED     (terminal)
                         ├─ request closed ──────► CLOSED     (terminal)
                         └─ 30-day long-stop ────► EXPIRED    (terminal)
```

**`CLOSED` and `REJECTED` are deliberately different.** *Someone else won* is not the same signal as
*this client looked at your bid and said no* — the distinction matters on a stylist's dashboard and
for any acceptance-rate metric.

**Offer limits — the confirmed rule.** A stylist's outstanding bids are bounded two ways at once:

| Bound | Value | Enforced by |
|---|---|---|
| Total active offers | Subscription entitlement — **Free 3**, Basic 6, Pro 10, Enterprise 20 | Live `countDocuments` of `PENDING` offers, checked before creation |
| Per request | **1 active offer**, always, on every tier | Partial unique index on `{requestId, stylistId}` over `PENDING`/`ACCEPTED` |

"Active" means `PENDING` or `ACCEPTED`. Once an offer is `REJECTED`, `CLOSED`, `WITHDRAWN` or
`EXPIRED` it stops counting, the slot is returned, and the stylist may bid on that request again.

**A stylist may bid to the same client repeatedly — provided each offer is on a different request.**
Three active offers to one client across three requests is allowed; two active offers on a single
request is not.

The per-request cap is enforced by a database index rather than by a service check alone. A service
check reads then writes, and two concurrent requests can both pass through that window; the unique
index closes it. Proven by a concurrency test that fails when the index is removed.

## 7. Booking, payment and completion

1. **Accept an offer → a booking is created.** This is one atomic transaction: booking, schedule
   block, and pending payment record are written together, the winning offer becomes `ACCEPTED`,
   losing offers become `CLOSED`, and the request becomes `FULFILLED`.
2. **The client pays.** Money is held in escrow. The chat room, created closed at booking time,
   unlocks on successful payment. A coupon may be applied here.
3. **Check-in.** Either party checks in at the meeting location, optionally with GPS coordinates.
   Check-in is gated on payment being complete.
4. **Both parties confirm completion.** One-sided confirmation never completes a booking.
5. **A 48-hour dispute window opens**, anchored on `completedAt`.
6. **After the window, the stylist's earnings become payout-eligible** — eligible, not automatically
   transferred. Disbursement is a deliberate admin action.

```
CONFIRMED ──► IN_PROGRESS ──► COMPLETED ──► (48h hold) ──► payout-eligible
    │                              │
    │                              └──► DISPUTED ──► COMPLETED | CANCELLED
    ├──► CANCELLED
    ├──► NO_SHOW_STYLIST
    └──► NO_SHOW_CLIENT
```

---

# PART III — MONEY

## 8. Commission and escrow

- Platform commission: **15%** by default (`PLATFORM_FEE_PERCENTAGE`).
- All money is **decimal EGP to 2 places**, using a shared `round2()` helper. Conversion to piastres
  happens only at two boundaries: inside the Paymob provider, and inside the financial ledger.
- Escrow holds from the moment `Payment.status === 'paid'`. Check-in and chat both gate on that flag.
- Payouts are **manual admin batches**, never automatic.

## 9. Cancellation and no-show policy

The backend always computes these. The frontend never calculates a refund.

| Event | Client refund | Platform | Stylist | Stylist penalty | Coupon |
|---|---|---|---|---|---|
| Client cancels **≥ 24h** before | 97% | 3% | — | — | — |
| Client cancels **< 24h** before | 80% | 20% | — | — | — |
| Stylist cancels **≥ 24h** before | 100% | — | — | **3%** | — |
| Stylist cancels **< 24h** before | 100% | — | — | **20%** | 10% |
| **Stylist no-show** | 100% | — | — | **10%** | 10% |
| **Client no-show** | 60% | 20% | 20% | — | — |

**The 24-hour boundary:** exactly 24h00m falls in the client-favourable tier.

**Two design decisions worth explaining to a buyer:**

*The platform never earns more from a no-show than from a cancellation.* Its share is 20% in both
cases. Otherwise Murafiq would be financially better off when a booking is ghosted than when it is
cancelled properly — an incentive against good user experience.

*Stylist penalties are debts, not deductions from the client's price.* Murafiq holds no stylist
payment instrument, and the client is being refunded in full, so there is nothing to deduct from.
Instead the penalty accrues to the stylist's account and is netted against their next payout batch.
A batch can never go negative; residual debt carries forward.

## 10. No-show handling

A no-show is not a self-service refund button — that would be a fraud primitive. It is gated:

1. Cannot be filed until **30 minutes after** the scheduled start.
2. The reporter must have **checked in themselves** — the only evidence the platform holds that the
   accuser actually attended.
3. The accused gets a **2-hour response window** and is notified.
4. **Not contested** → settles automatically. **Contested** → escalates to admin arbitration.
5. Silence past the window → auto-resolves in the reporter's favour, via a background sweep.

## 11. The financial ledger

Every movement of money is recorded in an **append-only, immutable ledger**. Records cannot be
edited or deleted; corrections are new `ADJUSTMENT` entries linked by `correlationId`.

Entry types: `PAYMENT`, `ESCROW_HOLD`, `ESCROW_RELEASE`, `REFUND`, `PLATFORM_FEE`,
`PENALTY_ASSESSMENT`, `PENALTY_SETTLEMENT`, `PAYOUT_DISBURSEMENT`, `SUBSCRIPTION_PAYMENT`,
`COUPON_DISCOUNT`, `ADJUSTMENT`.

Amounts are stored as **integer piastres**. This is deliberate and differs from the rest of the
codebase: `round2()` protects individual calculations, but a ledger exists to be *summed* across
thousands of rows, and repeated float addition is exactly where drift appears.

**Idempotency:** every entry carries a deterministic key with a unique index. A duplicate webhook,
a retried refund, or a double-clicked admin action returns the existing entry instead of creating a
second one. This is the single mechanism protecting against duplicate refunds.

**Reconciliation:** a nightly job asserts debits equal credits per booking and alerts on any delta.

## 12. Coupons

Issued automatically as compensation (stylist no-show, late stylist cancellation) or manually by an
admin for promotions.

Defaults: **10% discount, capped at 150 EGP, 14-day expiry, single-use, one per booking, not
stackable, no minimum booking value.**

The cap matters: 10% uncapped means a 5,000 EGP booking generates a 500 EGP coupon, so platform
exposure would scale with the *most valuable* bookings — backwards for an automatically-issued
credit.

Value is a **percentage resolved at redemption**, not a fixed amount fixed at issuance. Applied at
payment initialization; the discount is always recomputed server-side from the stored percentage and
the booking's own price. **The platform absorbs the discount, not the stylist** — the stylist's
agreed price is untouched, because a marketing or compensation cost is not theirs to bear.

## 13. Payouts

Stylists register a payout account (bank transfer, Vodafone Cash, or InstaPay). An admin views
pending balances, generates a batch, marks it processing, then paid or failed. Failed batches release
their bookings for re-batching.

Guards: bookings are locked to a batch on creation; outstanding penalties are netted at batch time
with ledger settlement entries; a booking already in a payout cannot be refunded without manual
reconciliation; and **frozen bookings are excluded from eligibility** even though they keep
`completed` status.

---

# PART IV — SUBSCRIPTIONS

## 14. Plans and entitlements

Prices are charged in **EGP**; the USD figures are marketing labels. Yearly plans are a single
up-front charge (12× monthly).

**Client plans**

| Plan | Monthly | Yearly | Requests/day | Active requests | AI msgs/day* | Wardrobe photos* |
|---|---|---|---|---|---|---|
| Free | $0 | — | 1 | 1 | 3 | 7 |
| Basic | $1 | $12 | 2 | 2 | 10 | 25 |
| Mid | $3 | $35 | 3 | 3 | 35 | 45 |
| Pro | $5 | $58 | 4 | 4 | 80 | 100 |
| Enterprise | $10 | $115 | 5 | 5 | 150 | 250 |

**Stylist plans**

| Plan | Monthly | Yearly | Offers/day | Max active offers | Feed priority |
|---|---|---|---|---|---|
| Free | $0 | — | 3 | 3 | no |
| Basic | $1 | $12 | 6 | 6 | — |
| Pro | $2.50 | $30 | 10 | 10 | — |
| Enterprise | $5 | $60 | 20 | 20 | yes |

\* AI messages and wardrobe photos are **defined but not yet enforced** — the modules that would
consume them arrive in Phases 15 and 14. This is deliberate, not an oversight.

## 15. How entitlements work

Four cleanly separated concepts:

- **Plan** — what a plan provides (catalogue config).
- **Subscription** — what this user bought, and until when. Every user has one, including free users.
- **Usage counters** — daily quotas. Keyed by `{subject, metric, Cairo-date}` with a TTL index, so
  **reset is implicit** — a new day is simply a new document. No reset job exists or is needed.
- **Persistent capacity** — active requests, active offers, wardrobe photos. Computed live with
  `countDocuments`, never stored as a counter, because counters drift the moment a status changes
  outside the increment path.

**One decision point.** Nothing outside the subscriptions module reads a plan or a subscription;
every quota question goes through `entitlementService`. There is no `if (user.plan === 'PRO')`
anywhere in the codebase.

**Quota consumption is atomic** — a conditional upsert that turns a race into a caught duplicate-key
error translated to `429`, with no read-then-write window.

**Upgrades apply immediately. Downgrades take effect at the end of the paid period** — the user paid
for the higher tier through that date. A queued downgrade is superseded if they upgrade instead.

**Over-capacity after a downgrade is grandfathered**, never auto-deleted. A user with 12 wardrobe
photos on a 7-photo plan keeps all 12 and simply cannot add more.

---

# PART V — SAFETY, TRUST & SECURITY

## 16. Chat and content moderation

Chat runs on **Firestore**, one conversation per booking, created closed and unlocked by payment,
locked when the booking ends. Realtime delivery is client-side Firestore listeners; there is no
Socket.IO in this system.

Every message, offer message, request description, and review comment is scanned. The pipeline is
**entirely local — no third-party AI service, no per-message cost, no user content leaving the
platform**:

1. **Normalisation** — Unicode folding, homoglyph folding, leet-speak, zero-width character
   stripping, Arabic-Indic digit conversion, separator collapsing. This is what defeats
   `0 1 0 - 1 2 3` and `name at gmail dot com`.
2. **Contact detection** — Egyptian mobile patterns, emails, social handles, spelled-out digits.
3. **Blocked domains** — an admin-editable denylist.
4. **Curated word lists** — bilingual Arabic/English.

**Enforcement is a 3-strike ladder within a 30-day window:** warn → chat-restrict → suspend. Strikes
2 and 3 both revoke live sessions immediately.

**What this deliberately does *not* do:** no word match ever moves money by itself. Attaching a
refund to a regex is a fraud vector — a malicious user could bait the other party into a flagged word
and self-serve a refund.

**Coverage gap, stated honestly:** deterministic rules are strong on contact details and blocked
domains, weaker on threats, insults, and harassment, which depend on phrasing rather than vocabulary.
That gap is covered by a **"Report message"** action that files into an admin review queue. A report
never enforces on its own — one user's accusation must not automatically restrict another.

## 17. Authentication and session security

### Multi-device sessions

Every signed-in device holds its own session. A user can be on Chrome, an iPhone and an Android
simultaneously, and signing out on one leaves the others untouched.

```
Access token   { sub, role, tv }        short-lived, config-driven (15m default)
Refresh token  { sub, sid, jti }        long-lived, config-driven (30d default)
                     │
                     └── sid → one entry in User.sessions[]
                             { tokenHash, deviceLabel, createdAt, lastUsedAt, expiresAt }
```

- **Refresh tokens are stored as SHA-256 hashes, never in plaintext**, and never returned by any
  endpoint. SHA-256 rather than bcrypt is deliberate: these are high-entropy signed JWTs, not
  user-chosen passwords, so slow salted hashing buys nothing — and a salted hash cannot be matched by
  equality in a query filter, which is what makes the atomic rotation below possible.
- **Rotation is a single atomic update.** Refreshing swaps the stored hash in one
  `findOneAndUpdate` that matches both the session id and the presented token's hash. Two concurrent
  refreshes with the same token cannot both succeed — no lock, no transaction.
- **Reuse detection, scoped to the affected session.** If a token verifies but is no longer the live
  one for its session, it was already rotated away — possible theft of that session. **That one
  session is revoked**; other devices are untouched and `tokenVersion` is deliberately not bumped.
  Revoking everything would let a single mis-timed client retry sign the user out across every
  device, which is a self-inflicted outage on the far more common benign cause. A security event is
  emitted either way.
- **Session cap** (`MAX_SESSIONS_PER_USER`, default 10) evicts the oldest device, so credentials
  cannot accumulate indefinitely.

### The two revocation axes

These answer different questions and produce different HTTP codes:

| | Question | Response |
|---|---|---|
| **`accountStatus`** | May this account use the platform? | **403** — re-authenticating will not help |
| **`tokenVersion`** | Are previously issued credentials still valid? | **401** — refresh or sign in again |

`tokenVersion` is stamped into every access token and checked on each request through a 30-second
in-process cache, invalidated immediately whenever it is bumped.

| Action | Sessions | `tokenVersion` | Effect on other devices |
|---|---|---|---|
| Logout (current device) | that one removed | unchanged | still signed in |
| Logout all | all cleared | bumped | signed out immediately |
| Password change / reset | all cleared | bumped | signed out immediately |
| Suspend / block / restrict | all cleared | bumped | signed out immediately |
| Admin revoke sessions | all cleared | bumped | signed out immediately |
| Refresh-token reuse detected | **only the affected one** | **unchanged** | unaffected |

Password events bump `tokenVersion` deliberately: a password reset is the "my account is
compromised" flow, so an attacker's outstanding access token must die at once rather than surviving
the remainder of its window.

### Client transports

| | Web (default) | Mobile (`X-Client-Type: mobile`) |
|---|---|---|
| Delivery | httpOnly, `secure` in production, `sameSite: strict` cookies | tokens in the response body |
| Authenticated calls | cookies sent automatically | `Authorization: Bearer <token>` |

`sameSite: strict` plus httpOnly gives an adequate CSRF posture without a separate token, and keeps
the refresh token out of reach of JavaScript.

### Other protections

- Login errors are generic for wrong-password and unknown-email, preventing user enumeration.
- Google Sign-In re-checks account status, so it cannot bypass a suspension or block.
- The refresh endpoint re-checks account status — otherwise it would be an open door back in for a
  suspended user.
- Rate limiting: 5 requests / 5 minutes on auth, 1 / minute on OTP resend. OTP locks after 5 failures.
- Zod validators use `.strict()` throughout, rejecting unknown fields as a mass-assignment guard.
- Soft delete only for users — email and phone stay permanently reserved and are never freed.

## 18. Reviews and reliability

Reviews are **two-way and independent**: `client_to_stylist` and `stylist_to_client`, each unique per
booking at the database index level, so one side's duplicate attempt never blocks the other.
Direction is inferred from the caller's role, never accepted as input. Only `completed` bookings can
be reviewed. Rating aggregates are recalculated from source on every change, never incrementally
averaged, to avoid float drift.

**Reliability is separate from rating.** A stylist's reliability score reflects completed sessions,
cancellations, late cancellations, and no-shows — behaviour a star rating does not capture, because a
stylist who does great work but cancels often has a high rating and is still a bad bet.

## 19. Admin capabilities

Verification queue · dispute arbitration · no-show arbitration · user suspend/reactivate ·
chat restriction · session revocation · review hide/unhide · moderation event review and
confirm/overturn · strike forgiveness · blocked-domain management · payout batches ·
ledger statements and reconciliation · audit-log search · dashboard statistics.

**Audit logging is event-bus-driven only** — a single listener maps domain events to log entries.
Every money-affecting or account-affecting event is recorded: cancellations with their refund tier
and penalty, no-show reports and resolutions, payments, refunds, payouts, disputes, subscription
changes, suspensions, and admin chat access.

---

# PART VI — SYSTEM BEHAVIOUR

## 20. Notifications

In-app notifications backed by MongoDB, plus push via Firebase Cloud Messaging. Typed:
`request`, `offer`, `booking`, `payment`, `message`, `reminder`, `review`, `verification`,
`dispute`, `safety`, `payout`, `system`.

Fanout for broadcast requests is geographically prioritised — city first, then governorate.

One notification is load-bearing rather than cosmetic: the **no-show report notice**. Silence
auto-resolves the report against the accused, so a party who is never told would lose by default.

## 21. Background jobs

Seven scheduled sweeps, all in-process `node-cron`, each registered idempotently and skipped in
tests:

| Job | Cadence | Purpose |
|---|---|---|
| Offer expiry | hourly | 30-day long-stop on abandoned offers |
| Request auto-pause | 10 min | The 48-hour zero-offer rule |
| No-show resolution | 15 min | Auto-resolve unanswered reports; expire coupons |
| Subscription renewal | daily | Apply scheduled downgrades; expire lapsed plans to Free |
| Ledger reconciliation | daily | Assert debits equal credits; alert on any delta |
| OTP cleanup | periodic | Purge expired verification codes |
| Session reminders | periodic | Remind both parties of upcoming appointments |

**These require a single process.** `ecosystem.config.cjs` pins `instances: 1, exec_mode: 'fork'` —
a correctness constraint, not a performance default. Cluster mode would run every sweep once per
instance.

## 22. External integrations

| Service | Use | Status |
|---|---|---|
| **MongoDB** (replica set) | Primary datastore; replica set required for transactions | Active, mandatory |
| **Firebase Firestore** | Chat storage and realtime delivery | Active |
| **Firebase Cloud Messaging** | Push notifications | Active |
| **Cloudinary** | Image storage; Sharp compresses in-memory before upload | Active |
| **Paymob** | Payment processing | Integrated; a mock provider is used only under `NODE_ENV=test` |
| **Resend** | Transactional email | Active (SendGrid exists as a deliberate stub) |
| **Google OAuth** | Sign-In | Active |

Payments and mail both sit behind a **provider interface**, so switching vendors is a configuration
change rather than a rewrite.

## 23. Architecture

A **modular monolith** — deliberately not microservices.

```
Route → Validator (Zod, strict) → Controller → Service → Repository → Model
```

23 modules, 21 data models, ~115 REST endpoints under `/api/v1`, documented in Swagger.

Rules that hold throughout: modules call other modules' *services*, never their models (two
documented exceptions); the core write of any operation happens directly inside one transaction while
domain events handle only what follows (notifications, audit); every list endpoint goes through a
shared QueryBuilder; and every response goes through a shared response/error envelope.

**Concurrency** is handled with compare-and-swap updates, unique indexes as defence in depth, and
MongoDB transactions — no distributed lock anywhere. Offer acceptance in particular uses a CAS lock
on the request, three unique indexes, and a bounded retry envelope that distinguishes genuine
business conflicts from retryable MongoDB write conflicts.

---

# PART VII — STATUS AND ROADMAP

## 23b. The API surface

**126 REST operations** under `/api/v1`, all documented.

| | |
|---|---|
| Interactive docs | `/api/docs` — Swagger UI |
| Machine-readable | `/api/docs.json` — OpenAPI 3.0, importable into API Dog, Postman or Insomnia |
| Production access | Both are `admin`-only in production; public in development |
| Auth documented as | `bearerAuth` (mobile) and `cookieAuth` (web) security schemes |

`npm run validate:openapi` diffs the generated document against the Express router and fails the
build on any drift. At the time of writing: **126 documented = 126 actual**, zero endpoints missing
from the document, zero documented endpoints that do not exist, zero broken `$ref`s.

This matters commercially as much as technically: an API document that promises endpoints which do
not exist wastes an integrator's time and destroys confidence in everything else it says.

## 24. Implemented — Phases 0–13 (plus the Business Rules Revision R0–R12)

| Phase | Delivers |
|---|---|
| 0 | Infrastructure, config, logging, Swagger, error handling |
| 1 | Authentication, OTP, Google Sign-In, token rotation and revocation |
| 2 | User profiles, locations, KYC verification |
| 3 | Stylist profiles, geo search, availability |
| 4 | Requests and offers, direct and broadcast, sealed-bid feed |
| 5 | Bookings, scheduling, double-booking prevention, check-in, completion |
| 6 | Payments, escrow, refunds, Paymob integration |
| 7 | Chat (Firestore) and notifications (Mongo + FCM) |
| 8 | Two-way reviews and rating aggregation |
| 9 | Uploads (Cloudinary + Sharp) and transactional mail |
| 10 | Audit log, admin controls, dispute arbitration |
| 11 | Payouts, batch disbursement, penalty netting |
| 12 | Seven background sweeps |
| 13 | Security hardening, production Swagger protection, OTP lockout |
| **R0–R12** | Subscriptions and entitlements, financial ledger, request/offer lifecycle rework, cancellation and no-show policy, coupons, penalties, reliability, moderation |

## 25. Upcoming — not built

**Phase 14 — Wardrobe & Async Job Queue.** Wardrobe CRUD, image classification, and the introduction
of Redis + BullMQ. The `wardrobe.photos.max` entitlement already exists and awaits enforcement here.

**Phase 15 — AI Styling & Embedding Engine.** Embeddings, vector search, outfit recommendations. The
`ai.messages.daily` entitlement already exists and awaits enforcement here.

**Phase 16 — Production Deployment.** VPS, PM2 or Docker, Nginx, SSL/TLS, production migration,
staging environment. A single-VPS/PM2 path is decided but not executed.

## 26. Deferred — decided, not scheduled

- **External AI moderation.** `MODERATION_PROVIDER=none`. Analysed in
  `docs/REVISION_MODERATION_CLASSIFIER_GATE.md`; the blocker is Egyptian PDPL cross-border transfer,
  not cost.
- **Automatic CRITICAL-word enforcement.** No word match will move money without a human. The
  3-strike ladder plus human reports is the shipped design.
- **Wallet, favourites, loyalty, referrals, video calls.** Genuinely absent, not stubbed.

## 27. Known limitations and assumptions

1. **MongoDB must be a replica set** in every environment — offer acceptance, cancellation and
   payouts depend on multi-document transactions.
2. **Single application instance.** The seven cron sweeps are in-process with no distributed lock;
   `ecosystem.config.cjs` pins `instances: 1, exec_mode: 'fork'` as a correctness constraint. Phase
   14's queue migration is what lifts this.
3. **Business day is Africa/Cairo, platform-wide.** Per-user timezones would let someone harvest two
   daily quotas by changing a device setting.
4. **Payouts are manual.** No automated bank disbursement integration exists; an admin batches and
   confirms each transfer.
5. **Firestore rules are not deployed by this repository** — there is no `firebase.json` here, so
   `firestore.rules` is source only and must be deployed separately.
6. **The mobile client must send chat messages via `POST /chat/{id}/messages`**, never by writing to
   Firestore directly, or moderation is bypassed entirely. Firestore is the realtime *read* path.
7. **Run `scripts/backfill-revision-foundation.js` before deploying to any database holding
   pre-Revision data.** The enums were narrowed, so old rows carry statuses that now fail validation.
   A fresh database does not need it. The script is idempotent and guards its own completeness.
8. **Existing users are signed out once** on the release that introduces `sessions[]`, because no
   prior session rows exist. No migration is required — they simply log in again.
9. **Refresh-token reuse detection cannot distinguish theft from a client retry.** Revocation is
   scoped to the affected session, so the blast radius is one device rather than all of them — but
   mobile clients must still use a **single-flight refresh** (one shared in-flight request, others
   queued behind it) or a burst of simultaneous 401s will sign that device out.
10. **USD plan prices are display labels.** The USD→EGP rate is a constant and should become
    admin-editable.
11. **Threats and harassment rely on human reports**, by design — deterministic word lists cannot
    judge phrasing, and no external classifier is enabled.

## Appendix — Phase 14–16 compatibility notes

Assessed against the current implementation; none are blocking today.

| Area | Assessment |
|---|---|
| **Redis/BullMQ vs cron** | ⚠️ The seven sweeps depend on `instances: 1`. Introducing BullMQ naturally invites horizontal scaling, at which point every sweep would fire once per instance. Migrate the sweeps to BullMQ repeatable jobs (which dedupe by job ID) *in the same phase*, or keep one dedicated scheduler process. |
| **Storage for wardrobe** | ✅ Ready. Cloudinary uploads already allow a `wardrobe` folder, with in-memory Sharp compression and no disk writes. |
| **Models extensible for embeddings** | ✅ No conflict. Mongoose is schemaless enough to add an `embeddingId` reference; no existing model constrains it. |
| **Env structure** | ⚠️ Mostly ready. `OPENAI_API_KEY`, `VECTOR_DB_URL`, `VECTOR_DB_API_KEY` are already reserved. **No `REDIS_URL` exists yet** — Phase 14 must add it. |
| **Hard-delete requirement for wardrobe** | ⚠️ Users are soft-deleted by a global query hook. Wardrobe items must be *hard*-deleted along with their vector entry, or orphaned vectors leak silently. Do not reuse the user soft-delete pattern. |
| **Cross-user vector leakage** | ⚠️ Phase 15 must filter vector search by `userId`. This is a silent privacy bug if missed — verify the filter is applied, not merely present in a schema. |
| **AI tool isolation** | ✅ The service layer is clean enough that AI tools can call existing services rather than models or the vector SDK directly. |
| **Deployment config** | ✅ `ecosystem.config.cjs` exists with the correctness constraint documented in-file. Nginx, SSL, and staging remain Phase 16 work. |
