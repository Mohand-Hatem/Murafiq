# Post-Phase-15 Hardening Backlog

## Purpose
This backlog contains **verified issues** identified during the pre-Phase-15
project-wide audit that were **intentionally deferred** — not overlooked — when
the corresponding fix pass landed. That pass closed every item in scope for it:
the two exploitable payout IDOR vulnerabilities, all three Phase-15 blockers
(SSRF, wardrobe quota enforcement, entitlement bypass), six money-correctness
bugs in the payout/refund/ledger path, and four concurrency/dead-feature bugs
(booking-completion race, two dead event listeners, four schema/field-name
mismatches, five validators that were silently skipping validation).

Everything listed here is what remained **after** that pass — either explicitly
out of the scope given for it, or a narrower/lower-severity edge case found
while implementing the in-scope fixes. Nothing in this file has been fixed by
this backlog's creation; it is documentation only.

## Rule
> No item in this backlog should be forgotten simply because Phase 15 is complete.

## Master Table

| ID | Issue | Priority | Area | Status | Planned Fix Stage |
|---|---|---|---|---|---|
| HARDEN-001 | Payout batch creation missing CAS guard on `payoutStatus` | HIGH | Concurrency / Money | DEFERRED | Final Hardening |
| HARDEN-002 | `getPendingBalancesSummary` preview calc diverges from actual batch netting | MEDIUM | Money / Data Integrity | DEFERRED | Final Hardening |
| HARDEN-003 | `resolveNoShow` performs multiple writes with no Mongoose transaction | HIGH | Concurrency / Money | DEFERRED | Final Hardening |
| HARDEN-004 | No per-folder role authorization on uploads (KYC bucket writable by any user) | HIGH | Security | DEFERRED | Before Production |
| HARDEN-005 | `NODE_ENV` defaults to development; dev secrets fall back silently | CRITICAL | Security / Production Hardening | DEFERRED | Before Production |
| HARDEN-006 | Mock payment provider cannot simulate a failed webhook | LOW | Reliability / Testing | DEFERRED | Final Hardening |
| HARDEN-007 | Swagger path-prefix inconsistency (`/api/v1` doubled) in 2 modules | LOW | Documentation / Tooling | DEFERRED | Final Hardening |
| HARDEN-008 | Production access logs may record webhook HMAC in the query string | MEDIUM | Security / Production Hardening | DEFERRED | Final Hardening |
| HARDEN-009 | `QueryBuilder.select()` can expose `select:false` fields (password/session hashes) | HIGH | Security | DEFERRED | Before Production |
| HARDEN-010 | Wardrobe search uses unescaped, unindexed regex | MEDIUM | Performance / Reliability | DEFERRED | Final Hardening |
| HARDEN-011 | Moderation list repositories have no independent query-limit cap | LOW | Performance / Reliability | DEFERRED | Final Hardening |
| HARDEN-012 | Payout pending-balances preview issues N+1 queries per stylist | LOW | Performance | DEFERRED | Final Hardening |
| HARDEN-013 | 7 in-process crons depend on `instances: 1`; no distributed lock | MEDIUM | Reliability / Production Hardening | DEFERRED | Before scaling horizontally (not before Phase 16) |
| HARDEN-014 | Safety module unbuilt; `isFrozen` read but never written — decision needed | MEDIUM | Product Decision / Documentation | DEFERRED | Final Hardening (decision), timeline TBD (implementation) |

## Recommended Fix Order

1. **Security** — HARDEN-005, HARDEN-004, HARDEN-009
2. **Money / Data Integrity** — HARDEN-001, HARDEN-003, HARDEN-002
3. **Concurrency** — (HARDEN-001 and HARDEN-003 above are also the concurrency
   items; no additional purely-concurrency items beyond those)
4. **Reliability** — HARDEN-013, HARDEN-006, HARDEN-010, HARDEN-011
5. **Production Hardening** — HARDEN-008, HARDEN-013 (deployment-topology
   aspect)
6. **Performance** — HARDEN-012, HARDEN-010 (query-efficiency aspect),
   HARDEN-011
7. **Documentation / Tooling** — HARDEN-007, HARDEN-014 (decision-recording
   aspect)

Items appear in more than one category above where they genuinely span
concerns (e.g. HARDEN-013 is both a reliability and a production-hardening
item; HARDEN-010 is both a security-adjacent reliability fix and a performance
one) — this reflects the actual nature of the issue, not miscategorization.

## Production Gate

> **These deferred issues must be reviewed again before Phase 16 / production
> deployment.**

Not all of them are mandatory blockers today — priorities above reflect actual
severity and reachability, not a uniform "must fix everything" stance. Three
items are explicitly flagged as pre-production gates in their own documents
regardless of Phase 16 timing: **HARDEN-005** (`NODE_ENV` hardening),
**HARDEN-004** (upload role authorization), and **HARDEN-009** (sensitive field
projection) — each involves a security-relevant gap that should be closed
before real user data and real money are at stake, independent of when Phase
16 itself happens to be scheduled. The remainder are appropriately scheduled
for Final Hardening rather than treated as launch blockers, per their
individual priority assessments.

## Individual Documents

- `PAYOUT_BATCH_CAS.md` — HARDEN-001
- `PAYOUT_PREVIEW_CALCULATION.md` — HARDEN-002
- `NO_SHOW_TRANSACTION.md` — HARDEN-003
- `UPLOAD_ROLE_AUTHORIZATION.md` — HARDEN-004
- `PRODUCTION_ENV_HARDENING.md` — HARDEN-005
- `MOCK_PROVIDER_HARDENING.md` — HARDEN-006
- `SWAGGER_CLEANUP.md` — HARDEN-007
- `WEBHOOK_LOG_REDACTION.md` — HARDEN-008
- `SENSITIVE_FIELD_PROJECTION.md` — HARDEN-009
- `WARDROBE_SEARCH_HARDENING.md` — HARDEN-010
- `MODERATION_QUERY_LIMITS.md` — HARDEN-011
- `PAYOUT_N_PLUS_1.md` — HARDEN-012
- `CRON_SINGLE_INSTANCE_DEPENDENCY.md` — HARDEN-013
- `SAFETY_MODULE_DECISION.md` — HARDEN-014

Each document follows the same structure: Status, Priority, Why It Was
Deferred, Current Problem, Evidence, Risk/Impact, Expected Future Fix,
Dependencies, When To Fix, Verification Plan, and a Status Checklist — none of
which is checked off in any document, since nothing in this backlog has been
fixed yet.
