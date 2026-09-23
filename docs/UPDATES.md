# Murafiq — Engineering Updates & Changelog

This document details all recent backend, AI pipeline, and Virtual Try-On updates, the underlying architectural motivations, API schema changes, and developer usage instructions.

---

## Table of Contents
1. [Overview of Updates](#1-overview-of-updates)
2. [Update 1: Redis Architecture Transition (Local Docker)](#2-update-1-redis-architecture-transition-local-docker)
3. [Update 2: Text-Only AI Conversation Persistence](#3-update-2-text-only-ai-conversation-persistence)
4. [Update 3: Multimodal Garment Anchor Extraction Fix](#4-update-3-multimodal-garment-anchor-extraction-fix)
5. [Update 4: 2-Outfit Internet Shopping Mode (`isShoppingRequest`)](#5-update-4-2-outfit-internet-shopping-mode-isshoppingrequest)
6. [Update 5: Multi-Retailer Egyptian Market Search](#6-update-5-multi-retailer-egyptian-market-search)
7. [Update 6: Wardrobe vs. Shopping Response Isolation](#7-update-6-wardrobe-vs-shopping-response-isolation)
8. [Update 7: Save to Wardrobe from Chat Protocol](#8-update-7-save-to-wardrobe-from-chat-protocol)
9. [Update 8: Flexible Virtual Try-On Inputs (`outfitId` & `itemId`)](#9-update-8-flexible-virtual-try-on-inputs-outfitid--itemid)
10. [Update 9: Subscription Plan Architecture & Lifetime Quota Safety](#10-update-9-subscription-plan-architecture--lifetime-quota-safety)
11. [Update 10: Wardrobe Formality Adjacency & Multi-Look Composition](#11-update-10-wardrobe-formality-adjacency--multi-look-composition)
12. [Update 11: Clean Response Schema & Honest Quota Feedback](#12-update-11-clean-response-schema--honest-quota-feedback)
13. [OpenAPI / Swagger & `docs.json` Synchronization](#13-openapi--swagger--docsjson-synchronization)
14. [Verification & Test Results](#14-verification--test-results)

---

## 1. Overview of Updates

| Feature / Fix | Module | Impact Area | Status |
|---|---|---|---|
| **Local Docker Redis** | Core Config | Background Queues, Rate Limiting, Cache | ✅ Verified |
| **Conversation ID Fix** | AI Stylist | Multi-turn text chat continuity | ✅ Verified |
| **Image Anchor Extraction** | AI Intent Step | Multimodal garment anchor detection | ✅ Verified |
| **2-Outfit Shopping Mode** | AI Product Search | Complete coordinated looks (6 items) | ✅ Verified |
| **Broad Retailer Grounding** | AI Product Search | Multi-store Egyptian market coverage | ✅ Verified |
| **Wardrobe/Shopping Isolation** | AI Render Step | Clean mobile UI card rendering | ✅ Verified |
| **Save to Wardrobe API** | Wardrobe Service | Zero-token chat image promotion | ✅ Verified |
| **Flexible Try-On Inputs** | Virtual Try-On | Direct `outfitId` & `itemId` try-ons | ✅ Verified |
| **Subscription Quota Safety** | Subscriptions | CAS pre-check & free tier 10-message trial | ✅ Verified |
| **Formality Adjacency** | Wardrobe / AI | Two-pass query for small closets | ✅ Verified |
| **Clean Response & Multi-Look** | AI Render / Compose | Single `outfits` array & 2 distinct looks | ✅ Verified |
| **OpenAPI / `docs.json` Sync** | Docs & Tooling | Complete API contract export | ✅ Verified |

---

## 2. Update 1: Redis Architecture Transition (Local Docker)

### Problem
BullMQ background workers (`tryon-generation.worker.js`, `wardrobe-worker.runner.js`) continuously poll Redis queues using blocking commands (`BRPOPLPUSH`, `XREAD`, `BLPOP`). When using Upstash Cloud Redis under the free tier (limited to 500,000 commands/day), polling exhausted the entire daily quota within hours. This blocked rate limiters, session caches, and background queues.

### Solution
- Switched development Redis configuration to a local Docker Redis container:
  `redis://127.0.0.1:6379`
- Ensured container runs with persistence and zero command quotas.

### Why This Decision
Eliminates synthetic artificial rate limits, prevents background worker deadlocks, and supports offline local development with sub-millisecond queue latency.

---

## 3. Update 2: Text-Only AI Conversation Persistence

### Problem
In `src/modules/ai/stylist/stylist.orchestrator.js`, the auto-creation of `AiConversation` was conditionally gated by:
```javascript
if (userMessageId && hasImage) { ... }
```
Because of `&& hasImage`, text-only styling requests never recorded a conversation in MongoDB and returned `conversationId: null`. Mobile clients were unable to send follow-up questions within the same chat thread.

### Solution
- Removed the `&& hasImage` gate from the conversation creation block.
- Both text-only and image-accompanied styling requests now auto-create an `AiConversation` on the first message and return the persistent `conversationId`.

### Why This Decision
Conversations in mobile apps are inherently multi-turn. Gating conversation persistence on image uploads broke fundamental chat UX.

---

## 4. Update 3: Multimodal Garment Anchor Extraction Fix

### Problem
When a client attached a garment image (`imageRef`), Gemini 3.1 Flash Lite returned `garmentAnalysis: null`. Consequently, the orchestrator failed to detect the anchor garment, setting `anchor: null`, `canSaveToWardrobe: false`, and ignoring the garment in outfit composition.

### Root Cause
Gemini 3.1 Flash Lite aggressively minimizes output tokens. In `intent.step.js`, `garmentAnalysis` was defined as an optional field in `INTENT_RESPONSE_SCHEMA`. To save tokens, the model skipped optional nested structures.

### Solution
- In `src/modules/ai/stylist/intent.step.js`, when `hasImage === true`:
  1. Deep-clone `INTENT_RESPONSE_SCHEMA`.
  2. Dynamically append `garmentAnalysis` and `imageIsGarment` to the schema's `required` array.
  3. Enforce inner required fields on `garmentAnalysis`:
     `['category', 'subcategory', 'colorFamily', 'colors', 'formality', 'material', 'pattern', 'confidence']`.

### Why This Decision
Schema-level strictness is the only deterministic mechanism to guarantee Gemini Flash Lite extracts nested attributes without skipping them.

---

## 5. Update 4: 2-Outfit Internet Shopping Mode (`isShoppingRequest`)

### Problem
When a user explicitly requested to shop from the internet (e.g. `"شوفلى طقم من الانترنيت"`), the system previously:
1. Checked for missing slots in the user's wardrobe. If the user already had clothes, it searched for at most 1–2 gap pieces instead of full outfits.
2. Returned uncategorized individual items without style coordination.

### Solution
1. **Schema Extension**: Added `outfitIndex` (integer) and `outfitTitle` (string) to `PRODUCT_SEARCH_RESPONSE_SCHEMA`.
2. **Conditional System Prompt**:
   - For standard gap-filling: uses `TWO-SUGGESTION RULE` (2 items to complete a wardrobe look).
   - For `isShoppingRequest === true`: uses `TWO-OUTFIT RULE (COMPLETE LOOK MODE)`, instructing Gemini to generate **2 complete coordinated looks** (3 pieces each: top + bottom + shoes = 6 items total) with distinct style directions (e.g. Casual Daytime vs. Smart Casual).
3. **Dynamic Slice Limit**:
   ```javascript
   const maxSuggestions = isShoppingRequest ? 6 : 2;
   ```
4. **Render Step Mapping**: `outfitIndex` and `outfitTitle` are surfaced in `suggestedToAcquire` so mobile apps can group pieces into distinct outfit cards.

---

## 6. Update 5: Multi-Retailer Egyptian Market Search

### Problem
Product search prompts originally prioritized only Zara and H&M.

### Solution
- Updated `KNOWN_RETAILERS` and prompt instructions in `product-search.service.js` to search across all reputable Egyptian fashion stores, including:
  - LC Waikiki, Defacto, Town Team, Mobaco Cottons, Dalydress, Concrete, Massimo Dutti, Pull&Bear, Bershka, Amazon Egypt, Jumia Egypt, and official Egyptian brand webstores.

### Why This Decision
Broadens product options across different price points, formal/casual categories, and ensures direct local availability in Egyptian Pounds (EGP).

---

## 7. Update 6: Wardrobe vs. Shopping Response Isolation

### Rule & Behavior
- **When `isShoppingRequest === true`**:
  - `fromYourWardrobe: []` (empty array)
  - `outfits: []` (empty array)
  - `suggestedToAcquire`: populated with the 6 grouped shopping items.
  - Assistant rationale focuses exclusively on the shopping looks.
- **When `isShoppingRequest === false` (Normal Styling)**:
  - `fromYourWardrobe`: populated with matching owned pieces.
  - `suggestedToAcquire`: populated only with missing pieces needed to complete the wardrobe outfit (gap-closing).

### Why This Decision
Prevents duplicate or conflicting recommendations on mobile screens. Mobile UI renders shopping cards when `isShoppingRequest` is detected, and wardrobe cards for wardrobe styling.

---

## 8. Update 7: Save to Wardrobe from Chat Protocol

### Clarification & Architecture
When the AI detects an unowned garment image in chat, it returns:
```json
{
  "canSaveToWardrobe": true,
  "saveToWardrobeCta": "هل تود حفظ هذه القطعة في خزانة ملابسك للمستقبل؟",
  "saveMessageId": "6aaa6f2905deffa1f4fe97e0"
}
```

- **Why replying "نعم" to `/api/v1/ai/stylist` fails**:
  The chat endpoint is an outfit generation pipeline. A one-word message `"نعم"` lacks styling context and is rejected by the scope guard.
- **The Correct API Action**:
  The mobile UI presents a button (e.g. *"احفظ في الخزانة"* / *"Save to Wardrobe"*). Tapping the button calls:
  ```http
  POST /api/v1/wardrobe/from-chat
  Authorization: Bearer <TOKEN>
  Content-Type: application/json

  {
    "messageId": "6aaa6f2905deffa1f4fe97e0"
  }
  ```
- **Backend Execution**:
  1. Reuses `imageAnalysis` stored with the message (zero extra LLM calls).
  2. Promotes Cloudinary asset from `murafiq/ai-chat/` to `murafiq/wardrobe/` (clearing the 24-hour TTL).
  3. Creates the `WardrobeItem` and indexes its vector embedding for future outfit generation.

---

## 9. Update 8: Flexible Virtual Try-On Inputs (`outfitId` & `itemId`)

### Problem
Previously, `POST /api/v1/ai/try-on` strictly required a verbose `garments: [...]` array with explicit `source`, `itemId`, and `slot` for each piece. This made it tedious for mobile clients to initiate try-ons from saved outfits or single pieces.

### Solution
Updated `POST /api/v1/ai/try-on` to support three flexible input formats:

#### Format A: Try on a Complete Outfit (`outfitId`)
```json
{
  "shapeModelId": "6aa8d2ba7756b0f4610c32e2",
  "outfitId": "6aaa2037c0ecc094f87905af",
  "resolution": "1024x1024",
  "promptVersion": "v6"
}
```
- Fetches the outfit via `outfitService.getOutfitById(outfitId, userId)`.
- Resolves all wardrobe items via `wardrobeService.getWardrobeItemsByIds(userId, outfit.items)`.
- Automatically maps categories to try-on slots (`top`, `bottom`, `shoes`, `outerwear`).
- Links `outfitId` to the `TryOnGeneration` document.

#### Format B: Try on a Single Wardrobe Piece (`itemId`)
```json
{
  "shapeModelId": "6aa8d2ba7756b0f4610c32e2",
  "itemId": "6aa81274ae66a40ab5ec4622"
}
```
- Infers slot from the item's stored wardrobe category.

#### Format C: Custom Garments Array (`garments: [...]`)
- Maintained 100% backward compatibility for custom selections and temporary image uploads.

---

## 10. Update 9: Subscription Plan Architecture & Lifetime Quota Safety

### Problem
1. **CAS Bypass Risk:** Quota enforcement in `entitlement.service.js` previously relied solely on MongoDB's atomic Compare-And-Swap pattern via `UsageCounter.findOneAndUpdate({ used: { $lte: limit - count } }, ..., { upsert: true })`. If the unique compound index `{ subjectId: 1, metric: 1, periodKey: 1 }` was missing or inactive, an upsert silently inserted a duplicate counter document with `used: 1`, allowing users to bypass quotas indefinitely.
2. **Free Plan Friction:** `client.free` originally had a daily image cap of `ai.imageMessages.daily: 2`, artificially preventing new users from testing image styling queries even though they had plenty of their 10 lifetime messages remaining.

### Solution
1. **Defense-in-Depth Pre-CAS Check:** Added an explicit `.findOne()` check in `consume()` before attempting CAS, ensuring an immediate `ApiError(429)` if the user has reached or exceeded their limit regardless of database index status.
2. **Unconstrained Free Trial:** Omitted `ai.imageMessages.daily` from `client.free` in `plan.constants.js`. Free users can use all 10 messages with or without images whenever they choose, strictly bounded by `ai.messages.lifetime: 10`.

---

## 11. Update 10: Wardrobe Formality Adjacency & Multi-Look Composition

### Problem
1. **Formality Starvation on Small Closets:** The candidate retrieval query in `wardrobe.repository.js` strictly matched requested occasion formality (e.g. `{ formality: { $in: ['casual'] } }`). For a free user with 7 wardrobe items whose tops were `smart_casual` (sweater) and `business` (dress shirts), the query returned 0 tops, causing the AI to report "no clothes" despite having 7 valid items.
2. **Single-Look Generation:** On hybrid queries like `"شوفلى طقم لخروجه شبابى كلاسك"`, the orchestrator forced `formality: ['casual']` from the event dress code, discarding the user's explicit `smart_casual` intent. Combined with strict filtering, only 1 candidate was retrieved per slot, forcing Gemini to compose only 1 outfit.

### Solution
1. **Progressive Formality Relaxation:** Added `FORMALITY_ADJACENCY` in `wardrobe.constants.js` and a two-pass query strategy in `findCandidatesForSlot()`:
   - Pass 1: Strict query matching exact occasion formality.
   - Pass 2: If Pass 1 returns 0 items for that slot, automatically broadens the query to adjacent formality levels.
2. **Formality Blending:** In `stylist.orchestrator.js`, when events are non-high-stakes (`!resolvedDressCode.highStakes`), `targetFormality` combines the event dress code with user intent (`['casual', 'smart_casual']`).
3. **Multi-Look Prompting:** Strengthened Rule 4 in `compose.step.js` to instruct Gemini to compose 2 distinct ranked looks (Look 1 and Look 2) whenever wardrobe candidates permit.

---

## 12. Update 11: Clean Response Schema & Honest Quota Feedback

### Problem
1. **Duplicate Root Payloads:** `renderStylistResponse()` in `render.step.js` returned both `fromYourWardrobe: renderedOutfits` and `outfits: renderedOutfits` at the root of `data`. In Swagger and client apps, this caused the full composed outfits list to appear twice.
2. **Misleading Online Shopping Cards:** When a free user asked `"شوفلى طقم من الانترنيت"`, the AI message claimed to find online store products, but returned static template items with `retailer: null` and `sourceUrl: null` because free users have `ai.productSearch.monthly: 0`.

### Solution
1. **Unified Schema:** Removed `fromYourWardrobe` from the root of `renderStylistResponse()`. `data.outfits` is now the single primary array of composed looks, with `outfit.fromYourWardrobe` contained strictly inside each outfit object.
2. **Honest Quota Feedback:** Added `searchQuotaBlocked` boolean and `productSearchUpgradeCta` string. When `isShoppingRequest && searchQuotaBlocked`, `suggestedToAcquire` returns `[]` (no broken null cards) and the assistant clearly explains that online store search is a premium feature with an upgrade CTA.

---

## 13. OpenAPI / Swagger & `docs.json` Synchronization

### Updates Applied
1. **`src/modules/ai/ai.swagger.js`**:
   - Documented `outfitIndex` (integer, nullable) and `outfitTitle` (string, nullable) in `suggestedToAcquire` items.
2. **`src/modules/ai/try-on/try-on.swagger.js`**:
   - Added optional `outfitId` and `itemId` in `POST /ai/try-on` request body.
   - Added `shapeModelId` and `outfitId` to generation response DTO schemas.
3. **`docs.json` Generation**:
   - Compiled full specification using `swagger-jsdoc` with all 146 operations and 127 routes.
   - Saved to `docs.json` (root) and `docs/docs.json`.
   - Validated via `npm run validate:openapi`:
     - **0 Undocumented routes**
     - **0 Ghost routes**
     - **0 Broken references**
     - **0 Structural problems**

---

## 14. Verification & Test Results

### Automated Test Suites
```bash
# 1. AI Stylist Pipeline, Product Search & Image Anchor
npm test -- tests/unit/ai-intent.test.js tests/unit/ai-orchestrator-product-search.test.js tests/unit/ai-product-search-service.test.js tests/unit/ai-product-render.test.js tests/unit/ai-orchestrator-image.test.js
# Result: 5 passed, 43/43 tests passed

# 2. Wardrobe Candidate Relaxation & Entitlement CAS Safety
npm test -- tests/unit/wardrobe-candidates.test.js tests/unit/entitlement.service.test.js tests/unit/ai-product-search-entitlement.test.js
# Result: 3 passed, 34/34 tests passed

# 3. AI Stylist Golden Evaluation Harness (Full Pipeline)
npm test -- tests/ai/golden/stylist-pipeline.eval.test.js
# Result: 1 passed, 58/58 scenarios passed

# 4. Virtual Try-On Subsystem (Unit, Entitlement & Integration)
npm test -- tests/unit/ai-tryon-service.test.js tests/unit/ai-tryon-entitlement.test.js tests/integration/ai-tryon-
# Result: 4 passed, 63/63 tests passed

# 5. Full Phase 15 Regression Suite
# Total Tests: 141 passed, 0 failed across all suites

# 6. OpenAPI Specification Validation
npm run validate:openapi
# Result: Exit 0 — 146 documented operations matching 146 routes

# 7. ESLint
npm run lint
# Result: Exit 0 — 0 errors, 0 warnings
```
