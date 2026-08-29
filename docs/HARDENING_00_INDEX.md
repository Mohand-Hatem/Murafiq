# Murafiq — Hardening Index

This is the master checklist for the remediation pass that follows the codebase audit. It is the
`00_PHASES_INDEX.md` equivalent for repair work rather than feature work.

**Every item in these documents is a correction to code already written in Phases 0–8.** None of it is
a new feature except where a missing piece makes an existing feature unusable (uploads, admin seed,
payouts).

## Order

Work through these **in order**. Later documents assume earlier ones landed — the dependencies are
real, not stylistic.

| # | File | Covers | Severity | Blocks deploy? |
|---|---|---|---|---|
| 1 | `HARDENING_01_CRITICAL.md` | Payment forgery, broken refresh-token, double-charge retry, double-booking race, proxy rate-limiting, admin bootstrap | **P0** | **Yes** |
| 2 | `HARDENING_02_CORRECTNESS.md` | Event-name collision, completion gate, Paymob billing data, refund ledger, atomic cancellation, timezone, Firestore rules, query bounds, real DB tests | **P1** | No |
| 3 | `HARDENING_03_SECURITY_PLATFORM.md` | Uploads/KYC pipeline, OTP brute-force, silent Firebase degradation, registration mail failure, admin audit trail, session handling, Swagger exposure | **P1 + P2** | No |
| 4 | `HARDENING_04_CLEANUP.md` | Dead code, logging consistency, validator consistency, search performance, DB pool config, lint | **P2** | No |
| 5 | `HARDENING_05_BUSINESS_GAPS.md` | Payouts (money out), dispute resolution, stylist cancellation policy, daily caps | **Product** | No — but the product is incomplete without it |
| 6 | `HARDENING_06_DOCS_TRUTH.md` | Correcting inaccurate status docs, adding missing README / data model / permissions / ops docs | **Docs** | No |
| 7 | `HARDENING_07_PHASE_RECONCILIATION.md` | Making Phases 9–16 executable: what hardening already delivered, what conflicts, what's broken in each phase doc | **Reference** | No |

### Scope note: repair vs. roadmap

Documents `01`–`06` are a **repair pass on Phases 0–8** (plus the missing pieces that break shipped
features: uploads, admin seed, audit log, payouts, disputes). They are **not** a replacement for the
remaining feature roadmap.

After finishing them you still have Phases 9 (mail), 11 (safety), 12 (background jobs), 14 (wardrobe),
and 15 (AI) to build — you'll just be building them on a foundation that works. **`07` is the bridge:**
read it before starting any phase from 9 onward, because several phase docs reference functions that
don't exist, use CommonJS in an ESM project, and duplicate work `01`–`06` now delivers.

### Critical ordering constraints

- **`01` before everything.** No point making the refund ledger correct (`02` Step 4) while forged
  webhooks can still write to it (`01` Step 1).
- **`02` Step 9 (real-database tests) before `05`.** The payouts ledger must not be built on a test
  suite that has never touched a real database.
- **`05` decisions before `05` code.** That document opens with decisions only the repo owner can make.
  Do not start implementing payouts before they are answered. **Read `07` Part 3 first** — most of
  `05`'s Section A is already answered in `PHASE_10`/`PHASE_11`; only four questions genuinely remain.
- **`06` last**, so the docs describe what actually shipped rather than what was intended.
- **`07` is a reference, not a step list.** It has no Steps section. Read the relevant section before
  starting a phase, not in sequence with the others.

## Process

Follow `02_PROJECT_RULES.md` exactly — it already defines the contract:

- One step at a time. Present **What / Why this solution not another / How** (full code, exact paths).
- Stop and wait for explicit approval before writing, editing, or running anything.
- No scope creep. If you spot something else worth fixing, raise it as a follow-up, don't fold it in.
- Walk the **Definition of Done** item by item before declaring a document complete, and state *how*
  each was verified (test run, curl, `db.collection.getIndexes()`). Never mark done from memory.

Feed **one hardening document per session**. Pasting several at once causes exactly the jump-ahead
problem `00_PHASES_INDEX.md` already warns about.

## Current state (audit baseline)

Established by direct verification, not by reading the docs:

- `npm test` → 19 suites / 127 tests pass — but all 8 "integration" suites mock every repository.
  **No test touches a real database.**
- `npm run lint` → **fails**, 2 errors / 22 warnings.
- Last commit: "Phase 7 & 8". Actual built scope is **Phases 0–8 plus a 4-route slice of Phase 10**.
- `modules/` contains `.gitkeep`-only directories for: `ai`, `audit-log`, `payouts`, `safety`,
  `uploads`. `jobs/queues` and `jobs/workers` are empty. There is no `wardrobe` module.
- `cloudinary`, `multer`, `bullmq`, and every AI/vector-DB package are **not installed**, despite
  `01_PROJECT_STRUCTURE.md` and `03_SKELETON_STATUS.md` marking several of them "Active".

> [!WARNING]
> **`docs/` and `AGENTS.md` are in `.gitignore`.** Every file in this folder — including this one and
> the entire phase spec — is untracked and will not survive a fresh clone. The only other copy is an
> untracked `docs.rar` in the repo root. **Fix this first** (`HARDENING_01_CRITICAL.md` Definition of
> Done covers it); everything else here is worthless if the plan itself isn't versioned.
