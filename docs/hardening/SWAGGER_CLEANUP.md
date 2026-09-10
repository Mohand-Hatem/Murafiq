# Swagger Path-Prefix Inconsistency

## Status
DEFERRED — NOT FIXED

## Priority
LOW

## Why It Was Deferred
This is a documentation/tooling-correctness issue with no runtime, security, or
money impact — the actual Express routes are unaffected; only the generated
OpenAPI document (and anything that consumes it, such as a generated client SDK
or an interactive `/api/docs` explorer) is affected. It was out of scope for the
pre-Phase-15 fix pass, which focused on application-reachable authorization,
money, and concurrency bugs.

## Current Problem
`swagger.config.js` sets the OpenAPI `servers[0].url` to already include the
`/api/v1` prefix:

```js
servers: [
  {
    url: env.API_BASE_URL || `http://localhost:${env.PORT}/api/v1`,
```

Per the OpenAPI spec, every path entry should therefore be written *relative* to
that server URL (e.g. `/payouts/account`, not `/api/v1/payouts/account`). Most
`.swagger.js` files follow this correctly (e.g.
`src/modules/payouts/payout.admin.swagger.js` uses the correct bare form:
`/payouts/admin`, `/payouts/admin/{id}/mark-paid`). Two files do not:

- `src/modules/payouts/payout.swagger.js` — writes `/api/v1/payouts/account`,
  `/api/v1/payouts/mine`, `/api/v1/payouts/admin/pending-balances`,
  `/api/v1/payouts/admin/batch`.
- `src/modules/subscriptions/subscription.swagger.js` — writes
  `/api/v1/subscriptions/plans`, `/api/v1/subscriptions/me`,
  `/api/v1/subscriptions/me/entitlements`, `/api/v1/subscriptions/subscribe`,
  `/api/v1/subscriptions/checkout`, `/api/v1/subscriptions/orders/{orderId}`,
  `/api/v1/subscriptions/webhook`, `/api/v1/subscriptions/cancel`.

For any tool that concatenates `servers[0].url` with the documented path (as a
generated client SDK typically would), these specific 12 paths resolve to
`/api/v1/api/v1/...` — a URL that does not exist on the real server. Note that
`payout.admin.swagger.js` uses the correct bare form *within the same module* as
the incorrect `payout.swagger.js` — the inconsistency is not just cross-module,
it is visible side-by-side inside the payouts module itself.

Separately, `env.API_BASE_URL` is read in `swagger.config.js` but is **not**
defined in the `env.config.js` schema and is absent from `.env.example` — it is
always `undefined` at runtime, so the server URL is permanently the
`localhost:${PORT}/api/v1` fallback regardless of environment.

## Evidence
- `src/config/swagger.config.js` — `servers[0].url`.
- `src/modules/payouts/payout.swagger.js` — the 4 absolute-path entries.
- `src/modules/payouts/payout.admin.swagger.js` — the correct bare-path form,
  for direct contrast within the same module.
- `src/modules/subscriptions/subscription.swagger.js` — the 8 absolute-path
  entries.
- `scripts/validate-openapi.js` — the project's existing OpenAPI validation
  script (wired into `npm run verify`) does not currently check for
  server-relative path consistency, which is why this was not caught
  automatically.

## Risk / Impact
No runtime impact on the actual API — Express routing is entirely independent
of the Swagger annotations. Impact is limited to:
- Any generated client SDK built from the OpenAPI document would construct
  broken URLs for these 12 endpoints.
- The interactive `/api/docs` "Try it out" feature (if it prepends the server
  URL rather than using the path as an absolute override) could send requests
  to the wrong URL for these specific endpoints.
- `env.API_BASE_URL` being permanently unset means the documented server URL
  never reflects the actual deployed host in any non-local environment, which
  is a separate but related documentation-accuracy gap.

## Expected Future Fix
- Strip the `/api/v1` prefix from the 12 affected path entries in
  `payout.swagger.js` and `subscription.swagger.js` so they match the bare
  form already used correctly everywhere else (including the sibling
  `payout.admin.swagger.js`).
- Either add `API_BASE_URL` to the `env.config.js` schema (with a sensible
  default) so it can actually be set per environment, or remove the dead
  `env.API_BASE_URL ||` reference from `swagger.config.js` if it is not
  intended to be configurable.
- Extend `scripts/validate-openapi.js` to flag any documented path beginning
  with the same prefix already present in `servers[0].url`, so this class of
  drift is caught automatically going forward rather than requiring another
  manual audit pass.

## Dependencies
- No phase dependency. Pure documentation/tooling correction inside modules
  that are already fully built and shipped (payouts, subscriptions).

## When To Fix
During Final Hardening, or opportunistically whenever either module's Swagger
annotations are next touched. Not a production gate.

## Verification Plan
- Run `node scripts/validate-openapi.js` (already wired into `npm run verify`)
  after the fix and confirm the "STRUCTURAL PROBLEMS" and path counts remain
  clean, and — once the validator is extended per the fix above — that it now
  actively catches this specific class of error.
- Manually inspect the generated OpenAPI JSON (`/api/docs.json`) to confirm all
  payouts and subscriptions paths are relative, matching every other module.

## Status Checklist
- [ ] Issue fixed
- [ ] Tests added/updated
- [ ] Regression verified
- [ ] Documentation updated
