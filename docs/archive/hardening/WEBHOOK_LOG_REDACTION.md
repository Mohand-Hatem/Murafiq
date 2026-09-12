# Access Logs May Record Webhook HMAC Signatures and Secrets

## Status
DEFERRED — NOT FIXED

## Priority
MEDIUM

## Why It Was Deferred
This is a defense-in-depth logging concern, not an exploitable application bug —
the HMAC verification itself (`paymob.provider.js`) is correct and constant-time.
The risk here is about what ends up sitting in a log *file* if that file is later
read by someone who should not have access to it, which is a different threat
model than the request-path authorization/money bugs the pre-Phase-15 fix pass
targeted. It was flagged as Tier 4 hardening in the original audit and was out
of scope for that pass.

## Current Problem
Production logging uses Morgan's `'combined'` format, which includes the full
request URL (query string included):

```js
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev', { stream }));
```

Paymob delivers its HMAC signature as a query parameter on the webhook callback:

```js
const receivedHmac = query.hmac || payload.hmac;
```

`POST /api/v1/payments/callback?hmac=<signature>&...` is therefore logged in
full in production, meaning the Paymob HMAC signature — the credential that
proves a webhook request is authentic — is written to `logs/combined.log`
verbatim. The same class of exposure applies in non-production environments to
the mock provider's `secret` query parameter
(`mock.provider.js`'s `?secret=${mockClientSecret}` pattern), though that is a
test-only credential with no production consequence.

Separately, `src/config/logger.config.js` writes to `logs/` on disk with no log
rotation configured, so this exposure — if it occurs — persists indefinitely
rather than aging out.

## Evidence
- `src/app.js` — the `morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev',
  { stream })` line.
- `src/modules/payments/providers/paymob.provider.js` — `receivedHmac = query.hmac
  || payload.hmac` (the HMAC is accepted from the query string).
- `src/modules/payments/payment.routes.js` — `router.post('/callback',
  webhookRateLimiter, paymentController.handleWebhook);`, the route this HMAC
  travels to.
- `src/config/logger.config.js` — Winston file transports with no rotation
  configuration.

## Risk / Impact
An HMAC signature logged to disk is, by itself, tied to one specific webhook
payload (Paymob's HMAC covers a fixed, ordered set of transaction fields — see
`paymob.provider.js`'s field-ordering comment) and cannot be replayed to forge a
*different* payload. The realistic risk is narrower than "an attacker can forge
arbitrary webhooks from the log" — it is closer to: anyone who gains read access
to `logs/combined.log` (a compromised server, an overly broad log-shipping
integration, a misconfigured log-viewer permission) can see exactly which
requests hit the webhook endpoint and their full query strings, which is
sensitive operational detail that should not be casually readable, and is
inconsistent with treating the HMAC as a credential at all.

## Expected Future Fix
Redact the `hmac` (and, in non-production, `secret`) query parameters before
they reach the access-log line — either via a Morgan custom token/format that
strips known-sensitive query keys, or by moving Paymob's webhook signature
verification to accept the signature from a header instead of a query
parameter (if Paymob's integration supports that transport), which would remove
it from the URL entirely rather than requiring log-time redaction. Also add log
rotation (e.g. `winston-daily-rotate-file`) so any residual exposure has a
bounded lifetime rather than persisting indefinitely.

## Dependencies
- No phase dependency. Self-contained logging/observability change.
- If moving away from query-string HMAC delivery, depends on confirming Paymob's
  actual webhook delivery mechanism supports header-based signatures for this
  integration (a provider-capability question, not an internal one).

## When To Fix
During Final Hardening (pre-production).

## Verification Plan
- A test or manual check confirming a webhook request's `hmac` query parameter
  does not appear verbatim in the resulting access-log line, while the request
  is still processed and verified correctly.
- Confirm HMAC verification (`paymob.provider.js`'s `verifyHmac`) continues to
  pass its existing test coverage unchanged — this is a logging-layer fix, not a
  verification-logic change.
- Confirm log rotation is active and configured with a sane retention window.

## Status Checklist
- [ ] Issue fixed
- [ ] Tests added/updated
- [ ] Regression verified
- [ ] Documentation updated
