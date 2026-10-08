# Murafiq — AI Subsystem, Virtual Try-On & Plan Entitlement Updates

> **Date:** October 2026  
> **Status:** Fully Implemented & Verified (100% Green Test Suite)  
> **Target Scope:** Virtual Try-On, AI Stylist Pipeline, Mobile Routes, Subscription Entitlements, Environment Configuration

---

## 1. Executive Summary

This document outlines the recent architectural improvements, business rule alignments, provider refactoring, and mobile contract enhancements applied across Murafiq's AI subsystem and Virtual Try-On infrastructure.

### Key Milestones Achieved
1. **Free Tier Try-On Quota Set to 0 (`client.free`):** Protected unit economics by strictly reserving GPU image generation for paying subscribers.
2. **Complete Removal of OpenRouter Provider:** Standardized Virtual Try-On exclusively on Google Gemini ("Nano Banana" / `gemini-3.1-flash-lite-image`) and `mock` (for offline testing).
3. **Sparse Wardrobe Invariant Guard (Wedding Look Fix):** Fixed the empty-outfit bug by guaranteeing complete outfit acquisition recommendations (`top`, `bottom`, `shoes`) when wardrobe items are insufficient.
4. **12 Dedicated Mobile AI Endpoints:** Delivered the complete mobile REST contract under `/api/v1/ai` for conversations, outfits, shape models, product search, and virtual try-ons.
5. **Configurable Runtime Environment Defaults:** Externalized optional try-on and shape model parameters (`AI_TRY_ON_PROMPT_VERSION`, `AI_SHAPE_MODEL_DEFAULT_FORMAT`, `AI_SHAPE_MODEL_MAX_BYTES`, `AI_IMAGE_RESOLUTION`) to simplify client payloads.

---

## 2. Update 1: Free Tier Virtual Try-On Quota Set to 0

### What Was Changed
- In [`src/modules/subscriptions/plan.constants.js`](file:///d:/JOBS/Test/Murafiq/src/modules/subscriptions/plan.constants.js):
  - Updated `CANONICAL_PLANS` for `client.free`: set `'ai.tryOn.trial.lifetime': 0` (was previously `1`).
  - Updated `FALLBACK_FREE_ENTITLEMENTS.client`: set `'ai.tryOn.trial.lifetime': 0`.
- In [`tests/unit/ai-tryon-entitlement.test.js`](file:///d:/JOBS/Test/Murafiq/tests/unit/ai-tryon-entitlement.test.js):
  - Updated assertions to enforce `0` trial try-ons for free tier accounts.
  - Added test verifying that free tier users calling `consumeTryOnQuota()` are immediately rejected with `429 Too Many Requests`.

### Why We Made It
- **Unit Economics Protection:** Each virtual try-on generation with Google's multimodal image model costs ~$0.0336 USD (~1.65 EGP). Allowing 1 free try-on per unregistered/free account creates an attack vector where bot farms and multi-account churn can exhaust API credits without contributing revenue.
- **Harmonization with Business Rules:** As outlined in [`docs/AI_MODELS_AND_SEARCH_ENGINE_GUIDE.md`](file:///d:/JOBS/Test/Murafiq/docs/AI_MODELS_AND_SEARCH_ENGINE_GUIDE.md#L253), the `Client Free` plan is budgeted for `0 try-ons`, keeping Customer Acquisition Cost (CAC) down to 1.22 EGP while driving upgrades to `client.basic` (50 EGP / 4 try-ons per month, +31.5% margin).

### User Experience
When a client on the free tier calls `POST /api/v1/ai/try-on`, the API responds:
```json
{
  "status": "fail",
  "message": "Virtual Try-On quota exceeded. Your try-on limit has been reached on the client.free plan. Upgrade your plan for additional try-ons."
}
```

---

## 3. Update 2: Complete Removal of OpenRouter (Sole Reliance on Gemini "Nano Banana")

### What Was Changed
- **Deleted OpenRouter Files:**
  - `src/modules/ai/providers/openrouter-image.provider.js`
  - `tests/unit/openrouter-image-provider.test.js`
- **Updated Provider Factory (`src/modules/ai/providers/image-provider.factory.js`):**
  - Removed OpenRouter import and resolution logic.
  - Restricted supported providers strictly to `gemini` and `mock`.
- **Environment Schema & Configuration (`src/config/env.config.js`, `.env.example`):**
  - Narrowed `AI_IMAGE_PROVIDER` to `z.enum(['gemini', 'mock']).default('gemini')`.
  - Removed `OPENROUTER_API_KEY`.
  - Updated `AI_TRY_ON_MODEL` default to `'gemini-3.1-flash-lite-image'`.
- **Gemini Try-On Model Resolution (`src/modules/ai/providers/gemini-image.provider.js`):**
  - Resolves model via `(env.AI_TRY_ON_MODEL || env.AI_MODEL_IMAGE || 'gemini-3.1-flash-lite-image').replace(/^google\//, '')`.

### Why We Made It
- **Single-Provider Architecture:** In Murafiq, "Nano Banana" refers to Google's Gemini Flash Image Lite (`gemini-3.1-flash-lite-image`). Routing calls through OpenRouter introduced third-party middleman latency, redundant rate-limiting, and extraneous token markups.
- **Security & Operational Simplicity:** Removing OpenRouter eliminates dead code, reduces third-party API token surface area, and ensures direct communication with Google's official GenAI SDK (`@google/genai`).

---

## 4. Update 3: Sparse Wardrobe Invariant Guard (Wedding Look Fix)

### What Was Changed
- In [`src/modules/ai/stylist/stylist.orchestrator.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/stylist/stylist.orchestrator.js):
  - Added an invariant consistency guard: if the model returns `sufficiency: 'partial'` but `outfits: []`, the orchestrator automatically reclassifies the response to `sufficiency: 'none'` and synthesizes complete outfit acquisition items (`top`, `bottom`, `shoes`).
- In [`src/modules/ai/stylist/compose.step.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/stylist/compose.step.js):
  - Strengthened system prompt rules forbidding partial sufficiency with zero wardrobe outfits.

### Why We Made It
- When a user requested formal wedding attire but had no suitable wardrobe pieces, the AI previously returned `outfits: []` alongside only a single pair of shoes under `suggestedToAcquire`. This resulted in broken user experiences where mobile apps had no outfit to display and the user was advised only to buy shoes without a suit or shirt.

---

## 5. Update 4: 12 Dedicated Mobile AI Endpoints

### What Was Changed
Mounted 12 first-class mobile endpoints under `/api/v1/ai` with complete OpenAPI/Swagger documentation and integration test coverage:

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/ai/conversations` | Initialize AI stylist chat conversation |
| `GET` | `/api/v1/ai/conversations` | List user's active/archived AI conversations |
| `GET` | `/api/v1/ai/conversations/:id` | Fetch conversation history and turns |
| `POST` | `/api/v1/ai/stylist` | Multi-turn chat message submission & outfit styling |
| `GET` | `/api/v1/ai/outfits` | List user saved and generated AI outfits |
| `GET` | `/api/v1/ai/outfits/:id` | Retrieve detailed AI outfit with populated items |
| `DELETE` | `/api/v1/ai/outfits/:id` | Delete/archive saved outfit |
| `POST` | `/api/v1/ai/shape-model` | Register client active 3D body shape model |
| `GET` | `/api/v1/ai/shape-model` | Get current active client shape model |
| `DELETE` | `/api/v1/ai/shape-model` | Deactivate client shape model |
| `POST` | `/api/v1/ai/try-on` | Submit virtual try-on background generation |
| `GET` | `/api/v1/ai/try-on` | List client try-on generations |
| `GET` | `/api/v1/ai/try-on/:id` | Fetch try-on generation result & signed Cloudinary image |
| `DELETE` | `/api/v1/ai/try-on/:id` | Delete try-on generation |
| `POST` | `/api/v1/ai/products/search` | Standalone Egyptian fashion store search |

### Why We Made It
Mobile clients require deterministic, decoupled REST resources to build dedicated screens for Shape Model management, Virtual Try-On history, and Saved Outfits without orchestrating complex chat turns client-side.

---

## 6. Update 5: Optional Environment Variables for Mobile Ergonomics

### What Was Changed
- Added optional environment configuration with production defaults:
  - `AI_TRY_ON_PROMPT_VERSION` (default: `'v1'`)
  - `AI_SHAPE_MODEL_DEFAULT_FORMAT` (default: `'jpg'`)
  - `AI_SHAPE_MODEL_MAX_BYTES` (default: `10485760` / 10MB)
  - `AI_IMAGE_RESOLUTION` (default: `'1024x1024'`)
- Updated validators and services to automatically apply these defaults when mobile clients omit technical metadata fields.

### Why We Made It
Mobile clients uploading shape models or requesting try-ons only need to supply the essential identifiers (`imageRef`, `consent`, `shapeModelId`), while backend defaults handle resolutions, formats, and byte thresholds transparently.

---

## 7. Master List of Updated & Removed Files

### Modified Files
- [`src/config/env.config.js`](file:///d:/JOBS/Test/Murafiq/src/config/env.config.js) — Removed OpenRouter schema, narrowed image provider enum to `['gemini', 'mock']`, added try-on env variables.
- [`.env.example`](file:///d:/JOBS/Test/Murafiq/.env.example) — Removed `OPENROUTER_API_KEY=`, added try-on defaults.
- [`src/modules/subscriptions/plan.constants.js`](file:///d:/JOBS/Test/Murafiq/src/modules/subscriptions/plan.constants.js) — Changed `ai.tryOn.trial.lifetime` to `0` for `client.free` and `FALLBACK_FREE_ENTITLEMENTS`.
- [`src/modules/ai/providers/image-provider.factory.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/providers/image-provider.factory.js) — Removed OpenRouter dispatch; supports `gemini` and `mock`.
- [`src/modules/ai/providers/gemini-image.provider.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/providers/gemini-image.provider.js) — Normalized model name resolution for Gemini Nano Banana.
- [`src/modules/ai/stylist/stylist.orchestrator.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/stylist/stylist.orchestrator.js) — Added sparse-wardrobe invariant consistency check.
- [`src/modules/ai/stylist/compose.step.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/stylist/compose.step.js) — Strengthened prompt rules against partial sufficiency without outfits.
- [`src/modules/ai/ai.routes.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/ai.routes.js) — Mounted mobile endpoints.
- [`src/modules/ai/ai.controller.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/ai.controller.js) — Implemented mobile handlers.
- [`src/modules/ai/ai.swagger.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/ai.swagger.js) — Documented mobile routes in OpenAPI.
- [`src/modules/ai/shape-model/shape-model.service.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/shape-model/shape-model.service.js) — Injected env defaults for format and byte size.
- [`src/modules/ai/try-on/try-on.service.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/try-on/try-on.service.js) — Injected env defaults for prompt version and resolution.
- [`tests/unit/ai-image-provider.test.js`](file:///d:/JOBS/Test/Murafiq/tests/unit/ai-image-provider.test.js) — Updated unknown provider error assertions.
- [`tests/unit/ai-tryon-entitlement.test.js`](file:///d:/JOBS/Test/Murafiq/tests/unit/ai-tryon-entitlement.test.js) — Updated plan expectations and free tier 0 quota rejection tests.
- [`docs/operations/PRODUCTION_DEPLOYMENT_READINESS.md`](file:///d:/JOBS/Test/Murafiq/docs/operations/PRODUCTION_DEPLOYMENT_READINESS.md) — Updated try-on deployment prerequisite keys.
- [`docs/next-phase/PHASE_15F_VIRTUAL_TRY_ON.md`](file:///d:/JOBS/Test/Murafiq/docs/next-phase/PHASE_15F_VIRTUAL_TRY_ON.md) — Updated quota matrix table.
- [`docs/next-phase/PHASE_15_POSTMAN_TESTING.md`](file:///d:/JOBS/Test/Murafiq/docs/next-phase/PHASE_15_POSTMAN_TESTING.md) — Updated quota walkthrough table.

### Deleted Files
- `src/modules/ai/providers/openrouter-image.provider.js`
- `tests/unit/openrouter-image-provider.test.js`

### Newly Added Files
- [`src/modules/ai/ai.dto.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/ai.dto.js) — DTO mappers for mobile responses.
- [`src/modules/ai/stylist/stylist-request.service.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/stylist/stylist-request.service.js) — Bridge service for mobile request handling.
- [`tests/integration/ai-mobile-routes.test.js`](file:///d:/JOBS/Test/Murafiq/tests/integration/ai-mobile-routes.test.js) — Integration tests for 12 mobile endpoints.
- [`docs/AI_TRY_ON_AND_FREE_TIER_UPDATES.md`](file:///d:/JOBS/Test/Murafiq/docs/AI_TRY_ON_AND_FREE_TIER_UPDATES.md) — This document.

---

## 8. Verification & Test Results

```bash
# 1. ESLint Check
npm run lint
# Result: Exit 0 — 0 errors

# 2. OpenAPI Route Synchronization
npm run validate:openapi
# Result: Exit 0 — 160/160 routes documented, 0 ghosts, 0 broken references

# 3. Virtual Try-On Entitlement & Quota Tests
npm test -- tests/unit/ai-tryon-entitlement.test.js
# Result: 1 passed, 15/15 tests passed

# 4. Virtual Try-On Core & Worker Tests
npm test -- tests/unit/ai-image-provider.test.js tests/unit/ai-tryon-service.test.js tests/unit/ai-tryon-worker.test.js tests/integration/ai-tryon-routes.test.js
# Result: 4 passed, 61/61 tests passed

# 5. Mobile AI Routes Integration Tests
npm test -- tests/integration/ai-mobile-routes.test.js
# Result: 1 passed, 25/25 tests passed

# 6. Full Repository Test Suite
npm test
# Result: 199 passed, 199 total suites, 1,773/1,773 tests passed
```
