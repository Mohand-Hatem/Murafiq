# In-Process Crons Depend on `instances: 1`

## Status
DEFERRED — NOT FIXED (architectural constraint, currently correctly documented and honored)

## Priority
MEDIUM

## Why It Was Deferred
This is not a bug in the current deployment — `ecosystem.config.cjs` already
pins `instances: 1` / `exec_mode: 'fork'` specifically because of this
constraint, and the constraint is already documented in-line in that file. It
is deferred here not because it is broken today, but because it is a
**structural ceiling on horizontal scaling** that must be deliberately resolved
before anyone changes that PM2 configuration — and that decision did not need
to be made as part of the pre-Phase-15 fix pass, which did not touch
deployment topology.

## Current Problem
Seven cron jobs are registered as in-process `node-cron` schedules, each with no
distributed lock or leader-election mechanism:

- `src/jobs/offer-expiry.cron.js`
- `src/jobs/request-autopause.cron.js`
- `src/jobs/no-show-resolution.cron.js`
- `src/jobs/session-reminder.cron.js`
- `src/jobs/subscription-renewal.cron.js`
- `src/jobs/ledger-reconciliation.cron.js`
- `src/jobs/otp-cleanup.cron.js`

Each is started once per Node process (`src/server.js`, e.g.
`startSessionReminderCron()`). If the API is ever run as more than one process
— PM2 cluster mode, multiple containers, multiple VPS instances behind a load
balancer — every one of these jobs fires once per process on every tick,
multiplying its side effects (offer-expiry sweeps, no-show auto-resolution,
subscription renewals, ledger reconciliation, OTP cleanup) by the instance
count.

## Evidence
- `ecosystem.config.cjs` — `instances: 1`, `exec_mode: 'fork'`, with an
  explicit in-line comment already stating this is a correctness requirement,
  not a performance default: *"instances: 1 / exec_mode: 'fork' is NOT a
  performance default here — it's a correctness requirement... running this
  file in PM2 cluster mode would schedule that sweep once per worker process."*
- `src/server.js` — the `start*Cron()` calls, one per job, each registered
  unconditionally on process boot.
- The BullMQ wardrobe-classification worker (`src/jobs/workers/wardrobe-classification.worker.js`,
  started via `startWardrobeWorker()` in the same file) is a **different**
  category — it is queue-consumer-based, not a `node-cron` schedule, and is
  already designed to tolerate multiple concurrent workers (BullMQ's own job
  locking handles that). This item is scoped to the seven `node-cron` jobs
  only.

## Risk / Impact
No risk today, as long as the deployment stays at `instances: 1` — which it
currently does, deliberately. The risk is entirely forward-looking: if the
platform's growth eventually requires horizontal scaling of the API process
(more traffic than one fork-mode instance can serve), naively bumping
`instances` in `ecosystem.config.cjs` — without first addressing this — would
silently duplicate every one of these seven jobs' side effects on every tick.
Some of that duplication is already partially self-defending (e.g. idempotency
keys on ledger writes, unique indexes on penalty assessment), but others are
not designed to tolerate concurrent execution (e.g. `request-autopause.cron.js`'s
`find` + `.save()` loop has no locking of its own).

## Expected Future Fix
Before any change to `instances` in `ecosystem.config.cjs`, either:
1. Migrate these seven cron jobs onto the BullMQ infrastructure already
   installed for the wardrobe worker, using BullMQ's repeatable-job feature
   (which is inherently safe across multiple worker processes, since job
   claiming is coordinated through Redis) — this was the direction already
   anticipated by `PHASE_12_BACKGROUND_JOBS.md`'s original scope, and
2. Or, if staying with `node-cron`, add an explicit distributed lock (e.g. a
   short-lived Redis lock acquired at the top of each job, released on
   completion) so only one process's tick actually executes the job body per
   scheduled interval.

This is a deliberate architectural decision, not a small patch — it should be
made once, not per-job, so all seven jobs move the same way.

## Dependencies
- Directly gates any future decision to scale the API process horizontally
  (PM2 cluster mode, multiple containers/VPS instances).
- Natural fit alongside Phase 12's BullMQ infrastructure, which is already
  installed and already used for the wardrobe classification queue — reusing
  it for these crons avoids introducing a second distributed-coordination
  mechanism (e.g. a bespoke Redis lock) when one is already in place.

## When To Fix
Not before Phase 16. This should be resolved **only when horizontal scaling is
actually planned**, not preemptively — until then, `instances: 1` correctly and
sufficiently protects against the described risk, and this document exists so
that decision is not made in isolation by whoever next edits
`ecosystem.config.cjs`.

## Verification Plan
- Whichever direction is chosen (BullMQ migration or Redis lock), the
  verification is the same: run the API at `instances: 2` (or equivalent) in a
  test/staging environment and confirm each cron's side effects (offer
  expiries, no-show resolutions, subscription renewals, ledger reconciliation
  runs, OTP cleanups) occur exactly once per scheduled tick, not once per
  process.
- Confirm `ecosystem.config.cjs`'s in-line comment is updated to reflect the
  new, actually-safe scaling behavior once this is resolved — so the next
  person reading it isn't working from stale information.

## Status Checklist
- [ ] Issue fixed
- [ ] Tests added/updated
- [ ] Regression verified
- [ ] Documentation updated
