# Phase 12 — Scheduled Jobs (node-cron)

## Goal
Add the two remaining recurring sweeps this project needs: OTP cleanup and session reminders,
following the pattern already established by the offer-expiry sweep.

> **Re-scoped 2026-08-24.** This phase originally specced five BullMQ queues (`mail`,
> `notification`, `otp-cleanup`, `offer-expiry`, `session-reminder`) behind Redis. Investigation
> found that three of those five are pure **schedulers** ("run X every N minutes"), not **queues**
> ("process this one item, retry it if it fails, don't block the caller on it") — and Redis/BullMQ
> is real infrastructure to provision, monitor, and back up for a v1 that has no per-item retryable
> work yet.
>
> **Decision:** the recurring sweeps stay `node-cron`, in-process, permanently — not a stepping
> stone to BullMQ. `mail` and `notification` moved to **Phase 14**, which owns Redis/BullMQ because
> the wardrobe photo-classification worker is the first thing in this project that is genuinely
> queue-shaped (slow external API call, per-item, must not block the request, needs retry/backoff).
> See `PHASE_14_WARDROBE.md` for that setup. Do not install `bullmq`/`ioredis` or recreate
> `redis.config.js` in this phase.

## Depends on
Phase 4 (`expireOldRequests()`/`expireOldOffers()` logic already written — offer-expiry is already
wired, see below), Phase 7 (notification service, for the session-reminder job's send call).

---

## Prior art — read this file first

`src/jobs/offer-expiry.cron.js` is the reference implementation for every job in this phase. Both
new jobs below should match its shape exactly:

- Module-level `registered` boolean, guarding a `start<Job>Cron()` export against double-registration
  (matters because `server.js` could theoretically call it more than once, e.g. under a future
  hot-reload).
- Early-return when `env.NODE_ENV === 'test'` — tests drive the underlying repository function
  directly and deterministically; they must never depend on a timer firing.
- `cron.schedule(SCHEDULE, async () => { try { ... } catch (err) { logger.error(...) } })` — a
  failure inside the job must never crash the process; log it and let the next tick retry.
- Registered from `server.js`'s `startServer()`, after `connectDB()` succeeds, alongside the
  existing `startOfferExpiryCron()` call.
- **Single-instance constraint inherited from `ecosystem.config.cjs`:** none of these jobs take a
  distributed lock, so PM2 must stay `exec_mode: 'fork'`, `instances: 1`. Adding a job here does not
  change that constraint; it reinforces it. If you ever need multiple API instances, every cron job
  in this file must first move to BullMQ (Phase 14's infra) or gain a real lock (e.g. a Mongo
  `findOneAndUpdate` claim document) — don't solve it ad hoc per job.

---

## Steps

### 1. `src/jobs/otp-cleanup.cron.js`

Purpose: `User.otpCode`/`otpExpiresAt` are cleared on successful verification, but a user who
requests an OTP and never completes verification leaves a stale hashed OTP sitting on their
document indefinitely. Not a security hole (it's hashed and time-limited at compare time), but it's
dead data with no reason to persist.

```js
export const cleanupExpiredOtps = async () => {
  const now = new Date();
  return User.updateMany(
    { otpExpiresAt: { $lt: now }, otpCode: { $ne: null } },
    { $set: { otpCode: null, otpExpiresAt: null } }
  );
};
```

Add this as a repository-level function (`user.repository.js`, matching where
`offerRepository.expireOldOffers()` lives), not inline in the cron file — the cron file's only job
is scheduling, per the reference implementation.

Schedule: hourly (`0 * * * *`) is plenty; this has no user-facing urgency.

### 2. `src/jobs/session-reminder.cron.js`

Purpose: notify both parties ahead of an upcoming confirmed booking. Requires one schema addition
first:

- Add `reminderSentAt: Date` to `booking.model.js` — it does not exist today. Guard the query on
  `reminderSentAt: null` so a booking is reminded exactly once, not every tick between now and the
  session.

```js
export const findBookingsNeedingReminder = async (windowStart, windowEnd) => {
  return Booking.find({
    status: 'confirmed',
    scheduledDate: { $gte: windowStart, $lte: windowEnd },
    reminderSentAt: null,
  });
};
```

For each match: call `notificationService.send()` (Phase 7, already built) for both `clientId` and
`stylistId`, then set `reminderSentAt: new Date()` via `bookingRepository.updateById()`. Reuse
existing repository/service functions — do not query `Booking` directly from the cron file.

Schedule: every 15 minutes (`*/15 * * * *`), matching the original spec's reminder cadence.

### 3. Wire both into `server.js`

Alongside the existing `startOfferExpiryCron()` call in `startServer()`:

```js
await connectDB();
startOfferExpiryCron();
startOtpCleanupCron();
startSessionReminderCron();
server.listen(...)
```

---

## Explicitly out of scope for this phase

- **`mail` and `notification` as queues** — moved to Phase 14. `mailService.sendMail()` and
  `notificationService.send()` continue to be called synchronously until then; that's an accepted
  v1 trade-off (see `HARDENING_03` Step 4 for why a mail failure no longer 500s the caller).
- **Redis, BullMQ, `ioredis`** — not installed. `REDIS_URL` is deliberately absent from
  `src/config/env.config.js` (see `03_SKELETON_STATUS.md` §7) until Phase 14 re-adds it.
- **Bull Board / `/admin/queues`** — nothing to dashboard without a real queue. `04_ROUTES.md`
  keeps this row 🔲 Planned, now pointing at Phase 14 instead of this phase.

---

## Definition of Done

- [ ] `cleanupExpiredOtps()` clears `otpCode`/`otpExpiresAt` on a seeded expired-OTP user, verified
      with an accelerated schedule in a test, not just read from the code.
- [ ] A confirmed booking inside the reminder window receives exactly one notification per party —
      confirmed by running the sweep twice against the same seeded booking and asserting only one
      notification was sent (i.e. `reminderSentAt` correctly prevents the second send).
- [ ] A booking outside the window, or already reminded, is not touched.
- [ ] Restarting the server does not double-register any of the three cron jobs (extend
      `tests/unit/` coverage the same way `offer-expiry.cron.js` would be tested, if it isn't
      already).
- [ ] No `bullmq`, `ioredis`, or `redis.config.js` was added in this phase.
- [ ] `npm run lint` and `npm test` pass.
