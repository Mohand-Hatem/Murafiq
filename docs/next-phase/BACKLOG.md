# Murafiq — Active Technical Backlog

> **This file is the single source of truth for open technical debt.**
> Revalidated against the working tree on 2026-09-12. Every status below was verified by
> reading the current code, not carried forward from an earlier document.
>
> The per-issue analysis documents for these items live in `docs/archive/hardening/`.
> Those are **historical analysis**, not current status — where they disagree with this
> file, this file wins.

## Summary

| Open | Closed since the backlog was written | Blocking Phase 15 |
|---|---|---|
| 6 | 8 | **None** |

---

## Open items

| ID | Issue | Severity | Area | Blocks Phase 15? |
|---|---|---|---|---|
| HARDEN-002 | `getPendingBalancesSummary` preview calc diverges from actual batch netting | MEDIUM | Money / Data integrity | No |
| HARDEN-008 | Production access logs may record the webhook HMAC in the query string | MEDIUM | Security / Ops | No |
| HARDEN-010 | Wardrobe search uses an unescaped, unindexed `$regex` | MEDIUM | Security / Performance | No — but it is in the module Phase 15 builds on |
| HARDEN-011 | Moderation list repositories accept an uncapped `limit` | LOW | Performance | No |
| HARDEN-012 | Payout pending-balances preview issues N+1 queries per stylist | LOW | Performance | No |
| HARDEN-013 | Six in-process crons depend on `instances: 1`; no distributed lock | MEDIUM | Reliability / Scaling | No — blocks horizontal scaling only |

### HARDEN-002 — payout preview diverges from batch netting
`getPendingBalancesSummary` computes a stylist's pending balance differently from the netting
`createBatchPayouts` actually performs, so the admin dashboard can show a figure the batch job
will not pay. Cosmetic until an operator acts on the number.

### HARDEN-008 — webhook HMAC in access logs
Paymob delivers its HMAC as a query parameter. No redaction middleware exists
(`grep -rn "redact" src/common/middlewares/` → no match), so a reverse proxy or access log
retaining full query strings will persist a live signing value. Mitigated in practice by the
HMAC being per-payload rather than a static secret.

### HARDEN-010 — wardrobe search regex
`wardrobe.repository.js:34` builds `{ $regex: search, $options: 'i' }` from caller input with no
escaping and no supporting index. A crafted pattern is a CPU-burn vector, and the query is a
collection scan regardless. **Worth fixing before Phase 15**, which queries this collection
heavily — not because it blocks, but because Phase 15 will amplify the cost.

### HARDEN-011 — uncapped moderation `limit`
`moderation-event.repository.js:17` does `parseInt(pagination.limit, 10) || 20` with no ceiling,
so `?limit=1000000` is honoured. Admin-only routes, so exposure is limited to authenticated staff.

### HARDEN-012 — payout preview N+1
The preview runs `Promise.all` over stylists with a per-stylist penalty lookup. Parallel, but
still one query per stylist. Admin-only, small N today.

### HARDEN-013 — crons require `instances: 1`
Six crons, an in-process token-revocation cache, the session-reminder dedupe guard and the
moderation word cache all assume a single process. Documented in `ecosystem.config.cjs` and
`docs/OPS.md`. Not a defect at current scale; it is the prerequisite list for scaling out.

---

## Carried forward from the 2026-08 Phase 0–7 review

| ID | Issue | Severity | Status |
|---|---|---|---|
| OPS-001 | `MAIL_TO_ADDRESS` redirects all outgoing mail to a single inbox because of the Resend dev sandbox. Must be removed from production config once a verified sending domain exists. | MEDIUM | Open |

Source: `docs/archive/reviews/CODE_REVIEW_2026_08_PHASES_00_07.md`. The other two action items
in that review (offer-expiry sweeper, client-side chat push) are now closed — the sweeper shipped
as `src/jobs/offer-expiry.cron.js`, and direct Firestore message writes were disabled
(`firestore.rules`: `allow create: if false`), which removes the push-sync gap entirely.

---

## Closed — verified against the working tree

Recorded so that nobody re-opens them from an archived document.

| ID | Issue | Closed by | Evidence |
|---|---|---|---|
| HARDEN-001 | Payout batch creation missing CAS guard on `payoutStatus` | S4.2 | Batch creation runs inside `withTransaction`; the eligibility read and the `updateManyPayoutStatus` write share one session, so a concurrent batch hits a write conflict and retries. **The explicit `payoutStatus: 'unpaid'` filter is still absent from `updateManyPayoutStatus` (`booking.repository.js:250`)** — adding it would be defence in depth, not a fix for a live hole. |
| HARDEN-003 | `resolveNoShow` performs multiple writes with no transaction | S3.2 / S3.2a | Settlement is atomic and resumable: `claimSettlementResume` (`booking.repository.js:303`), state-driven sweep with no time cutoff, `refund-noshow-${bookingId}` idempotency key |
| HARDEN-004 | No per-folder role authorization on uploads (KYC bucket writable by any user) | S4.4 | `FOLDER_ROLES` in `upload.service.js`; `tests/integration/upload-role-matrix.test.js`. **This was the stated `PHASE_15F` gate — it is closed.** |
| HARDEN-005 | `NODE_ENV` defaults to development; dev secrets fall back silently | earlier hardening | `env.config.js:99-114` refuses to boot in production with placeholder JWT secrets |
| HARDEN-006 | Mock payment provider cannot simulate a failed webhook | earlier hardening | `mock.provider.js:58` — `status: payload.status \|\| 'paid'` |
| HARDEN-007 | Swagger path-prefix inconsistency (`/api/v1` doubled) | earlier hardening | `npm run validate:openapi` → 137/137, 0 structural problems |
| HARDEN-009 | `QueryBuilder.select()` can expose `select:false` fields | earlier hardening | `SENSITIVE_FIELD_DENYLIST` in `QueryBuilder.js:13` |
| HARDEN-014 | Safety module unbuilt; `isFrozen` read but never written | Product Decision P1 | Scaffolding deleted; module intentionally not built |

---

## Product decisions (settled — do not re-litigate)

| ID | Decision |
|---|---|
| P1 | Safety module — **not built**; `isFrozen` scaffolding deleted |
| P2 | Unwired `ReliabilityEvent` model — **deleted**. Stylist reliability *scoring* is live and untouched |
| P3 | Subscription proration — **not implemented**; spec amended to match code |
| P4 | `Subscription.status: 'past_due'` — **removed** from the enum |
| P5 | `REQUEST_STATUS.DECLINED` — **kept**; verified in active use (`request.service.js:308`) |
| P6 | `ACCOUNT_STATUS` `blocked` vs `suspended` — kept distinct |
| P7 | Socket.IO / realtime — **claims removed**; chat is Firestore, push is FCM |
