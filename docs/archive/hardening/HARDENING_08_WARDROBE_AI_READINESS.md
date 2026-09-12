# Hardening 08 — Wardrobe AI Readiness (prerequisite for Phase 15)

> **Status:** ⛔ Not started.
> **Type:** Hardening pass on an already-built module (Phase 14), not a new phase — same
> role as `HARDENING_01`–`HARDENING_07`.
> **Must complete before any `PHASE_15*` work begins.** Phase 15 amplifies every defect
> listed here.

## Goal

Make the Phase 14 wardrobe pipeline safe, cost-controlled and attribute-complete enough to
build the AI Stylist on top of. Nothing here adds a user-facing feature — it closes two
security/cost defects, fixes a silent data-corruption class, and adds the garment attributes
the stylist needs in order to reason.

## Depends on

Phase 14 (built). No dependency on Phase 15.

---

## Context — why each item is here

Phase 14 shipped and works, but five things in it fail loudly or expensively once an AI
stylist reads from it:

1. `POST /wardrobe` accepts an arbitrary client-supplied `imageUrl`, and the worker
   `fetch()`es it server-side with no host allowlist, no timeout and no size cap. That is
   SSRF, and also a way to make Murafiq pay Gemini to classify arbitrary internet images.
   Flagged in `HARDENING_07_PHASE_RECONCILIATION.md` §1, still open.
2. `wardrobe.photos.max` is defined in every plan but `entitlement.service.js:129-131`
   hardcodes `used = 0`, so uploads are unlimited — each one costing a vision call.
3. `pattern`, `formality`, `season` and `material` are free strings in Mongo. A model that
   writes `"Formal"` instead of `"formal"` silently removes that item from every filtered
   query. No error, no log — the item simply stops existing for retrieval. This breaks the
   stylist's primary retrieval path.
4. The classifier prompt-begs for JSON then regex-extracts it, hardcodes
   `mimeType: 'image/jpeg'` while uploads allow png/webp, and stores no confidence, model ID
   or prompt version — so a prompt change means re-classifying every item at full cost, with
   no way to target the stale ones.
5. `category: 'top'` cannot distinguish a t-shirt from a dress shirt. That distinction is the
   difference between `casual` and `business`, and without it the stylist cannot answer a
   formality question correctly.

---

## Steps

### Step 1 — Close the image-fetch hole

**Files:** `src/modules/wardrobe/wardrobe.validator.js`, `wardrobe.service.js`,
`src/modules/uploads/upload.service.js`, `src/config/gemini.config.js`

1. `POST /wardrobe` stops accepting a raw URL. It accepts an **internal upload reference**
   produced by `POST /api/v1/uploads/wardrobe`.
2. Namespace Cloudinary `public_id`s as `murafiq/wardrobe/<userId>/<uuid>` so ownership is
   verifiable **from the reference itself**, with no database lookup.
3. Validate on write: the reference must resolve to the configured Cloudinary cloud AND its
   `<userId>` segment must equal `req.user.id`. Reject anything else with `400`.
4. In the worker's fetch: 10 s timeout, 10 MB cap, and read the MIME type from the response
   `Content-Type` instead of hardcoding `image/jpeg`.

> **Why a reference and not a validated URL:** a URL allowlist is a string-matching problem
> that keeps being re-broken (open redirects, `@`-in-userinfo, DNS rebinding). A reference
> the server resolves itself has no attacker-controlled network target at all.

### Step 2 — Structured output for the classifier

**File:** `src/config/gemini.config.js`

Replace the "return ONLY valid JSON" prompt plus regex extraction with an enforced
`responseSchema` and `responseMimeType: 'application/json'`. The installed `@google/genai`
SDK supports this. Delete the regex at `gemini.config.js:71`.

### Step 3 — Single model, configurable

**Files:** `src/config/env.config.js`, `src/config/gemini.config.js`

1. Move from `gemini-2.5-flash` to **`gemini-3.1-flash-lite`** — current generation,
   multimodal, structured output, function calling, Google Search grounding, and *cheaper*
   than the model in use today ($0.25/$1.50 per 1M vs $0.30/$2.50).
2. Introduce `AI_MODEL_VISION` and `AI_MODEL_REASONING`, **both defaulting to the same ID**.
   One model in practice; the seam exists from day one so a future change is config, not code.
3. Remove the dead `OPENAI_API_KEY`, `VECTOR_DB_URL`, `VECTOR_DB_API_KEY` entries
   (`env.config.js:70-72`).

> Do **not** adopt `gemini-2.5-flash-lite` despite it being cheaper — it retires 2026-10-16.

### Step 4 — Constrain the enum fields

**File:** `src/modules/wardrobe/wardrobe-item.model.js`

Promote `pattern`, `formality`, `season`, `material` from free strings to **schema-level
enums**, using the vocabularies currently pinned only inside the Gemini prompt. Export them
as named constants beside `WARDROBE_CATEGORIES` so the validator, the classifier schema and
the dress-code constants all read from one source.

Add normalization (lowercase, trim, map) before write. Anything that does not map sets
`classificationStatus: 'needs_review'` instead of writing an unmatched value.

### Step 5 — Extend the garment schema

**File:** `src/modules/wardrobe/wardrobe-item.model.js` plus a backfill script

| Field | Type | Why |
|---|---|---|
| `subcategory` | String | t-shirt vs dress shirt — the casual/business distinction `category` cannot express. **Highest-value single addition** |
| `fit` | enum `slim/regular/relaxed/oversized` | Required by outfit composition |
| `colorFamily` | enum, normalized | `primaryColor` is free text ("Off-white", "Cream", "Ivory"); composition needs a normalized family to reason about pairing |
| `isNeutral` | Boolean, derived | Neutrals combine with anything — cheap, high-signal composition input |
| `genderPresentation` | enum `masculine/feminine/unisex` | Required by composition |
| `printedText` | String | Text visible on the garment. **Also a security control** — see `PHASE_15C` |
| `aiConfidence` | Number | Drives `needs_review` and targeted re-runs |
| `aiModel` | String | Which model produced this |
| `aiPromptVersion` | String | **Without this, any prompt change re-classifies everything at full cost** |
| `origin` | enum `upload/chat_save` | Set by `PHASE_15C`; default `upload` |
| `lastWornAt` / `wearCount` | Date / Number | Enables "you wore this on Tuesday" |
| `isArchived` | Boolean | Hide without deleting |

Add `'needs_review'` to the `classificationStatus` enum.
Add index `{ userId: 1, category: 1, formality: 1 }` for slot retrieval.

Write `scripts/backfill-wardrobe-attributes.js` — idempotent and re-runnable, per the
project's no-migrations convention (`REVISION_HANDOFF.md:20-23`).

### Step 6 — Enforce `wardrobe.photos.max`

**Files:** `src/modules/subscriptions/entitlement.service.js`,
`src/modules/wardrobe/wardrobe.service.js`

1. Replace the hardcoded `used = 0` at `entitlement.service.js:129-131` with a real
   `countDocuments`. Follow the documented cross-module exception at `AGENTS.md:41-46` —
   entitlement may import another module's model **for read-only capacity counts only**.
2. Call `capacity(userId, 'wardrobe.photos.max')` in `createWardrobeItem` before creating
   anything. Over cap rejects before the queue job is enqueued.
3. Downgrade behaviour is already specified: **grandfather existing photos, block additions,
   never auto-delete** (`BUSINESS_RULES.md:1007`).

### Step 7 — Reject placeholder secrets in production

**File:** `src/config/env.config.js`

`secret()` requires the variable in production but does not reject its *placeholder value*.
A copied `.env.example` therefore deploys a classifier returning a canned white t-shirt for
every photo, and an in-memory `Map` instead of a vector index — with no warning log.

Add a boot-time assertion: in production, if any secret equals its known dev default,
`process.exit(1)` with a clear message. Fail at boot, not silently at runtime.

### Step 8 — Split the worker out of the API process

**Files:** `ecosystem.config.cjs`, `src/server.js`

`server.js:29` starts the BullMQ worker with `concurrency: 5` inside the single PM2 fork —
five concurrent vision calls competing with request handling.

Add a second PM2 app running the worker only. **The API stays `instances: 1`** — the seven
`node-cron` sweeps have no distributed lock and would double-fire (`PHASE_16:36-44`).

### Step 9 — Reconcile the stale documentation

These files describe an AI stack that was never built and will actively mislead the next agent:

| File | What is wrong |
|---|---|
| `docs/ARCHITECTURE.md:28` | Says "LangChain + LangGraph + OpenAI + RAG (Pinecone/Qdrant)". None of that is the decision |
| `docs/ARCHITECTURE.md:26` | BullMQ marked "Planned (Phase 12)" — it shipped in Phase 14 |
| `AGENTS.md:73-77` | Commits to LangGraph and describes `/api/v1/ai/chat` returning 501. Neither is true |
| `docs/STATUS.md` | Self-contradictory: line 75 says Phase 14 is built, lines 221-224 say the directory does not exist, §9 (348-367) still names OpenAI/Pinecone |
| `docs/ROUTES.md:198-215` | All five wardrobe routes marked "🔲 Planned" though they shipped |
| `docs/archive/reviews/RECOMMENDED_SKILLS_ROADMAP.md:13,38` | Still says GPT-4o vision, Pinecone/Qdrant, 1536-dim embeddings |
| `docs/next-phase/PHASE_15_PRODUCT_BRIEF.md:40-57` | Open decisions 1, 2 and 4 are now resolved — mark them so |

---

## Definition of Done

- [ ] `POST /wardrobe` rejects any reference not resolving to a Cloudinary asset under the caller's own `userId` namespace (`400`), verified with both a foreign reference and an external URL.
- [ ] Worker fetch enforces timeout and size cap, and sends the real MIME type.
- [ ] Classifier uses `responseSchema`; the regex extraction is deleted.
- [ ] Model is `gemini-3.1-flash-lite` via `AI_MODEL_VISION`; dead OpenAI/vector env vars removed.
- [ ] `pattern`/`formality`/`season`/`material` are schema enums; an unmappable value produces `needs_review`, never a silent write.
- [ ] All Step 5 fields exist; the backfill script runs twice with no change on the second run.
- [ ] A free-tier client (limit 7) is rejected on the 8th upload, **before** a queue job is created.
- [ ] Booting in production with any placeholder secret exits non-zero with a clear message.
- [ ] `pm2 list` shows API and worker as separate apps; API remains `instances: 1`.
- [ ] Every file in Step 9 is corrected.
- [ ] Full Jest suite green. This touches entitlements, so `AGENTS.md`'s Verification Requirement applies: show passing output, not code inspection.
