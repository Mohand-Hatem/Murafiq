# Phase 15E — External Product Search & Wardrobe Gap Closing (final V1 phase)

> Read `PHASE_15_AI_SKELETON.md` first for the locked architectural decisions.
> **Status:** ✅ **Complete & Verified (All 8 Steps Complete — END OF V1).**
> - **Step 1 (Entitlements):** `ai.productSearch.daily` active across all canonical plans (`client.free: 0`, `basic: 1`, `mid: 3`, `pro: 5`, `enterprise: 10`) with non-throwing `checkQuota` helper in `entitlement.service.js`. Tested in `tests/unit/ai-product-search-entitlement.test.js` (11/11 passing).
> - **Step 2 (LLM Grounding):** `complete()` in `llm.provider.js` supports `tools` parameter (e.g. `tools: [{ googleSearch: {} }]`) and extracts `groundingMetadata` from response candidates. Tested in `tests/unit/ai-llm-grounding.test.js` (2/2 passing) and regressions (19/19 passing).
> - **Step 3 (Product Search Service):** `src/modules/ai/products/product-search.service.js` with 24h Redis caching, citation extraction, and unit tests (`tests/unit/ai-product-search-service.test.js` 7/7 passing).
> - **Step 4 (Gap Analysis & Two-Suggestion Composition):** `src/modules/ai/stylist/compose.step.js` updated with Two-Suggestion Rule and concrete `gapDescriptions` formulation. Tested in `tests/unit/ai-gap-analysis.test.js` (8/8 passing).
> - **Step 5 (Response Rendering & Response Separation):** `src/modules/ai/stylist/render.step.js` updated with strict isolation between `fromYourWardrobe` and cited `suggestedToAcquire`, ungrounded fallback, and stylist booking CTA. Tested in `tests/unit/ai-product-render.test.js` (3/3 passing).
> - **Step 6 (Orchestrator Integration & Sequential Quota):** Integrated sequential quota gating into `stylist.orchestrator.js`, persisted external outfits (`source: 'external'`), and added `groundedQueriesCount` to `trace.logger.js`. Tested in `tests/unit/ai-orchestrator-product-search.test.js` (5/5 passing).
> - **Step 7 (OpenAPI Swagger Specification Update):** Documented `fromYourWardrobe`, `gapDescriptions`, and enhanced `suggestedToAcquire` in `ai.swagger.js`. Validated with `validate-openapi.js` (139 ops, 0 undocumented, 0 ghosts).
> - **Step 8 (Golden Dataset Suite 11 & Full System Regression):** Added Suite 11 (6 cases) to `golden-dataset.js` and `stylist-pipeline.eval.test.js`. 58/58 tests pass. Updated `docs/STATUS.md` (**END OF V1**).

## Goal

Close the loop when the client's wardrobe cannot produce a suitable outfit: identify the
missing item types, then find real, purchasable, **cited** products in the Egyptian market.

*"The wardrobe does not contain a sufficiently suitable combination — here is what you'd
need: navy formal trousers, a white dress shirt, a dark blazer, formal leather shoes"* —
followed by grounded links.

This is the last phase of V1. After it, Phases A→E deliver the complete product statement.

## Depends on

`PHASE_15D`.

---

## Locked Product-Suggestion Behavior

External Product Search is a **gap-closing mechanism**, never a replacement for wardrobe composition.

1. **Wardrobe is Always Checked First**:
   For every valid outfit request:
   - Analyze user intent.
   - Retrieve relevant wardrobe candidates.
   - Determine wardrobe sufficiency.
   - Attempt wardrobe-grounded outfit composition before any external search.
   - *Never* search external products before determining wardrobe suitability, except on explicit shopping queries (where wardrobe is still evaluated to reuse owned pieces).

2. **Sufficient Wardrobe (`sufficiency === 'good' / 'sufficient'`)**:
   - Return 2 distinct wardrobe outfit suggestions in `fromYourWardrobe[]`.
   - `suggestedToAcquire: []` must be strictly empty.
   - Zero `ai.productSearch.daily` quota consumed; zero Google Search Grounding calls.

3. **Partially Sufficient (`sufficiency === 'partial'`)**:
   - Return the best available wardrobe-grounded outfits in `fromYourWardrobe[]`.
   - Identify concrete missing garment types (*"navy formal trousers"*, not *"bottoms"*).
   - If user has paid quota: execute grounded search and populate `suggestedToAcquire[]` with 2 acquisition suggestions closing the gap.
   - If quota exhausted or free-tier: degrade gracefully to a template shopping list from fashion knowledge + `suggestBookStylist: true`.

4. **Completely Insufficient (`sufficiency === 'none'`)**:
   - Wardrobe cannot satisfy the request. `fromYourWardrobe: []` is empty.
   - Identify concrete missing items.
   - If user has paid quota: execute grounded search and return 2 distinct acquisition suggestions (e.g. Look A vs Look B).
   - If quota exhausted or free-tier: degrade gracefully to a template shopping list + `suggestBookStylist: true`.

5. **Two-Suggestion Rule**:
   - Target 2 distinct suggestions representing different aesthetic choices or price points.
   - Never fabricate or duplicate to fill count. If only 1 can be produced, return 1.

6. **Response Separation**:
   - Strict isolation between `fromYourWardrobe[]` (owned, anti-hallucination validated) and `suggestedToAcquire[]` (external, cited).
   - Owned and unowned items never merge into one list.

7. **Sequential Quota Gate**:
   - `ai.productSearch.daily`: 0 (free), 1 (basic), 3 (mid), 5 (pro), 10 (enterprise).
   - Evaluated after wardrobe sufficiency. Free-tier users never trigger Google Search Grounding.
   - Blocked search is a soft outcome (graceful degradation), not an HTTP error.

8. **Single Model / Zero Vendor Drift**:
   - Gemini 3.1 Flash Lite (`AI_MODEL_REASONING`) via `llm.provider.js` only.
   - Google Search Grounding tool.
   - No LangChain, no LangGraph, no external scraping.

---

## Implementation Steps

### Step 1 — Entitlements & Subscription Configuration (`ai.productSearch.daily`) ✅ COMPLETED & VERIFIED
**Files:** `src/modules/subscriptions/plan.constants.js`, `src/modules/subscriptions/entitlement.service.js`, `tests/unit/ai-product-search-entitlement.test.js`
- Added `ai.productSearch.daily` across all canonical plans (`client.free: 0`, `basic: 1`, `mid: 3`, `pro: 5`, `enterprise: 10`) and `FALLBACK_FREE_ENTITLEMENTS.client`.
- Added non-throwing `checkQuota(userId, metric, count, role)` in `entitlement.service.js`.
- Verified with 11/11 passing unit tests.

### Step 2 — LLM Provider Google Search Grounding Tool Support ✅ COMPLETED & VERIFIED
**Files:** `src/modules/ai/providers/llm.provider.js`, `tests/unit/ai-llm-grounding.test.js`
- Extended `complete()` to accept `tools` parameter (e.g. `tools: [{ googleSearch: {} }]`).
- Passed `tools` to Gemini config and extracted `groundingMetadata` (including `groundingChunks` with titles and URIs) from candidates.
- Verified with 2/2 unit tests and 19/19 existing regression tests.

### Step 3 — Product Search Service with 24h Redis Cache ✅ COMPLETED & VERIFIED
**Files:** `src/modules/ai/products/product-search.service.js`, `tests/unit/ai-product-search-service.test.js`
- `searchExternalProducts({ gapDescription, gapItems, occasion, formality, season, genderPresentation, locale, budget })`.
- Structured schema `PRODUCT_SEARCH_RESPONSE_SCHEMA` targeting up to 2 distinct suggestions with titles, descriptions, slot, itemType, estimatedPriceEgp, retailer, citations, and source URLs.
- 24-hour Redis caching via `computeCacheKey` (`ai:product-search:{season}:{gender}:{queryHash}`) with in-memory fallback.
- Fail-open resilience returning empty array if search fails, enabling graceful degradation.
- Verified with 7/7 unit tests passing.

### Step 4 — Gap Analysis & Two-Suggestion Composition Update ✅ COMPLETED & VERIFIED
**Files:** `src/modules/ai/stylist/compose.step.js`, `tests/unit/ai-gap-analysis.test.js`
- Updated prompt instructions and return mapping for the Two-Suggestion Rule (slices outfits to at most 2 distinct looks).
- On `sufficiency === 'partial'` or `'none'`, formulate concrete item gaps in `gapDescriptions` (*"navy formal tailored trousers"*, not generic *"bottoms"*).
- Added fallback synthesis when model outputs empty gap descriptions on partial/none.
- Verified with 8/8 passing unit tests.

### Step 5 — Response Rendering & Response Separation ✅ COMPLETED & VERIFIED
**Files:** `src/modules/ai/stylist/render.step.js`, `tests/unit/ai-product-render.test.js`
- Strictly isolated `fromYourWardrobe` (owned items) from `suggestedToAcquire` (external recommendations).
- Backwards-compatible `fromYourWardrobe` and `outfits` keys at top level.
- Formatted `suggestedToAcquire` with citations, retailer, and pricing when grounded.
- Provided fallback template shopping list when search is skipped or quota is blocked.
- Added human stylist booking CTA (`suggestBookStylist: true`) whenever `sufficiency !== 'good'`.
- Verified with 3/3 passing unit tests (8/8 in render suite).

### Step 6 — Orchestrator Integration & Sequential Quota Execution ✅ COMPLETED & VERIFIED
**Files:** `src/modules/ai/stylist/stylist.orchestrator.js`, `src/modules/ai/utils/trace.logger.js`, `src/modules/subscriptions/subscription.repository.js`, `tests/unit/ai-orchestrator-product-search.test.js`
- Executed wardrobe check first: if `sufficiency === 'good'`, 0 product search quota checked/consumed and 0 grounded searches run.
- If `sufficiency === 'partial'` or `'none'`, checked `checkQuota('ai.productSearch.daily')`.
- If quota available on paid tier: consumed 1 unit, called `productSearchService.searchExternalProducts`, persisted external Outfit record (`source: 'external'`).
- If quota blocked: degraded gracefully to template shopping list without throwing.
- Added `groundedQueriesCount` to trace logger for monthly free pool telemetry.
- Guarded `subscriptionRepository` against non-ObjectId mock strings.
- Verified with 5/5 passing unit tests.

### Step 7 — OpenAPI Swagger Specification Update ✅ COMPLETED & VERIFIED
**Files:** `src/modules/ai/ai.swagger.js`
- Documented `fromYourWardrobe` and `outfits` response keys.
- Documented `gapDescriptions` array and enhanced `suggestedToAcquire` schema with `itemType`, `title`, `description`, `estimatedPriceEgp`, `retailer`, `sourceUrl`, `sourceTitle`, `citations`, and `isGrounded`.
- Added `ai.productSearch.daily` to HTTP 429 quota documentation.
- Validated with `scripts/validate-openapi.js` (139 ops, 0 undocumented, 0 ghosts, 0 broken $refs, 0 structural problems).

### Step 8 — Golden Dataset Suite 11 & Full System Regression ✅ COMPLETED & VERIFIED
**Files:** `tests/ai/golden/golden-dataset.js`, `tests/ai/golden/stylist-pipeline.eval.test.js`, `docs/STATUS.md`
- Added `PRODUCT_SEARCH_CASES` (Suite 11) for partial and insufficient wardrobe queries in Arabic and English across free and paid tiers.
- Verified all 58 golden dataset evaluation tests pass cleanly in `stylist-pipeline.eval.test.js`.
- Verified 51/51 Phase 15 unit tests pass, ESLint 0 errors 0 warnings, OpenAPI 139 operations valid.
- Marked Phase 15 complete (**END OF V1**) in `docs/STATUS.md`.

---

## Definition of Done

- [x] A client whose wardrobe cannot cover a formal wedding receives concrete item types plus cited external products.
- [x] Results carry titles, descriptions and source links; citations are rendered.
- [x] `suggestedToAcquire[]` and `fromYourWardrobe[]` are **never** merged, in any response shape.
- [x] `ai.productSearch.daily` blocks at the boundary; a blocked search degrades to a knowledge-only shopping list rather than erroring.
- [x] A free-tier client never triggers a grounded query.
- [x] A wardrobe-sufficient request never consumes product-search quota — verified in the trace.
- [x] *"What can I buy that goes with this shirt?"* is **answered**, not refused — it is in domain.
- [x] **Still no** LangChain, LangGraph, second AI provider, or new vector store in `package.json`.
- [x] Grounded-query count appears in the trace log; monthly free-pool consumption is monitored.
- [x] Golden set extended with insufficiency cases in both languages (Suite 11).
- [x] Full Jest suite green.

---

## ── END OF V1 ──

Phases `HARDENING_08` → `15A` → `15B` → `15C` → `15D` → `15E` deliver the complete product:

> An AI personal stylist that helps a client decide what to wear for a specific event **or
> for a specific garment they show it**, prioritizing the client's own wardrobe and falling
> back to external fashion/product recommendations when the wardrobe is insufficient.

**Not in V1, not committed:** multi-turn conversation and streaming (the phase where
LangGraph gets re-evaluated against the triggers in `PHASE_15_AI_SKELETON.md`), item-centric
pairing (`getOutfitSuggestions`), and outfit image generation.
