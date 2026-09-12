# Moderation List Queries — No Independent Server-Side Cap

## Status
DEFERRED — NOT FIXED (partially mitigated at the route layer)

## Priority
LOW

## Why It Was Deferred
The pre-Phase-15 fix pass already closed the specific, verified route-level
vulnerability this item originally referred to: `getModerationEventsSchema` and
`getBlockedWordsSchema` were previously exported as bare Zod schemas (not
wrapped in `{ query: ... }`), which meant `validate.middleware.js` found
nothing to parse and let every request — including an oversized `?limit=`
value — through unvalidated. That was fixed as part of the validator-shape
corrections in the same pass, and is verified: `GET
/admin/moderation/events?limit=999999` now correctly returns `400` (see
`tests/integration/moderation-interceptor.test.js`, "rejects an oversized limit
now that query validation actually runs"). **This document is about what is
still left** after that fix: the underlying repository functions have no
independent bound of their own, so they rely entirely on the validator upstream
of them, rather than defending themselves.

## Current Problem
`findPaginated` (moderation events) and `findAllPaginated` (blocked words) both
parse `limit` with a plain fallback and no upper clamp:

```js
export const findPaginated = async (query = {}, pagination = { page: 1, limit: 20 }) => {
  const page = parseInt(pagination.page, 10) || 1;
  const limit = parseInt(pagination.limit, 10) || 20;
  // no Math.min(limit, MAX) anywhere in this function
  ...
```

Today, the only thing preventing an oversized `limit` from reaching this
function is the Zod schema's `.max(100)` at the route layer (fixed in the
pre-Phase-15 pass). If any future code path calls `findPaginated` or
`findAllPaginated` directly — bypassing the HTTP route and its validator
(for example, from an internal script, a future admin tool, or a different
route that reuses the same repository function without applying the same
schema) — there is no defense at the data-access layer itself.

## Evidence
- `src/modules/moderation/moderation-event.repository.js` — `findPaginated`
  (no independent cap).
- `src/modules/moderation/blocked-word.repository.js` — `findAllPaginated`
  (same pattern).
- `src/modules/moderation/moderation.validator.js` — `getModerationEventsSchema`,
  now correctly wrapped as `{ query: z.object({ limit: z.coerce.number()...
  max(100)... }) }` (fixed in the pre-Phase-15 pass).
- `src/modules/moderation/blocked-word.validator.js` — `getBlockedWordsSchema`,
  same fix applied.
- `tests/integration/moderation-interceptor.test.js` — the regression test
  confirming the route-level fix (`'rejects an oversized limit now that query
  validation actually runs'`).

## Risk / Impact
Currently low, because the only reachable path to these functions (the two
admin/operator-gated HTTP routes) is now protected by the fixed validators.
The residual risk is architectural: the protection lives entirely at the route
boundary rather than at the data-access boundary, so it is only as strong as
"every future caller remembers to validate first" — a defense-in-depth gap, not
an active vulnerability today.

## Expected Future Fix
Add an independent `Math.min(limit, MAX_PAGE_SIZE)` clamp inside `findPaginated`
and `findAllPaginated` themselves (matching a reasonable ceiling, e.g. 100,
consistent with the validator's own cap), so the repository layer does not rely
solely on its caller having validated correctly. This is a small, low-risk
addition since the validator already enforces the same ceiling upstream today —
the repository-level clamp would simply make that guarantee structural rather
than incidental.

## Dependencies
- No phase dependency. Small, self-contained addition to two already-shipped
  repository functions in the moderation module.

## When To Fix
During Final Hardening, or opportunistically whenever either repository
function is next touched. Not a production gate given the route-level fix
already in place.

## Verification Plan
- A unit test calling `findPaginated`/`findAllPaginated` directly (bypassing
  the HTTP layer and its validator) with an oversized `limit`, asserting the
  function itself clamps to the maximum rather than trusting the input.
- Confirm the existing HTTP-level regression tests
  (`moderation-interceptor.test.js`) still pass unchanged.

## Status Checklist
- [ ] Issue fixed
- [ ] Tests added/updated
- [ ] Regression verified
- [ ] Documentation updated
