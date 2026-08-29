# Hardening 1 — Production Blockers (P0)

## Goal

Fix the six defects that make the current backend unsafe or non-functional to deploy. Every item here
is either **remotely exploitable**, **broken on every request**, or **makes the product unusable on a
fresh install**. Nothing in this document is a refactor or an improvement — it is all repair.

None of these are new features. They are corrections to code already written in Phases 1–8.

> [!WARNING]
> **`docs/` is currently in `.gitignore`** (along with `AGENTS.md`). This file is therefore untracked
> and will not survive a fresh clone. Before working through it, remove `docs/` and `AGENTS.md` from
> `.gitignore` and commit the folder — the planning system has no version history right now, and the
> only other copy of the spec is an untracked `docs.rar` in the repo root.

## Depends on

Phases 1, 4, 5, 6 (auth, offers, bookings, payments) — all already built. This document only modifies
existing files; it creates one new script and two new indexes.

## How to use this document

Follow `02_PROJECT_RULES.md`: one step at a time, present **What / Why this solution not another / How**,
wait for explicit approval before writing any file. Steps are ordered by dependency — **do not reorder**.
Step 1 must land before Step 4 of `HARDENING_02_CORRECTNESS.md`, because the refund ledger is worthless
while forged webhooks can still write to it.

Recommended prompt to start a session:

```
Read docs/HARDENING_01_CRITICAL.md fully.
Implement its "Steps" section in order, following docs/02_PROJECT_RULES.md
(present What/Why/How per step, wait for my approval before writing anything).
When done, verify every item in "Definition of Done" and report pass/fail with evidence.
```

---

## Steps

### 1. Close the unauthenticated payment-forgery hole

**The defect.** `POST /api/v1/payments/callback` (`src/modules/payments/payment.routes.js:16`) has no
auth middleware and no signature check at the route layer. With the default `PAYMENT_PROVIDER=mock`
(`src/config/env.config.js:31`), `MockProvider.handleCallback`
(`src/modules/payments/providers/mock.provider.js:33`) **unconditionally returns `success: true`** using
whatever `bookingId` the caller supplied. `paymentService.handleWebhook` then marks the payment `PAID`,
emits `PAYMENT_SUCCEEDED`, opens the chat room, and satisfies the check-in payment gate.

```
curl -X POST http://localhost:4000/api/v1/payments/callback \
  -H 'Content-Type: application/json' \
  -d '{"bookingId":"<any real booking id>"}'
```

…yields a free styling session. On Paymob the hole is narrower but still open:
`src/modules/payments/providers/paymob.provider.js:145` reads
`if (!isAuthentic && env.NODE_ENV === 'production') throw` — so **every non-production environment
accepts forged webhooks**.

**Changes.**

1. **Fail closed in the Paymob provider.** In `paymob.provider.js:145`, drop the
   `&& env.NODE_ENV === 'production'` condition. An invalid HMAC must throw in every environment.

2. **Capture the raw body.** HMAC over a re-serialized parsed body is fragile (key ordering, numeric
   coercion). In `src/app.js`, give the JSON parser a `verify` hook that stashes the raw buffer:
   ```js
   app.use(express.json({
     limit: '10kb',
     verify: (req, _res, buf) => { req.rawBody = buf; },
   }));
   ```

3. **Neuter the mock provider as a callback source.** `mock.provider.js#handleCallback` must refuse to
   report success unless *both*: `NODE_ENV !== 'production'`, and the request carried a shared dev
   secret. Add `MOCK_WEBHOOK_SECRET` to the env schema (dev-default via the existing `secret()` helper,
   required in prod only if `PAYMENT_PROVIDER=mock`, which Step 1.4 forbids anyway). Compare with
   `crypto.timingSafeEqual`.

4. **Guard provider selection at boot.** In `payment.service.js#getProvider`, throw if
   `env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'mock'`. A production deploy that
   forgets to flip `PAYMENT_PROVIDER` must fail loudly, not silently accept free bookings.

5. **Rate-limit the callback route.** It is public and unauthenticated; attach a dedicated limiter
   (reuse the pattern in `src/common/middlewares/auth-rate-limiter.middleware.js`).

6. **Fix the test that asserts the vulnerability.** `tests/integration/payments.test.js:111`
   (`'successfully processes payment webhook and marks payment as paid'`) currently posts an
   unauthenticated body with no signature and asserts `status === 'paid'`. It is a regression test
   *for the bug*. Rewrite it as two cases: unsigned request → rejected; correctly signed request →
   accepted.

> **Why not just add `authMiddleware` to the route?** Payment providers are not logged-in users and
> carry no JWT. Webhook authenticity has to come from a provider signature, which is why the fix is
> HMAC-based rather than session-based.

---

### 2. Fix `POST /auth/refresh-token` — 500s on every call

**The defect.** `authService.refreshTokens` (`src/modules/auth/auth.service.js:186`) ends with
`return issueTokensFor(user);`, which resolves to `{ accessToken, refreshToken }`. The controller
(`src/modules/auth/auth.controller.js:60`) destructures a `user` that was never returned:

```js
const { user, accessToken, refreshToken: newRefreshToken } = await authService.refreshTokens(...);
```

`user` is `undefined`, so `respondWithTokens` → `toPublicUser(undefined)` → `TypeError: Cannot read
properties of undefined (reading '_id')` → 500. Confirmed by execution.

Access tokens live 15 minutes (`src/common/utils/generateTokens.js:5`), so **every session in the app
breaks 15 minutes after login** and cannot recover. No test covers this endpoint.

**Changes.**

1. `auth.service.js:186` → `return { user, ...(await issueTokensFor(user)) };`
2. Add integration coverage for the refresh flow — login, refresh, assert 200 with a user object and a
   rotated refresh token. This endpoint currently has **zero** tests, which is why the bug shipped.

---

### 3. Remove the double-charging retry in offer acceptance

**The defect.** `src/modules/offers/offer.service.js:103–124`:

```js
} catch (err) {
  if (session) { try { await session.abortTransaction(); } catch (_) {} }
  if (err.statusCode) { throw err; }
  bookingDoc = await bookingService.createBookingFromOffer(offerId, null);   // ← re-runs everything
}
```

On any non-`ApiError` failure this **re-runs the entire booking creation with no session**.
`commitTransaction()` can throw *after* the commit has already succeeded (a lost network ack is the
textbook case), and the retry then creates a **second Booking, a second ScheduleBlock, and a second
Payment record** for one offer — the client is billed twice.

Worse: on a standalone (non-replica-set) MongoDB, `startTransaction` succeeds but `commitTransaction`
always throws `IllegalOperation`. So in the default local setup the non-transactional path is the
**only** path that ever executes, and the atomicity `01_PROJECT_STRUCTURE.md` principle 7 advertises
never applies at all.

**Changes.**

1. **Delete the fallback.** On transaction failure, abort and rethrow. A failed booking must fail, not
   silently retry without atomicity.
2. **Require a replica set for local dev.** Document in `PHASE_00_SETUP.md` how to run a single-node
   replica set (`mongod --replSet rs0` + `rs.initiate()`), so the transactional path is the one actually
   exercised in development and tests.
3. **Add an idempotency guard.** Inside `createBookingFromOffer`
   (`src/modules/bookings/booking.service.js:17`), re-read the offer **within the session** and reject
   if `offer.status !== 'pending'`. The current status check happens in `acceptOffer` *outside* the
   transaction, so two concurrent accepts both pass it.
4. Consider a unique index on `Booking.offerId` as a database-level backstop — one booking per offer is
   a true domain invariant and should not depend on application logic alone.

---

### 4. Stop the double-booking race

**The defect.** `createBookingFromOffer` calls `scheduleRepository.findOverlap(...)` and then
`scheduleRepository.create(...)` — a read-then-write with **no unique constraint** behind it.
`src/modules/bookings/schedule.model.js:16-17` declares only non-unique indexes:

```js
scheduleBlockSchema.index({ stylistId: 1, date: 1 });
scheduleBlockSchema.index({ bookingId: 1 });
```

Two clients accepting overlapping offers concurrently both pass `findOverlap` and both insert.
**A MongoDB transaction does not prevent this** — the two writes create different new documents, so
there is no write conflict for the server to detect. The stylist is physically double-booked and has
to no-show a paying client, which is the worst possible outcome for an in-person marketplace.

**Changes.**

1. Add a unique index — `{ stylistId: 1, date: 1, startMinute: 1 }` — to `schedule.model.js`.
2. In `booking.service.js`, catch the resulting duplicate-key error (`err.code === 11000`) and surface
   it as the existing `409 'This time slot is already booked for this stylist'`. Keep `findOverlap` as
   the fast path for the common case; the index is the correctness guarantee.
3. Write a concurrency test (needs a real database — see `HARDENING_02_CORRECTNESS.md` Step 5): fire N
   parallel accepts for overlapping slots, assert exactly one Booking and one ScheduleBlock exist.

> **Note.** A unique index on `startMinute` only catches *identical* start times, not partial overlaps
> (10:00–11:00 vs 10:30–11:30). Full overlap protection needs either a per-stylist-per-day lock
> document or slot discretisation. Decide which when implementing — the index closes the common case,
> and `findOverlap` inside the transaction narrows the rest.

---

### 5. Fix rate limiting behind a proxy

**The defect.** `src/app.js` never calls `app.set('trust proxy', ...)`. Both
`PHASE_16_DEPLOYMENT_READINESS.md` deployment options (Railway, Render) and the Nginx path put the app
behind a reverse proxy, where `req.ip` resolves to the **proxy's** address for every request.

`express-rate-limit` therefore keys every user into one bucket:
- Global limiter (`rate-limiter.middleware.js`, 100 req / 15 min) → **the app self-DoSes at 100 total
  requests per 15 minutes**, across all users.
- Auth limiter (`auth-rate-limiter.middleware.js`, 5 req / 5 min) → **the fifth login attempt by anyone
  locks out every user on the platform**.

**Changes.**

1. `app.js`: `app.set('trust proxy', 1)` — a single hop. Do **not** use `true`; trusting all hops lets a
   client spoof `X-Forwarded-For` and bypass rate limiting entirely.
2. Verify `req.ip` resolves to the real client address behind the chosen host, and that
   `express-rate-limit` no longer emits its `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` validation warning.
3. Revisit the global 100/15min budget once keying is correct — it was never meaningfully exercised.

---

### 6. Add an admin/operator bootstrap

**The defect.** There is **no way to create the first admin or operator account**. `registerSchema`
(`src/modules/auth/auth.validator.js:13`) correctly restricts self-registration to `client|stylist`,
and no seed script, CLI, or migration exists anywhere in the repo.

Every `/admin` route is therefore unreachable on a fresh deployment — including identity verification
approval, which **gates all user activity**: `requestService.createRequest` and `offerService.createOffer`
both reject users whose `verification.status !== 'verified'`. Without an admin, no user can ever be
verified, so no request and no offer can ever be created. **The product funnel terminates at signup for
100% of users.**

**Changes.**

1. Add `scripts/seed-admin.js` — idempotent (upsert by email), credentials read from env
   (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`), sets `role: 'admin'`, `isEmailVerified: true`,
   `verification.status: 'verified'`. Reuse `authRepository.createUser` and the existing bcrypt cost of
   12 — do not hand-roll hashing.
2. Add `"seed:admin": "node scripts/seed-admin.js"` to `package.json` scripts.
3. Refuse to run with a weak or defaulted password when `NODE_ENV === 'production'`.
4. Document it in `PHASE_00_SETUP.md` and in the deployment steps of `PHASE_16_DEPLOYMENT_READINESS.md`
   as a mandatory post-deploy action.

---

## Definition of Done

Verify each item and state **how** it was checked (test run, curl, `db.collection.getIndexes()`), per
`02_PROJECT_RULES.md`. Do not mark from memory of having written the code.

- [ ] `POST /api/v1/payments/callback` with no signature → rejected (4xx); the target payment remains `pending` in the database.
- [ ] `POST /api/v1/payments/callback` with a valid Paymob HMAC → accepted, payment `paid`, `PAYMENT_SUCCEEDED` emitted once.
- [ ] An invalid HMAC is rejected with `NODE_ENV=development`, not only in production.
- [ ] Booting with `NODE_ENV=production` and `PAYMENT_PROVIDER=mock` fails loudly instead of starting.
- [ ] `tests/integration/payments.test.js` no longer contains a passing test that asserts an unsigned webhook marks a payment paid.
- [ ] Login, then `POST /auth/refresh-token` → `200` with a populated `data.user` and a rotated refresh token. Covered by a new automated test.
- [ ] The old refresh token is rejected after rotation.
- [ ] `offer.service.js` contains no non-transactional retry path; a forced commit failure surfaces an error and leaves **zero** Booking, ScheduleBlock, and Payment documents behind.
- [ ] N parallel `PATCH /offers/:id/accept` calls on one offer produce exactly one Booking, one ScheduleBlock, and one Payment.
- [ ] `db.schedulingblocks.getIndexes()` shows a unique index on `{ stylistId, date, startMinute }`; a duplicate insert returns `409`, not `500`.
- [ ] Local dev runs against a single-node replica set and the transactional path is confirmed to execute (not the fallback).
- [ ] With `X-Forwarded-For` set to 150 distinct addresses through a proxy, no request is rate-limited by the global limiter; 6 rapid logins from **one** address are.
- [ ] `npm run seed:admin` on an empty database creates a working admin, and a full KYC approval can be completed end-to-end via `/api/v1/admin/verifications/:userId/approve`.
- [ ] Re-running `npm run seed:admin` does not create a duplicate or error.
- [ ] `npm run lint` and `npm test` both exit 0.
- [ ] `docs/` and `AGENTS.md` removed from `.gitignore` and committed.
