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
10. [OpenAPI / Swagger & `docs.json` Synchronization](#10-openapi--swagger--docsjson-synchronization)
11. [Verification & Test Results](#11-verification--test-results)

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

## 10. OpenAPI / Swagger & `docs.json` Synchronization

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

## 11. Verification & Test Results

### Automated Test Suites
```bash
# 1. AI Stylist Pipeline, Product Search & Image Anchor
npm test -- tests/unit/ai-intent.test.js tests/unit/ai-orchestrator-product-search.test.js tests/unit/ai-product-search-service.test.js tests/unit/ai-product-render.test.js tests/unit/ai-orchestrator-image.test.js
# Result: 5 passed, 43/43 tests passed

# 2. Virtual Try-On Subsystem (Unit & Entitlement)
npm test -- tests/unit/ai-tryon-service.test.js tests/unit/ai-tryon-entitlement.test.js
# Result: 2 passed, 41/41 tests passed

# 3. Virtual Try-On Integration & IDOR Tests
npm test -- tests/integration/ai-tryon-
# Result: 2 passed, 22/22 tests passed

# 4. OpenAPI Specification Validation
npm run validate:openapi
# Result: Exit 0 — 146 documented operations matching 146 routes

# 5. ESLint
npm run lint
# Result: Exit 0 — 0 errors, 0 warnings
```
