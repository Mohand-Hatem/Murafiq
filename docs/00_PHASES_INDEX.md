# Murafiq — Phases Index

This is the master checklist. Each phase has its own file. Work through them **in order** — later phases assume earlier ones are done (models exist, event bus exists, auth middleware exists, etc).

Rule for every phase: **do not start writing code for a phase until the previous phase's "Definition of Done" checklist is fully checked.**

| # | File | Phase | Depends on |
|---|---|---|---|
| 0 | `PHASE_00_SETUP.md` | Project scaffolding & core infrastructure | — |
| 1 | `PHASE_01_AUTH.md` | Authentication (register/login/OTP/JWT) | 0 |
| 2 | `PHASE_02_USERS_VERIFICATION.md` | User profiles + Identity Verification | 1 |
| 3 | `PHASE_03_STYLISTS_SEARCH.md` | Stylist profiles + Search/Filter/Geo | 2 |
| 4 | `PHASE_04_REQUESTS_OFFERS.md` | Requests + Offers (accept/reject/expiry) | 3 |
| 5 | `PHASE_05_BOOKINGS_SCHEDULING.md` | Bookings (transactions) + Scheduling | 4 |
| 6 | `PHASE_06_PAYMENTS.md` | Payments (provider pattern, mock now) | 5 |
| 7 | `PHASE_07_CHAT_NOTIFICATIONS.md` | Realtime Chat (Firebase) + Notifications (Mongo/Socket.io) | 5 |
| 8 | `PHASE_08_REVIEWS.md` | Reviews & Ratings | 5 |
| 9 | `PHASE_09_UPLOADS_MAIL.md` | Cloudinary Uploads + Mail (Resend) | 0 (see note ↓) |
| 10 | `PHASE_10_AUDIT_ADMIN.md` | Audit Log + Admin module | 6, 7 |
| 11 | `PHASE_11_SAFETY_PAYOUTS.md` | Safety (SOS/check-in) + Payouts | 6 |
| 12 | `PHASE_12_BACKGROUND_JOBS.md` | BullMQ queues & workers | 9 |
| 13 | `PHASE_13_SECURITY_LOGGING_DOCS.md` | Security hardening, Winston/Morgan, Swagger, tests | 12 |
| 14 | `PHASE_14_WARDROBE.md` | Client wardrobe (closet) + AI photo classification/embedding indexing | 2, 9, 12 |
| 15 | `PHASE_15_AI_SKELETON.md` | AI assistant module (chat/tools/agent) — includes outfit-suggestion tool built on Phase 14's closet index | 5, 14 |
| 16 | `PHASE_16_DEPLOYMENT_READINESS.md` | Final review, env checklist, deployment prep | 13, 15 |

> **Phase 14 Note — deviation from the "AI stays a skeleton" rule:** Every other module before Phase 15 avoids AI dependencies entirely. Phase 14 is the one deliberate exception: the wardrobe feature is only useful if photos get classified and embedded automatically at upload time, so Phase 14 is where the vision/embedding SDK and vector DB client are actually installed and called for real (queued through Phase 12's BullMQ, not blocking the upload request). Phase 15 stays a conversational/orchestration layer on top of what Phase 14 already indexed — it does not duplicate the classification pipeline.

> **Phase 9 Note:** Phase 1 builds a minimal `mail.service.js` as a temporary shim (Resend directly, no provider abstraction). Phase 9 replaces it with the full provider-pattern implementation. The call signature — `send({ to, subject, html })` — **must stay identical** so Phase 9 is a drop-in replacement with zero changes to callers. After completing Phase 9, re-run Phase 1's OTP email tests to confirm the shim was replaced without breaking any auth mail flows.
>
> **Phase 0 Note (Swagger):** `swagger-jsdoc`/`swagger-ui-express` are installed and mounted at `/api/docs` in Phase 0. Phase 1's auth routes were retroactively backfilled with `@swagger` blocks in Round 2, and every phase from Phase 2 onward carries a mandatory Definition-of-Done requirement to include complete `@swagger` annotations as new routes are written. Phase 13's docs step is an audit/gap-fill pass, not the initial build.
>
> **Phase 7 Note (Chat):** Chat realtime runs on Firebase (Firestore + FCM via `firebase-admin`), not Socket.io/MongoDB — see `PHASE_07_CHAT_NOTIFICATIONS.md`. The Socket.io server bootstrapped in Phase 0 is used only for the separate Notifications system within the same phase file.

## How to use this with an AI coding assistant

**Read `02_PROJECT_RULES.md` first** — it defines the step-by-step, approval-gated process any AI assistant must follow while implementing these phases (present what/why/how, wait for explicit approval, then apply). This index only defines *order*; `02_PROJECT_RULES.md` defines *how* each step gets built.

Feed the assistant one phase file at a time. Recommended prompt pattern:

```
Read PHASE_0X_<name>.md fully.
Implement everything in its "Steps" section, in order.
Follow 01_PROJECT_STRUCTURE.md for file locations and naming.
Do not touch files belonging to modules from later phases.
When done, verify every item in "Definition of Done" and report status.
```

Do not paste multiple phase files into one session at once — this causes the assistant to jump ahead and build modules out of order, which breaks the event-bus dependencies described in `01_PROJECT_STRUCTURE.md`.
