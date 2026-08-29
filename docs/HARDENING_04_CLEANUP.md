# Hardening 4 — Consistency, Dead Code & Performance (P2)

## Goal

Remove the accumulated inconsistencies that make the codebase harder to reason about than it needs to
be, and fix the performance patterns that will bite before the first thousand users. Nothing here is
urgent; everything here is cheap.

## Depends on

`HARDENING_01`–`03`. Deliberately last of the code documents — none of it is user-visible, and doing
it before the real fixes would just create merge noise.

---

## Steps

### 1. Fix the lint gate

**The defect.** `npm run lint` currently **fails** with 2 errors and 22 warnings:

```
src/modules/payments/providers/paymob.provider.js
   66:30  error  'fetch' is not defined  no-undef
  172:30  error  'fetch' is not defined  no-undef
```

`fetch` is a global in Node 18+; the ESLint config simply declares no Node/ES2022 globals. The 22
warnings are unused vars, mostly the deliberately-unimplemented interface parameters in
`payment-provider.interface.js` and unused test bindings.

The important part isn't the errors themselves — it's that **every phase from 0 to 8 was marked
"done" against a Definition of Done while the lint gate was red**, which means it was never run. Fix
the config and then wire it into CI so it can't silently rot again.

**Changes.**

1. In `eslint.config.js`, set `languageOptions.globals` to include Node globals (via the `globals`
   package, or explicitly). Confirm `fetch`, `process`, `console`, `crypto`, and the Jest globals in
   the test override are all recognized.
2. Prefix the interface's intentionally-unused parameters with `_` to match the configured
   `argsIgnorePattern`, or disable the rule for that one file with a comment explaining why.
3. Clean up genuinely unused test bindings (`stylistToken`, `adminToken`, `userId`, `jest`, `getProvider`,
   `MockProvider`, `userRepository` across `tests/`).
4. Add a CI workflow running `npm run lint` and `npm test` on push and PR. Without this, nothing above
   stays fixed.

---

### 2. Delete dead code

Verified unreferenced — each confirmed with a repo-wide grep:

| Item | Location | Why it's dead |
|---|---|---|
| `redis.config.js` | `src/config/` | Imported by **nothing**. Exports `{ url }`. Redis/BullMQ aren't installed. |
| `cloudinary.config.js` | `src/config/` | Imported by **nothing** (until `HARDENING_03` Step 1 wires it up — **keep it, use it**). |
| Empty Socket.io bootstrap | `src/sockets/index.js` | Body is a comment: "Socket events will be wired in Phase 7." Phase 7 shipped chat on **Firebase instead**. Yet `server.js:12-15` still constructs a Socket.io server on every boot. |
| `serviceType`, `scheduledStartTime` | `payment.repository.js:52` | Selected in a `populate()` on Booking. **Neither field exists** on `booking.model.js` — the real field is `scheduledStartMinute`. Silently returns nothing. |

**Changes.**

1. Delete `redis.config.js`. Re-add it in the phase that actually installs BullMQ.
2. Decide on Socket.io: `01_PROJECT_STRUCTURE.md` §2 still says notifications use it, but
   `notification.service.js` dispatches via **FCM**, and `sockets/index.js` registers no handlers.
   Either implement the notification socket namespace (`01_PROJECT_STRUCTURE.md` §4 specifies
   `notifications/sockets/notification.socket.js`) or **remove Socket.io entirely** and stop booting it.
   Right now it's a running server with zero handlers. Raise as a decision.
3. Fix the `populate` field list in `payment.repository.js:52` to real field names.
4. Note: `PARTIAL_PLATFORM_FEE_PERCENTAGE` was also dead — `HARDENING_02` Step 4 puts it to use. Don't
   delete it here.

---

### 3. Unify logging and event-listener registration

**The defect.** Two competing patterns for the same job:

- **Logging.** `src/modules/stylists/stylist.service.js:118` uses `console.error(...)` inside an event
  handler; every other module uses the Winston logger. `console` output doesn't reach
  `logs/error.log`, so that failure is invisible in production.
- **Listener registration.** `notification.listener.js` uses a class with an idempotent `register()`
  guarded by a `this.registered` flag, called explicitly from `app.js:21`. But `chat.service.js:13`
  and `review.service.js:11` register listeners **in their constructors** (module-level singletons,
  so registration is a side effect of importing), and `stylist.service.js:97` registers at
  **module top level**. Three patterns, one job. The constructor/top-level ones are also why
  `event-bus.js:6` needs `setMaxListeners(30)`.

**Changes.**

1. Replace the `console.error` with `logger.error`.
2. Pick one registration pattern — the explicit `register()` called from `app.js` is the right one,
   because it makes registration order visible and testable — and convert `chat.service.js`,
   `review.service.js`, and `stylist.service.js` to it.
3. Once registration is explicit and idempotent, reconsider whether `setMaxListeners(30)` is still
   masking a leak.

---

### 4. Make validator strictness consistent

**The defect.** `.strict()` is used in 5 of 11 module validators (`auth`, `bookings`, `offers`,
`requests`, `stylists`) and omitted in the other 6 (`admin`, `chat`, `notifications`, `payments`,
`reviews`, `users`).

Zod strips unknown keys by default, so this is **not** a mass-assignment vulnerability — extra fields
never reach the service layer. But the behavioural split is confusing: `PATCH /auth/change-password`
with a typo'd field returns `400`, while `PATCH /users/me` with a typo'd field returns **`200` having
silently changed nothing**. A client developer gets a success response for a request that did nothing.

**Changes.**

1. Add `.strict()` to the 6 validators missing it, so unknown fields are a `400` everywhere.
2. Record the convention in `02_PROJECT_RULES.md` under "Established conventions" so new modules
   inherit it.

---

### 5. Fix the health check and database connection config

**The defect.**

- `04_ROUTES.md` documents `GET /health` as "Health check (**Mongo + Redis** status)".
  `src/routes/index.js:33` checks Mongo only — and returns healthy unconditionally when
  `NODE_ENV === 'test'`, which makes the health test meaningless.
- `src/config/database.config.js` passes `options: {}` — **no `maxPoolSize`, no
  `serverSelectionTimeoutMS`, no timeouts of any kind.** Mongoose defaults are survivable, but for a
  deployment target that scales horizontally (Railway/Render), pool sizing should be deliberate and
  a slow/unreachable primary should fail fast rather than hang the request.

**Changes.**

1. Report per-dependency status in `/health`: Mongo, Firebase (per `HARDENING_03` Step 3), and Redis
   once it exists. Until Redis is installed, either report it as `not_configured` or remove the claim
   from `04_ROUTES.md` — don't leave the doc asserting a check that doesn't happen.
2. Drop the `NODE_ENV === 'test'` short-circuit; with `mongodb-memory-server` from `HARDENING_02`
   Step 9, the test environment has a real connection to report on.
3. Set explicit `maxPoolSize` and `serverSelectionTimeoutMS` in `database.config.js`.

---

### 6. Fix stylist search performance

**The defect.** `src/modules/stylists/stylist-search.service.js` — this is the **public,
unauthenticated** browse endpoint, i.e. the most-hit route in the product:

- `:144-147` runs the **entire aggregation twice** (once for the page, once via `$count`), including
  `$geoNear` and the `$lookup`.
- `:96-113` performs `$lookup` + `$unwind` against `users` for **every** matching stylist profile and
  only *then* filters on `user.verification.status` and `user.accountStatus`. The join runs across the
  full candidate set before the most selective filter is applied.
- `:136-138` builds `$sort` from a client-supplied field name with no allow-list — sorting on an
  unindexed field forces an in-memory sort that fails past 32MB.

**Changes.**

1. Use `$facet` to compute the page and the count in a single pass instead of two aggregations.
2. Either move the verification/account-status filter into the `$lookup` sub-pipeline, or denormalize
   `isVerified`/`isActive` onto `StylistProfile` (the model already denormalizes location this way —
   see `locationSet` at `stylist-profile.model.js:39` and the sync listener at `stylist.service.js:97`,
   so the pattern and its event plumbing already exist).
3. Allow-list sortable fields (`rating`, `hourlyPrice`, `experienceYears`, `completedSessions`,
   `distance`, `createdAt`) and reject anything else. This pairs with `HARDENING_02` Step 8, which does
   the same for `QueryBuilder`.
4. Confirm the indexes those sorts need actually exist on `StylistProfile` — currently only
   `{ location: '2dsphere' }` is declared.

---

### 7. Add verification state-machine guards

**The defect.** `userService.approveVerification` and `rejectVerification`
(`src/modules/users/user.service.js:128`, `:150`) never check the **current** verification status. An
already-`verified` user can be re-approved; a `rejected` user re-rejected; an `unverified` user with no
submitted documents can be approved outright. Each call overwrites `reviewedBy`/`reviewedAt`, and with
no audit log (`HARDENING_03` Step 5) the previous decision is gone.

Separately, `admin.routes.js:22-26` applies `validate()` to the **reject** route but not the
**approve** route, so `:userId` is unvalidated on approve — a malformed id reaches Mongoose and
surfaces as a `CastError`-derived 400 rather than a clean validation error.

**Changes.**

1. Guard both transitions: only `pending` → `verified`/`rejected` should be permitted. Return `409`
   otherwise.
2. Add a `validate()` schema with `objectIdField` (already in `shared.validator.js:8`) to the approve
   route, matching reject.
3. Confirm a user with no submitted documents cannot be approved.

---

### 8. Replace the hand-rolled sanitizer shim

**The defect.** `src/app.js:34-51` hand-rolls an Express-5 compatibility wrapper around
`express-mongo-sanitize` — reassigning `req.body`/`req.query`/`req.params`/`req.headers` with a
`try/catch` + `Object.defineProperty` fallback for Express 5's getter-only properties. The upstream
package is effectively unmaintained and was never updated for Express 5.

It currently works, but it's load-bearing security code held together by a workaround, and it mutates
`req.headers` — which nothing else in the codebase expects.

**Changes.**

1. Evaluate a maintained alternative (e.g. `express-mongo-sanitize`'s successors, or validating at the
   Zod layer, which already runs on every route via `validate.middleware.js`).
2. Note that `QueryBuilder`'s `convertOperators` (`QueryBuilder.js:6`) deliberately re-introduces
   `$gte`/`$lt`/etc. from safe key names *after* sanitization — so the two mechanisms are coupled. Any
   change here must preserve that, and the field allow-list from `HARDENING_02` Step 8 is the real
   defense.
3. At minimum, stop sanitizing `req.headers` — it's not a Mongo query source and mutating it is a
   surprise waiting to happen.

---

## Definition of Done

- [ ] `npm run lint` exits 0 with zero errors and zero warnings.
- [ ] CI runs `npm run lint` and `npm test` on push and PR, and fails the build on either.
- [ ] `redis.config.js` deleted; `cloudinary.config.js` genuinely imported and used.
- [ ] Socket.io decision recorded and acted on — either handlers exist, or it's removed from `server.js` and from `01_PROJECT_STRUCTURE.md` §2.
- [ ] `payment.repository.js` populates only fields that exist on `booking.model.js`.
- [ ] No `console.log`/`console.error` remains in `src/` (`grep -rn "console\." src/` returns nothing).
- [ ] All event listeners register through one explicit, idempotent pattern invoked from `app.js`.
- [ ] Every module validator uses `.strict()`; `PATCH /users/me` with an unknown field returns `400`.
- [ ] `GET /api/v1/health` reports real per-dependency status with no test-environment short-circuit.
- [ ] `database.config.js` sets explicit pool size and server-selection timeout.
- [ ] Stylist search executes one aggregation per request (verified via `explain()` or query logging), and an unknown `?sort=` field is rejected.
- [ ] Approving an already-verified user returns `409`; approving a user with no submitted documents is refused.
- [ ] The approve route validates `:userId` as an ObjectId.
- [ ] `req.headers` is no longer mutated by the sanitizer.
