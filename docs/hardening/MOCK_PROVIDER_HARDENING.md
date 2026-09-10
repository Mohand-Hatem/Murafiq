# Mock Payment Provider — Hardcoded Success, No Failure Simulation

## Status
DEFERRED — NOT FIXED

## Priority
LOW

## Why It Was Deferred
This is test/development tooling, not application logic reachable in
production — `mock.provider.js`'s `handleCallback` already throws immediately if
`NODE_ENV === 'production'`, and `provider.factory.js` separately hard-fails if
`PAYMENT_PROVIDER=mock` is selected outside tests. It was not part of the
pre-Phase-15 fix pass's scope (which focused on production-reachable
authorization and money-correctness bugs) and carries no production risk by
itself. It matters only for the *quality of test coverage* it currently
prevents.

## Current Problem
`MockProvider.handleCallback` always returns `success: true`, regardless of what
the caller passed in:

```js
async handleCallback(payload = {}, query = {}) {
  ...
  return {
    success: true,
    transactionId: payload.transactionId || `mock_tx_${crypto.randomUUID()}`,
    status: payload.status || 'paid',
    bookingId: payload.bookingId || payload.special_reference,
  };
}
```

`payment.service.js`'s `handleWebhook` branches on `result.success || result.status
=== 'paid'` to decide between the success and failure paths. Because
`MockProvider` never returns `success: false` (or a `status` other than what it
defaults to `'paid'`), the entire `PAYMENT_FAILED` branch of `handleWebhook` —
along with its own ledger/notification/event-emission behavior — cannot currently
be exercised through the mock provider at all.

## Evidence
- `src/modules/payments/providers/mock.provider.js` — `handleCallback`,
  the unconditional `success: true`.
- `src/modules/payments/payment.service.js` — `handleWebhook`'s branch on
  `result.success || result.status === 'paid'`.
- The production lockouts that make this LOW risk rather than a security issue:
  `mock.provider.js`'s own `if (env.NODE_ENV === 'production') throw ...`, and
  `src/modules/payments/providers/provider.factory.js`'s separate guard against
  `PAYMENT_PROVIDER=mock` outside test environments.

## Risk / Impact
No production risk. The impact is entirely on test coverage: any test that
wants to exercise a *failed* payment webhook, a webhook reporting a different
status than `'paid'`, or the downstream behavior of `PAYMENT_FAILED` (ledger
non-writes, client notification, audit logging) currently cannot do so by
driving the mock provider through a realistic callback — it has to either mock
`paymentService.handleWebhook`'s internals directly or construct the failure
scenario another way, which is more brittle and further from an integration-style
test of the real webhook path.

## Expected Future Fix
Let `MockProvider.handleCallback` honor an explicit `payload.status` /
`payload.success` input rather than hardcoding the successful case — for
example, accepting `status: 'failed'` in the mock webhook payload and returning
`success: false` accordingly, so a test can drive the real `handleWebhook` code
path through both outcomes using the same mechanism (the mock provider) it
already uses for the success case, with the same HMAC-equivalent secret check
already in place.

## Dependencies
- No phase dependency. Self-contained inside the payments module's provider
  layer, which is already built (Phase 6) and explicitly designed for this kind
  of provider-swap via the existing provider interface pattern.

## When To Fix
During Final Hardening — primarily valuable as a testing-infrastructure
improvement, not a pre-production security gate. Low urgency; can also be picked
up opportunistically whenever `PAYMENT_FAILED` test coverage is next touched.

## Verification Plan
- A new test driving a full `POST /payments/callback` request through the mock
  provider with a payload indicating failure, asserting the response and
  resulting `Payment.status` match the existing `PAYMENT_FAILED` branch's
  documented behavior.
- Confirm the existing success-path tests (`tests/integration/payments.test.js`
  and related webhook/ledger-dual-write suites) are unaffected — the change
  should be additive (the mock now *can* report failure when asked to), not a
  change to its default behavior when no explicit failure is requested.

## Status Checklist
- [ ] Issue fixed
- [ ] Tests added/updated
- [ ] Regression verified
- [ ] Documentation updated
