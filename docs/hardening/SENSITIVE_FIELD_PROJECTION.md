# `QueryBuilder.select()` Can Expose `select: false` Fields

## Status
DEFERRED — NOT FIXED

## Priority
HIGH

## Why It Was Deferred
Exploiting this requires an already-authenticated **admin or operator** session
(the affected route, `GET /admin/users`, is admin/operator-gated) — it is
privilege escalation *within* the admin tier, not an unauthenticated or
ordinary-user-reachable bug. The pre-Phase-15 fix pass prioritized bugs
reachable by ordinary authenticated users and by unauthenticated attackers
(payout IDOR, SSRF, entitlement bypass); this is real but sits one tier further
back, and was flagged as Tier 4 hardening in the original audit.

## Current Problem
`QueryBuilder.select()` passes the caller-supplied `fields` query parameter
directly into Mongoose's `.select()`, stripping only literal `+` characters:

```js
QueryBuilder.prototype.select = function () {
  if (this.queryString.fields) {
    const fields = this.queryString.fields.replace(/\+/g, '').split(',').join(' ');
    this.mongooseQuery = this.mongooseQuery.select(fields);
  } else {
    this.mongooseQuery = this.mongooseQuery.select('-__v');
  }
  return this;
};
```

In Mongoose, explicitly naming a field in `.select()` — even one marked `select:
false` at the schema level — **includes** it in the result, overriding the
schema default. `User` marks several genuinely sensitive fields this way:
`passwordHash`, `otpCode`, `otpExpiresAt`, `otpAttempts`, and `sessions` (the
array holding hashed refresh tokens), all `select: false` in
`src/modules/users/user.model.js`.

## Evidence
- `src/common/query-builder/QueryBuilder.js` — `select()` prototype method.
- `src/modules/users/user.model.js` — `select: false` on `passwordHash` (~line
  19), `otpCode`/`otpExpiresAt`/`otpAttempts` (~lines 26–28), and `sessions`
  (~line 62).
- `src/modules/users/user.repository.js` — the admin user-listing query path
  that constructs a `QueryBuilder` over the `User` model, reachable via `GET
  /admin/users` (admin/operator-gated route).

## Risk / Impact
An admin or operator account — including one that has been compromised, or an
operator acting maliciously within their otherwise-limited scope — can request
`GET /admin/users?fields=passwordHash` or `?fields=sessions` and receive bcrypt
password hashes or hashed refresh-token material for every user in the result
set, defeating the `select: false` protection those fields are specifically
marked with. This does not grant a *new* capability an admin doesn't otherwise
have in some form, but it does mean the schema-level protection meant to keep
credential material out of ordinary query results is not actually enforced
against an explicit request for it, and `otpCode`/`otpAttempts` exposure could
assist a brute-force or session-hijacking attempt if combined with other admin
access.

## Expected Future Fix
Replace the pass-through behavior with an explicit allowlist of fields each
`QueryBuilder` call site is permitted to project — mirroring the pattern already
used for `.filter(allowedFields)` elsewhere in the same class — so a caller can
only select from a known-safe set, and any `select: false` field is never
selectable via this path regardless of what the query string asks for. The
`.filter()` method already demonstrates the intended pattern (accepting an
explicit allowlist parameter); `.select()` should follow the same shape.

## Dependencies
- No phase dependency. Self-contained inside the shared `QueryBuilder` utility,
  used across many already-shipped list endpoints — the fix should be verified
  against every existing caller to confirm none of them relies on selecting a
  field outside a sensible allowlist.

## When To Fix
During Final Hardening (pre-production).

## Verification Plan
- A test confirming `GET /admin/users?fields=passwordHash` (and `sessions`,
  `otpCode`) no longer returns those fields in the response, while legitimate
  field selection (e.g. `?fields=name,email`) continues to work.
- Regression run across every existing `QueryBuilder`-based list endpoint to
  confirm no currently-relied-upon field selection breaks once the allowlist is
  introduced.

## Status Checklist
- [ ] Issue fixed
- [ ] Tests added/updated
- [ ] Regression verified
- [ ] Documentation updated
