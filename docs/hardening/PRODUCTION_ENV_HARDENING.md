# Production Environment Hardening — `NODE_ENV` Default and Dev-Secret Fallback

## Status
DEFERRED — NOT FIXED

## Priority
CRITICAL

## Why It Was Deferred
This is a **deployment-configuration** risk, not a code-path bug reachable by an
authenticated or unauthenticated request against a correctly configured
deployment. It requires an operational mistake (forgetting to set `NODE_ENV`) to
manifest. It was flagged in the pre-Phase-15 audit's Tier 4 hardening bucket —
explicitly out of scope for the fix pass, which was limited to Tier 0–3
(exploitable IDOR, Phase 15 blockers, money correctness, and concurrency/dead-
feature bugs reachable through normal application logic regardless of
deployment configuration). Marked CRITICAL here despite being deferred because,
if it does occur, the consequence is severe and the fix is cheap — it belongs at
the top of the pre-production checklist, not forgotten.

## Current Problem
`NODE_ENV` defaults to `'development'` if unset, and the project's `secret()`
helper hands out a working, hardcoded development fallback for every credential
whenever `NODE_ENV !== 'production'`:

```js
const isProd = process.env.NODE_ENV === 'production';
const secret = (devDefault) => (isProd ? z.string().min(1) : z.string().default(devDefault));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ...
  JWT_ACCESS_SECRET: secret('dev_access_secret_change_me_in_prod'),
  JWT_REFRESH_SECRET: secret('dev_refresh_secret_change_me_in_prod'),
  ...
```

A deployment that boots without explicitly setting `NODE_ENV=production` — for
example, a misconfigured PM2 `env_production` block, a missed environment
variable in a hosting provider's dashboard, or a manual `pm2 start` without the
`--env production` flag — does not fail to start. It boots successfully on
placeholder secrets that are committed in this repository and therefore public.

## Evidence
- `src/config/env.config.js` — the `secret()` helper and the `NODE_ENV` schema
  entry (top of the file).
- `ecosystem.config.cjs` — defines `env_production` explicitly, but a boot
  command that doesn't pass `--env production` silently falls back to the
  `development` `env` block instead of failing.
- The specific string `dev_access_secret_change_me_in_prod` (and its refresh-
  token counterpart) is present verbatim in the tracked source tree.

## Risk / Impact
If a deployment boots with `NODE_ENV` unset or set to anything other than
`'production'`:
- `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` fall back to publicly-known values —
  anyone can forge a valid access token for any user, including `role: 'admin'`.
- Secure cookie flags are not enforced (`authCookies.util.js` gates on the same
  `isProd`-style check elsewhere in the codebase).
- `/api/docs` is not gated behind `restrictTo(ADMIN)` (the Swagger UI mount is
  conditional on production mode).
- Stack traces are included in error responses (`error-handler.middleware.js`
  gates verbose errors on `NODE_ENV === 'development'`).

This is the single highest-severity item in the deferred backlog: if it happens,
the blast radius is full authentication bypass, not a narrow data leak.

## Expected Future Fix
Two complementary changes, either of which closes the gap and both of which are
good practice together:
1. Make `NODE_ENV` a required field with no default (fail closed at boot if it
   is not explicitly set to one of `development`/`production`/`test`), rather
   than silently defaulting to `development`.
2. Add a boot-time assertion — independent of the `NODE_ENV` value itself — that
   rejects any known placeholder secret value (`dev_access_secret_change_me_in_prod`
   and its siblings) whenever the process is actually reachable from outside
   localhost, or more simply: reject any placeholder value whenever `NODE_ENV`
   resolves to `production`, and additionally warn loudly (not just default
   silently) whenever a non-test, non-explicitly-development environment is
   detected without `NODE_ENV` having been explicitly set.

## Dependencies
- No phase dependency. Pure deployment/configuration hardening.
- Should be verified against the actual production deployment process described
  in `docs/PHASE_16_DEPLOYMENT_READINESS.md` and `ecosystem.config.cjs` before
  Phase 16 sign-off, since this is precisely the checklist Phase 16 exists to
  finalize.

## When To Fix
Before Production — this is the one item in this backlog that should be treated
as a hard pre-launch gate, not merely "during final hardening."

## Verification Plan
- A deploy-time smoke test (or a unit test on `env.config.js` in isolation) that
  confirms: booting with `NODE_ENV` unset or invalid causes the process to exit
  non-zero rather than start.
- A test confirming that any of the known placeholder secret values, combined
  with `NODE_ENV=production`, causes a boot-time failure (this behavior is
  already partially present via the `isProd` branch of `secret()` requiring a
  non-empty string — the gap is specifically the *unset-or-wrong* `NODE_ENV`
  case, not the case where `NODE_ENV=production` is correctly set).
- Manual verification against the actual `ecosystem.config.cjs` `start:prod`
  script (`pm2 start ecosystem.config.cjs --env production`) to confirm the
  intended production boot path cannot silently degrade to development
  defaults.

## Status Checklist
- [ ] Issue fixed
- [ ] Tests added/updated
- [ ] Regression verified
- [ ] Documentation updated
