# Phase 15F — Shape Model + Virtual Try-On

> Read `PHASE_15_AI_SKELETON.md` first for the locked architectural decisions.
> **Status:** ⛔ Not started. **Blocked by** `HARDEN-004`, a Step 0 provider spike, and
> (for the optional chat CTA only) `PHASE_15B`.
>
> **This phase formally reverses the locked decision "image generation: NOT in V1."**
> See "Amendment" below. It is an approved, dated amendment — not a silent edit and not a
> re-litigation of the other locked decisions, all of which stand unchanged.

## Goal

Let a client store one **Shape Model** — a full-body photo of themselves — and then generate
an image of *that specific person* wearing garments they select, sourced from their Murafiq
wardrobe, from images they upload, or a mix of both.

- *[selects a shirt and trousers from the wardrobe]* → an image of themselves wearing them.
- *[uploads a photo of a jacket seen in a shop]* → an image of themselves wearing it.

This is **additive**. It does not modify the stylist pipeline, the scope guard, the intent
extraction, the composition step, or the `Outfit` record. It adds a parallel, user-initiated
endpoint that shares only the upload pipeline, the entitlement service, and BullMQ.

## Depends on

| # | Dependency | Kind | Why |
|---|---|---|---|
| P0 | **Provider quality spike** (Step 0) | **Go/no-go gate** | The chosen provider is a general image model composing a try-on, not a purpose-built one. Fidelity is unverified |
| P1 | **HARDEN-004** — per-folder upload role authorization | **Hard blocker** | Without it, any authenticated user can `POST /uploads/shape-models`. `uploadFile(user, …)` currently ignores `user` entirely |
| P2 | Upload privacy generalized beyond KYC + per-user `public_id` namespacing | **Hard blocker** | Body images must be `authenticated` at rest; ownership-from-reference needs a `<userId>` path segment |
| P3 | `HARDENING_08` Step 3 (`AI_MODEL_*` env) and Step 8 (worker split) | Strong | Model IDs are hardcoded today; image jobs are far heavier than wardrobe classification and should not share the API event loop |
| P4 | `PHASE_15A` / `PHASE_15B` | **Optional only** | Needed *only* for the Step 7 chat CTA. V1 of this phase ships endpoint-only |

**`HARDEN-009` is deliberately not a dependency** — see "Why a separate collection" below.

---

## Amendment to the locked decisions (2026-09-10)

`PHASE_15_AI_SKELETON.md` locked **"Image generation — NOT in V1"**, and `PHASE_15C`'s
Definition of Done asserts *"No image-generation code, dependency, queue or quota key
exists."* Both were correct for the V1 scope as approved on 2026-09-09.

This phase supersedes that single decision, on the following record:

- The deferral was explicitly **costless and reversible** by design —
  `PHASE_15_AI_SKELETON.md:233-236` states image generation, if built, "touches nothing in
  the pipeline." That prediction holds: nothing in 15A–15E changes.
- The requested feature is a **superset** of what was deferred. The deferred item renders
  *garments* from a persisted `Outfit`. This renders *a real person's body wearing garments*,
  accepts garments **not in the wardrobe at all**, and requires **no `Outfit` record**.
- Every other locked decision stands: one model family, one provider, no LangChain/LangGraph,
  Mongo slot retrieval, one RAG corpus, strictly stylist-scoped.

**What does not change:** `Outfit` still has **no** `visualizationUrl` (15A). Try-on results
live in their own `TryOnGeneration` collection, because a generation is not a property of an
outfit — it may have no outfit at all.

---

## The core idea: a deterministic, user-initiated, pre-billed job

Every other expensive branch in Phase 15 is deterministically gated. This one is more so,
because it is the most expensive operation in the product.

**Try-on is never a model tool-call.** The client picks garments in the UI, so no natural
language parsing is needed to identify them. Two reasons this is structural, not stylistic:

1. **Cost safety.** One try-on costs 17–34× one text stylist request. Letting the model
   decide to spend that is a cost-control hazard.
2. **Injection surface.** `PHASE_15B`'s defence is that `responseSchema` makes a wrong answer
   *unrepresentable*. A model-invokable action that spends money re-opens exactly that.

Consequently **no free-text prompt from the user reaches the provider.** The generation
prompt is a server-side versioned constant. The only user-authored input is images.

---

## Flow

```
POST /uploads/shape-models          → PRIVATE (authenticated), public_id
                                       murafiq/shape-models/<userId>/<uuid>
POST /ai/shape-model { imageRef, consent }
        │  validate: Cloudinary host + <userId> segment === req.user.id
        ▼
   ShapeModel   (exactly one active per user)

POST /ai/try-on { garments: [ {source:'wardrobe', itemId}
                            | {source:'upload',   imageRef} ] }
        │
  ┌─────┴──────  DETERMINISTIC PRE-FLIGHT — no model call, no cost  ──────┐
  │ 1. active ShapeModel exists?                            → 409         │
  │ 2. every garment owned by the caller?                   → 403 / 404   │
  │ 3. consume ai.tryOn.monthly, else ai.tryOn.trial.lifetime → 429       │
  │ 4. deterministic jobId already present? → return it, do not re-bill   │
  └─────┬──────────────────────────────────────────────────────────────────┘
        ▼
  TryOnGeneration { status: 'pending' }   ──→  202 { generationId }
        │
   BullMQ 'tryon-generation'   attempts: 2, exponential backoff
        ▼
  imageGenerationProvider.generateTryOn({ personImage, garmentImages[], promptVersion })
        │
   success ─→ upload result PRIVATE, status 'done'
   terminal failure ─→ status 'failed', refundQuota()
        ▼
  GET /ai/try-on/:id  →  { status, resultUrl }   ← short-TTL signed, owner only
```

**The load-bearing property:** every gate runs *before* the queue and *before* any spend. No
provider call is reachable for an unowned garment, a missing Shape Model, an exhausted quota,
or a duplicate submission.

---

## Why a separate collection, not a `User` sub-document

`QueryBuilder.select()` passes `req.query.fields` straight to Mongoose, which **overrides
`select: false`** — the deferred item **HARDEN-009**
(`hardening/SENSITIVE_FIELD_PROJECTION.md`).

If the Shape Model lived on `User`, `GET /admin/users?fields=shapeModel` would expose
clients' body images to any admin or operator, and HARDEN-009 would become a hard blocker for
this phase. A separate collection is not reachable through the `User` query path at all.

Secondary: it matches the AI module's per-user-document precedent (`StylePreference`, 15A);
lifecycle fields live somewhere without bloating `User`; `User` stays the identity record.

> **Do not move `shapeModel` onto `User` "for convenience" later.** Doing so silently
> re-introduces HARDEN-009 as a body-image disclosure.

---

## Provider

Behind an interface and a factory, following `payments/providers/provider.factory.js`
(including its misconfiguration throw, but **without** its `initialize`/`initializePayment`
method-name drift).

| | Gemini image *(V1)* | Vertex AI `virtual-try-on-001` *(fallback)* |
|---|---|---|
| Fit | General multi-reference composition — Shape Model as character reference, garments as object references | **Purpose-built** person + product try-on |
| Cost | `gemini-3.1-flash-lite-image` **$0.0336**/img; `gemini-3.1-flash-image` $0.045 (0.5K) / $0.067 (1K) | Unverified |
| Auth | **Already-installed `@google/genai`, already-configured `GEMINI_API_KEY`** | **GCP service-account** — new credential type and SDK surface |
| Refs | Up to 14 (10 objects + 4 characters) | Multiple products per request |

Ship on Gemini image. If Step 0 fails, Vertex becomes a second implementation of the same
interface plus env config — **not a rewrite**. All Gemini image outputs carry a **SynthID**
watermark; this is expected and should be surfaced in product copy.

---

## Entitlements

A daily quota **cannot** bound this cost. The arithmetic, at `client.basic`
(50 EGP ≈ $1.00/month):

| | Cost |
|---|---|
| One text stylist request | ~$0.0020 |
| **One try-on** | **$0.0336 – $0.067** — 17–34× |
| 1/day for a month | **~$1.01 — underwater on its own** |
| 5/month | ~$0.17 — viable alongside the ~$0.60/month text spend |

Note this **inverts** `PHASE_15C` Step 8's reasoning, which correctly says
`ai.imageMessages.daily` is "not a cost necessity." For image *output* it is.

| Key | Free | Basic | Mid | Pro | Enterprise |
|---|---|---|---|---|---|
| `ai.tryOn.monthly` | **0** | 5 | 15 | 30 | 75 |
| `ai.tryOn.trial.lifetime` | **1** | 0 | 0 | 0 | 0 |

Consumption order: `ai.tryOn.monthly` first; on 429, fall back to `ai.tryOn.trial.lifetime`;
if both fail, 429.

**No schema change is required.** `UsageCounter` is keyed `{subjectId, metric, periodKey}`
where `periodKey` is an opaque `String`:

| Granularity | `periodKey` | TTL |
|---|---|---|
| `.daily` *(existing)* | `"2026-09-10"` | 40 days |
| `.monthly` *(new)* | `"2026-09"` via the existing `getBusinessMonthRange` | ~400 days |
| `.lifetime` *(new)* | `"lifetime"` | **none** |

`consume()` derives the resolver from the **metric-name suffix**, which every existing key
already carries. The atomic upsert, the unique index, and the E11000→429 path are untouched.

> ⚠️ **Free tier must carry `ai.tryOn.monthly: 0` explicitly.** `consume()` returns
> `{ success: true, limit: Infinity }` for an `undefined` metric — an omitted key means
> *unlimited*, not zero. Use `consume()`, never `capacity()`: `capacity()` coerces `0 → 1`.

---

## Security

| Risk | Control |
|---|---|
| SSRF via a clothing "URL" | **There is no URL input.** Uploads only, through 15C's existing `ai-chat` path, its Cloudinary-host check and its ownership-from-reference validator. **No new image-input path is created** |
| Anyone writing to `shape-models` | **HARDEN-004** — per-folder role authorization. Hard prerequisite |
| Cross-user Shape Model | Resolved server-side from `req.user.id` only — **never accepted as a request parameter** |
| Cross-user garment | `wardrobeService.getWardrobeItemById(userId, itemId)` is ownership-scoped by construction |
| Body image readable by raw URL | `type: 'authenticated'` + `access_mode: 'authenticated'`; served only via short-TTL signed URLs |
| Admin field-projection leak | Avoided structurally — separate collection, not `User` (HARDEN-009) |
| Prompt injection | No user free-text reaches the provider. The prompt is a server-side versioned constant |
| Duplicate / replay billing | Deterministic `jobId` |

## Privacy

- **Owner-only, always.** No endpoint returns another user's Shape Model or generated image —
  not to stylists, not to admins. There is **no admin view of body images**, deliberately.
- **Private at rest**, short-TTL signed URLs on read.
- **Consent is recorded** (`consentAt`) because the body image is transmitted to a
  third-party provider, consistent with the cross-border reasoning already established in
  `REVISION_MODERATION_CLASSIFIER_GATE.md` §3.
- **Retention:** generated results persist until the client deletes them. Explicit `DELETE`
  endpoint; purged on account deletion (an explicit hook — `User` is soft-deleted).
  Temporary uploaded garments follow 15C's existing `imageExpiresAt` sweep. The Shape Model
  persists until replaced or deleted.
- **Never logged.** `PHASE_15B` Step 10's rule — no raw images, no Cloudinary URLs — extends
  here unchanged.

---

## Business rules

1. A Shape Model is **optional** for the product but **required** for try-on — `409` with a
   clear "upload a Shape Model first" when absent.
2. **Exactly one active** Shape Model per client; a new upload replaces it and destroys the
   previous Cloudinary asset.
3. Garments may come from the wardrobe, from client uploads, **or a mix**. A wardrobe is
   **not** a prerequisite.
4. A client can never use another client's Shape Model, garments, or results.
5. Generated images belong to the requesting client.
6. Quota is consumed **before** work begins; a **terminal** failure refunds it; retries never
   double-charge.
7. Duplicate submissions (same inputs, same prompt version) return the existing generation.
8. Try-on is **client-role only** (`restrictTo('client')`), matching wardrobe.
9. A try-on **never** creates a `WardrobeItem` and **never** consumes `wardrobe.photos.max`.

Deliberately **not** added: no approval workflow, no sharing, no public gallery, no stylist
visibility. None is required by the brief, and each adds privacy surface.

---

## Steps

### Step 0 — Provider quality spike ⚠️ go/no-go, before anything else
Determine whether `gemini-3.1-flash-lite-image` / `gemini-3.1-flash-image` produce acceptable
fidelity — identity preservation, garment accuracy, multi-garment outfits — from a person
reference plus garment references. Throwaway script, **not committed**; ~20 sample outputs
across body types, single vs multi-garment, and garment categories. Output a written go/no-go
with a chosen model ID and resolution. **If it fails, Step 3's interface absorbs Vertex
`virtual-try-on-001` instead and P3 grows to include GCP service-account credentials.**

### Step 1 — Upload privacy + role gating *(P1, P2)*
`src/modules/uploads/upload.service.js`, `upload.routes.js`, `multer.middleware.js`.
Introduce `PRIVATE_FOLDERS = { 'kyc-documents', 'shape-models', 'try-on-results' }` and
replace the `isKyc` ternary. Add the two new folders to `ALLOWED_FOLDERS`. Namespace
`public_id` as `murafiq/<folder>/<userId>/<uuid>`. Generalize `getSignedKycUrl` →
`getSignedUrl(publicId, ttl)` — currently dead code with zero call sites. Enforce a
folder→roles map using the `user` argument the service already receives.

### Step 2 — Entitlement period granularity
`entitlement.service.js`, `plan.constants.js`. Derive the period resolver from the metric
suffix; `.lifetime` sets **no** `expiresAt`. Add both keys to every plan **and** to
`FALLBACK_FREE_ENTITLEMENTS`. No migration.

### Step 3 — Image-generation provider seam
New: `src/modules/ai/providers/image-generation.interface.js`, `gemini-image.provider.js`,
`mock-image.provider.js`, `image-provider.factory.js`. Env: `AI_IMAGE_PROVIDER` (`z.enum`),
`AI_MODEL_IMAGE`, `AI_IMAGE_RESOLUTION`. Interface:
`generateTryOn({ personImage, garmentImages, promptVersion })` → `{ buffer, mimeType, usage }`.

### Step 4 — Shape Model
New: `src/modules/ai/shape-model/` — model, repository, service, controller, routes,
validator, swagger, dto. Partial unique index on `{ userId, status: 'active' }`; replace
destroys the prior asset; `consentAt` recorded.
`POST` / `GET` / `DELETE /ai/shape-model`.

### Step 5 — Try-on generation pipeline
New: `src/modules/ai/try-on/` — `try-on-generation.model.js`, repository, service,
`garment-resolver.js`; `src/jobs/queues/tryon.queue.js`,
`src/jobs/workers/tryon-generation.worker.js`.
Deterministic `jobId` = hash(userId + shapeModelId + sorted garment refs + promptVersion).
`attempts: 2` — deliberately lower than the wardrobe queue's 3, because each retry costs real
money. Quota consumed pre-enqueue; refunded on terminal failure only. Result uploaded to the
private `try-on-results` folder.

> The wardrobe queue has **no** `jobId` today, so duplicate jobs are possible there. Do not
> copy that pattern here.

### Step 6 — API surface
New: `ai.routes.js`, `ai.controller.js`, `ai.validator.js`, `ai.swagger.js`; mount `/ai` in
`src/routes/index.js` — **the first `/ai` mount in the project**.
`POST /ai/try-on` → `202 { generationId, status }` · `GET /ai/try-on/:id` → status + signed
`resultUrl` · `GET /ai/try-on` → the caller's generations, paginated ·
`DELETE /ai/try-on/:id`. All `authMiddleware` + `restrictTo('client')`, Zod `.strict()`.

### Step 7 — Chat CTA *(optional; only once 15A/15B have landed)*
Link `TryOnGeneration.conversationId` / `outfitId`; surface a **"Try this on"** action on a
stylist recommendation that posts the recommended `itemIds` to the same endpoint. A UI
affordance — **still user-initiated, never a model tool-call.**

---

## Definition of Done

- [ ] **Step 0's go/no-go is written down**, with sample evidence and a chosen model ID.
- [ ] A client cannot upload to `kyc-documents`, `portfolio`, or another user's namespace (`403`).
- [ ] A private asset is **not** fetchable by raw Cloudinary URL; a signed URL works and expires.
- [ ] Monthly counters roll at the `Africa/Cairo` month boundary; the lifetime counter never expires and never resets; **every existing `.daily` metric behaves identically to before**.
- [ ] `ai.tryOn.monthly: 0` on the free tier yields `429` — **not** unlimited.
- [ ] The mock image provider is selected **only** under `NODE_ENV=test`; a non-test deploy configured to mock **throws at boot**.
- [ ] `@google/genai` is imported **nowhere** outside `src/modules/ai/providers/`.
- [ ] Shape Model upload / replace / delete work; replacing leaves **exactly one** active document and destroys the prior asset.
- [ ] A Shape Model response carries a short-TTL signed URL, **never** a raw Cloudinary URL.
- [ ] An `imageRef` outside the caller's own namespace, or on a non-Cloudinary host, is rejected `400`.
- [ ] An unowned garment is rejected **before any provider call** appears in the trace.
- [ ] An over-quota request is rejected **before enqueue**.
- [ ] A duplicate submission returns the existing generation and bills **once**.
- [ ] A forced provider failure marks `failed` **and refunds quota**.
- [ ] **IDOR suite** (following `tests/integration/payout.authorization.test.js`): user B receives `403`/`404` on user A's Shape Model and on every one of user A's generations.
- [ ] No raw image URL appears in any log line.
- [ ] `Outfit` still has **no** `visualizationUrl` field.
- [ ] Still **no** LangChain, LangGraph, second text provider, or new vector store in `package.json`.
- [ ] Swagger renders and `npm run validate:openapi` passes.
- [ ] `npm run verify` green (lint + OpenAPI + full Jest suite).

---

## Risks

1. **Fidelity (highest).** Gemini does try-on via general composition, not a purpose-built
   pipeline. Step 0 is a real gate, not a formality.
2. **Unit economics are thin.** ~$0.034–$0.067 per generation against $1.00/month basic
   revenue, on top of ~$0.60/month text spend. **Loosening the quotas above makes the basic
   tier unprofitable.**
3. **Body imagery is the most sensitive media in the product** — arguably more so than KYC,
   which at least has a regulatory frame to lean on. The owner-only, no-admin-view posture
   should not be relaxed for convenience.
4. **Worker contention.** Image jobs are much heavier than wardrobe classification, and the
   worker currently shares the API process (`server.js:29`). `HARDENING_08` Step 8 should
   land first.
5. **Reversal discipline.** This document is the record of the amendment. If the feature is
   dropped, the amendment section must be retracted here rather than left implying image
   generation is in scope.
