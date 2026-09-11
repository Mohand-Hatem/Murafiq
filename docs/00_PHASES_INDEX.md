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
| 14.5 | `HARDENING_08_WARDROBE_AI_READINESS.md` | Wardrobe security/cost/attribute hardening — **blocks all of Phase 15** | 14 |
| 15 | `PHASE_15_AI_SKELETON.md` | **AI Stylist — overview & architecture only. Do not implement from this file.** | 5, 14, 14.5 |
| 15A | `PHASE_15A_DATA_MODEL_RETRIEVAL.md` | Data model + retrieval primitives (no AI calls) | 14.5 |
| 15B | `PHASE_15B_STYLIST_PIPELINE.md` | Core stylist pipeline + scope guard (Flow A, text) | 15A |
| 15C | `PHASE_15C_IMAGE_INPUT.md` | Direct image input in chat (Flow B) | 15B |
| 15D | `PHASE_15D_FASHION_KNOWLEDGE_RAG.md` | Fashion knowledge base (the only RAG) | 15C |
| 15E | `PHASE_15E_EXTERNAL_PRODUCT_SEARCH.md` | Grounded external product search — **end of original V1** | 15D |
| 15F | `PHASE_15F_VIRTUAL_TRY_ON.md` | Shape Model + Virtual Try-On (image **generation**) | 15E, **HARDEN-004**, provider go/no-go spike |
| 16 | `PHASE_16_DEPLOYMENT_READINESS.md` | Final review, env checklist, deployment prep | 13, 15 |

> **Before starting Phase 16, also read
> [`hardening/POST_PHASE_15_HARDENING_BACKLOG.md`](hardening/POST_PHASE_15_HARDENING_BACKLOG.md)** —
> the post-Phase-15 hardening backlog. It documents 14 verified issues left deliberately
> unresolved after the pre-Phase-15 audit fix pass and must be reviewed again before
> production deployment.

> **Before resuming Phase 15, read
> [`AUDIT_2026_09_FULL_SYSTEM.md`](AUDIT_2026_09_FULL_SYSTEM.md)** — a full
> Phase-0-to-15 audit (2026-09-11) covering all source, all 68 docs, cross-phase
> consistency, concurrency and Phase 15 readiness. It records **6 P0 defects that the
> passing test suite does not catch** — including a stylist no-show that never refunds
> the client, a moderation enforcement gate that can never fire, and an inoperative OTP
> lockout. Verdict: **⚠️ continue with fixes**; close P0 before Phase 15 code or any
> deployment. It also re-verifies all 14 `POST_PHASE_15_HARDENING_BACKLOG` items —
> **none has been fixed**.

> **Not a phase — see `REVISION_BUSINESS_RULES_AND_ARCHITECTURE.md`.** A cross-cutting revision of business rules (subscriptions/entitlements, financial ledger, request/offer lifecycle, cancellation & no-show policy, chat moderation, coupons, stylist reliability) is specified in `REVISION_BUSINESS_RULES_AND_ARCHITECTURE.md`, with `REVISION_HANDOFF.md` as its implementation brief.
>
> It is **deliberately not numbered as Phase 17.** The `PHASE_XX` files are a build sequence that adds modules in dependency order; the revision instead *changes rules across modules that are already built* — the same role the `HARDENING_*` docs play. Its internal stages are labelled `R0`–`R12`.
>
> **It does not wait on Phases 14, 15, or 16.** It revises Phases 1–13 (built), hands two entitlement keys forward to Phases 14 and 15 to enforce when they are built, and is orthogonal to Phase 16. It can run now, in parallel with or ahead of them.

> **Phase 15 Note — rewritten 2026-09-09.** The original `PHASE_15_AI_SKELETON.md` specified
> an item-centric pairing tool plus eight marketplace concierge stubs on a
> LangChain/LangGraph + OpenAI + Pinecone stack. **None of that is the decision any more.**
> The file is now an architecture overview; the work lives in `PHASE_15A`–`PHASE_15E`, which
> follow the one-file-at-a-time rule below. `HARDENING_08` must complete first — it closes an
> SSRF hole, an unbounded cost path, and a silent data-corruption class that Phase 15 would
> otherwise amplify.
>
> Locked decisions (do not re-litigate mid-implementation): **one model**
> (`gemini-3.1-flash-lite`) for every AI task; **no LangChain, no LangGraph**; wardrobe
> retrieval is a **Mongo slot query**, not vector search; **one** RAG corpus (fashion
> knowledge); **strictly stylist-scoped** behind a scope guard; **image input yes, image
> generation no**.
>
> **Amendment 2026-09-10 — `PHASE_15F` added.** The last of those locked decisions ("image
> generation no") is **superseded**: virtual try-on ships as `PHASE_15F_VIRTUAL_TRY_ON.md`.
> Every other locked decision above stands. 15F is additive — it changes nothing in 15A–15E,
> adds no new orchestration framework and no new vector store, and is gated on **HARDEN-004**
> (upload role authorization) plus a provider quality spike that is a genuine go/no-go.
> Because generated images cost 17–34× a text request, its quota is **monthly**, not daily.

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
