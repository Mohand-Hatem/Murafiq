# Murafiq — Phase 15 AI Stylist, API Validation & Reliability Updates

> **Date:** October 10, 2026  
> **Status:** Fully Implemented & Verified (100% Passing Test Suite)  
> **Scope:** Phase 15 AI Stylist Pipeline, Mobile API Protection, Provider Reliability, Candidate Integrity, Dead Route Pruning

---

## 1. Executive Summary

This document details the production hardening, mobile client protection, API validation, AI response quality improvements, and architectural cleanup implemented across Murafiq's Phase 15 AI Personal Stylist module.

### Core Objectives Delivered
1. **Conversation Validation & Ownership (P1.1):** Strict validation of conversation ObjectIds before quota consumption or AI execution; rejection of malformed IDs with `400 Bad Request` and non-owned or nonexistent IDs with `404 Not Found`.
2. **Pre-Quota Attached Image Validation (P1.2):** Validates and retrieves attached Cloudinary images before deducting user quota or invoking AI models, with bounded timeout and MIME enforcement. Eliminates silent text-only continuation upon image download failures.
3. **Bounded Provider Timeouts & Cancellation (P1.3):** Aborts pending Google GenAI calls via `AbortController` signals to eliminate orphaned provider tasks and avoid unbounded parallel executions. Local timeouts fail closed with `504 Gateway Timeout`.
4. **Mobile Error Sanitization (P1.4):** Completely strips stack traces (`meta.stack`), local filesystem paths, and internal provider diagnostics from production responses. Masks 500 errors to `"Internal Server Error"` while preserving `req.id` tracing in server-side logs.
5. **Explicit User Constraints & Contradiction Detection (P1.5):** Injects explicit user constraints directly into composition prompts; detects contradictory requests (e.g. summer beach wedding with heavy winter clothing; all-black outfit without black pieces) and asks a targeted clarification question with low confidence (`0.3`).
6. **Safe Outfit Integrity Fallback (P1.6):** Enhances the Anti-Hallucination Gate with `filterValidOutfits`. When corrective retry fails verification, retains only 100% verified candidate looks and safely degrades to `outfits = []` with `sufficiency = 'none'` instead of throwing an unhandled `500 Internal Server Error`.
7. **Meaningful Wardrobe Item Names in EN & AR (P1.7):** Dynamically generates title-cased English names (e.g., `"Navy Blazer"`, `"Black Jeans"`, `"Brown Loafers"`) and natural Arabic names (e.g., `"بليزر كحلي"`, `"بنطلون جينز أسود"`, `"حذاء لوفر بني"`) from garment metadata, replacing the generic `"Wardrobe Item"` fallback without database schema modifications.
8. **Pruning Dead Duplicate Route Files (P2):** Deleted orphaned route files (`try-on.routes.js` and `shape-model.routes.js`) while preserving all 7 active inline route definitions in `ai.routes.js`.
9. **Dedicated Regression Test Suite:** Added `tests/unit/phase15-regression-fixes.test.js` covering all 8 requirements end-to-end (19/19 passing).

---

## 2. P1.1 — Validate Conversation IDs and Ownership Before AI Processing

### Problem
Previously, malformed conversation IDs (e.g. `"not-an-id"`) could pass through validation and reach downstream orchestrator processing or cause message persistence errors. Nonexistent conversation IDs could consume user quota before failing.

### Implementation
- **Validator Layer ([`src/modules/ai/ai.validator.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/ai.validator.js)):**
  Added regex constraint matching MongoDB ObjectIds (`/^[0-9a-fA-F]{24}$/`) to `conversationId` in `stylistRequestSchema`:
  ```javascript
  conversationId: z
    .string()
    .regex(OBJECT_ID_REGEX, 'Invalid conversation ID format')
    .optional(),
  ```
- **Controller Layer ([`src/modules/ai/ai.controller.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/ai.controller.js)):**
  Verifies that the conversation exists and belongs to the authenticated user before invoking the pipeline or consuming quota:
  ```javascript
  if (conversationId) {
    const conversation = await conversationService.getConversation(conversationId, userId);
    if (!conversation) {
      throw new ApiError(404, 'AI conversation not found');
    }
  }
  ```
- **New Conversation Handling:**
  When `conversationId` is omitted, the API continues to support auto-creation of conversations during generation.

---

## 3. P1.2 — Validate Attached Images Pre-Quota

### Problem
When an attached image failed to download or had an unsupported format, the system previously caught the error late and proceeded with a text-only prompt, wasting quota and producing irrelevant recommendations.

### Implementation
- **Pre-Quota Image Resolver ([`src/modules/ai/stylist/stylist.orchestrator.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/stylist/stylist.orchestrator.js)):**
  Added `resolveAndValidateImage(imageRef)` before quota consumption:
  - Validates image ownership namespace (`murafiq/ai-chat/<userId>/...`) in `ai.controller.js` (rejecting foreign IDs with `400`).
  - Fetches the image with an 8-second bounded timeout (`AbortSignal.timeout(8000)`).
  - Enforces a 10MB file size limit (`MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024`).
  - Verifies supported MIME types (`image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`).
  - If download fails or image is unsupported, throws a sanitized `400 Bad Request` prior to deducting quota.

---

## 4. P1.3 — Bounded Provider Timeouts & Cancellation

### Problem
Previously, timeouts were handled with `Promise.race`, leaving the underlying HTTP request running in the background. Subsequent retries risked spawning overlapping, concurrent calls against Google AI SDK.

### Implementation
- **AbortSignal Integration ([`src/modules/ai/providers/llm.provider.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/providers/llm.provider.js)):**
  Passed `abortController.signal` into `@google/genai` request config (`callConfig.abortSignal`).
- **Enforced Request Budget:**
  - Evaluates remaining time against overall request deadline (`startTime + timeoutMs`).
  - Aborts stalled calls upon timeout and rejects immediately.
  - Does not retry local timeouts; only transient provider server errors (HTTP 429, 500, 502, 503) are retried if remaining budget exceeds 2500ms.
  - Treats local timeout and `AbortError` as `ApiError(504, 'AI provider request timed out after Xms')`.

---

## 5. P1.4 — Stop Exposing Internal Errors to Mobile Clients

### Problem
Failed AI requests or internal crashes previously leaked stack traces, local disk paths (`D:\JOBS\...`), and raw provider errors in JSON responses.

### Implementation
- **Centralized Error Middleware ([`src/common/middlewares/error-handler.middleware.js`](file:///d:/JOBS/Test/Murafiq/src/common/middlewares/error-handler.middleware.js)):**
  - In production (`NODE_ENV === 'production'`), deletes `meta.stack` from all response bodies.
  - Sanitizes response messages, masking 500 errors to `"Internal Server Error"` and stripping filesystem paths matching Windows/POSIX regexes.
  - Maps 504 status codes to: `"AI service request timed out. Please try again."`
  - Maps 502/503 status codes to: `"AI service is temporarily unavailable. Please try again shortly."`
  - Logs internal stacks, request IDs (`req.id`), and error details server-side only.

---

## 6. P1.5 — Explicit User Constraints & Contradiction Detection

### Problem
The AI model sometimes overlooked explicit user constraints (colors, season, formality) or fabricated explanations when user requests contained contradictory requirements.

### Implementation
- **Contradiction Detection ([`src/modules/ai/stylist/intent.step.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/stylist/intent.step.js)):**
  Added `detectContradictions(message, explicitConstraints)` checking for:
  - Season/weather conflicts (e.g. summer beach vs. heavy winter/wool).
  - Color conflicts (e.g. all-black outfit vs. no black pieces).
  - When detected, sets `confidence: 0.3` and returns a localized clarification question (e.g., asking whether the user prefers a summer beach look or heavy winter warmth) instead of generating an impossible outfit.
- **Prompt Injection of Hard Constraints ([`src/modules/ai/stylist/compose.step.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/stylist/compose.step.js)):**
  Injected `<explicit_user_constraints>` into the composition user prompt:
  ```markdown
  <explicit_user_constraints>
  - Prefer all-white linens
  - Outdoor garden wedding
  CRITICAL: These explicit user constraints are strictly MANDATORY. You MUST respect them in candidate selection and outfit composition.
  </explicit_user_constraints>
  ```

---

## 7. P1.6 — Handle Outfit-Integrity Failures Safely

### Problem
If the model returned hallucinated garment IDs after a corrective retry, the orchestrator threw an internal `500` error, crashing the request and failing the user experience.

### Implementation
- **Validation Filter ([`src/modules/ai/stylist/outfit.validator.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/stylist/outfit.validator.js)):**
  Exported `filterValidOutfits(outfits, candidatePool, anchor)`:
  - Validates every item ID in each proposed outfit against the user's candidate pool.
  - Filters out any outfit containing hallucinated or unverified IDs.
- **Orchestrator Fallback ([`src/modules/ai/stylist/stylist.orchestrator.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/stylist/stylist.orchestrator.js)):**
  If retry fails verification:
  - Logs `hallucination_safe_fallback` to trace logger.
  - If any outfit is 100% valid, retains it.
  - If all outfits are invalid, sets `compResult.outfits = []` and `compResult.sufficiency = 'none'`.
  - The downstream Invariant Consistency Guard populates missing slots and localized gap descriptions, returning a safe, structured response to the mobile client rather than throwing a 500 error.

---

## 8. P1.7 — Return Meaningful Wardrobe Item Names in EN & AR

### Problem
Because `WardrobeItem` documents in MongoDB store classification attributes (`category`, `subcategory`, `primaryColor`) rather than a mandatory `name` field, responses defaulted to the generic string `"Wardrobe Item"`.

### Implementation
- **Dynamic Localization ([`src/modules/ai/stylist/render.step.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/stylist/render.step.js)):**
  Added `formatWardrobeItemName(item, language = 'en')` with dictionaries:
  - `ARABIC_CATEGORY_NAMES` (`top` -> `'ملابس علوية'`, `bottom` -> `'ملابس سفلية'`, `shoes` -> `'حذاء'`, etc.)
  - `ARABIC_SUBCATEGORY_NAMES` (`blazer` -> `'بليزر'`, `jeans` -> `'بنطلون جينز'`, `loafers` -> `'حذاء لوفر'`, etc.)
  - `ARABIC_COLOR_NAMES` (`navy` -> `'كحلي'`, `black` -> `'أسود'`, `white` -> `'أبيض'`, `brown` -> `'بني'`, etc.)
- **Naming Logic:**
  1. If `item.name` or `item.title` is present, preserves it.
  2. In English: Formats title-cased `[PrimaryColor] [Subcategory || Category]` (e.g. `"Navy Blazer"`, `"Black Jeans"`, `"Brown Loafers"`).
  3. In Arabic: Formats localized `[Noun] [Color]` (e.g. `"بليزر كحلي"`, `"بنطلون جينز أسود"`, `"حذاء لوفر بني"`).
  4. Only falls back to `"Wardrobe Item"` / `"قطعة ملابس"` if all metadata is absent.
- **Integration:** Applied to all hydrated garments in `renderedOutfits` and `anchorGarment`.

---

## 9. P2 — Pruned Dead Duplicate Route Files

### Files Deleted
- `src/modules/ai/try-on/try-on.routes.js`
- `src/modules/ai/shape-model/shape-model.routes.js`

### Verification
- An exhaustive repository search (`git grep`) confirmed zero imports or references to either file.
- All 7 endpoints for Shape Models and Virtual Try-On remain active in [`src/modules/ai/ai.routes.js`](file:///d:/JOBS/Test/Murafiq/src/modules/ai/ai.routes.js#L156-L218):
  - `POST /api/v1/ai/shape-model`
  - `GET /api/v1/ai/shape-model`
  - `DELETE /api/v1/ai/shape-model`
  - `POST /api/v1/ai/try-on`
  - `GET /api/v1/ai/try-on/:id`
  - `GET /api/v1/ai/try-on`
  - `DELETE /api/v1/ai/try-on/:id`
- All endpoints preserve `tryOnGuard`, `authMiddleware`, `restrictTo('client')`, and Zod validation middleware.

---

## 10. Automated Test Verification

### Dedicated Regression Suite ([`tests/unit/phase15-regression-fixes.test.js`](file:///d:/JOBS/Test/Murafiq/tests/unit/phase15-regression-fixes.test.js))
| Test Suite / Requirement | Test Case | Status |
|---|---|---|
| **1. Conversation Validation** | Rejects malformed IDs with 400 | PASS |
| | Accepts valid 24-char ObjectId | PASS |
| | Accepts omitted conversationId | PASS |
| | Rejects non-owned/nonexistent ID with 404 | PASS |
| **2. Image Pre-Validation** | Rejects foreign user namespace imageRef | PASS |
| | Rejects unretrievable image downloads | PASS |
| | Rejects unsupported MIME formats | PASS |
| **3. Timeouts & Retries** | Aborts stalled calls with AbortController | PASS |
| **4. Error Sanitization** | Masks 500 and strips filesystem paths | PASS |
| | Maps 504 and 502 to user-friendly copy | PASS |
| **5. Constraints & Contradictions** | Detects season contradiction (summer vs winter) | PASS |
| | Detects color contradiction (all-black vs no black) | PASS |
| | Injects explicit constraints into prompt | PASS |
| **6. Integrity Fallback** | Filters invalid candidate IDs | PASS |
| | Returns empty outfits on all-invalid looks | PASS |
| **7. Wardrobe Naming** | Formats title-cased English names | PASS |
| | Formats natural Arabic names | PASS |
| | Preserves explicit custom names | PASS |
| **8. Route Registration** | Registers all 7 Try-On & Shape-Model endpoints | PASS |

### Complete Test Results
- **Phase 15 Unit Test Suites:** 9 passed, 9 total (**116 / 116 tests passing, 100%**)
- **Phase 15 Integration Suites:** 2 passed, 2 total (**16 / 16 tests passing, 100%**)
- **Total Test Count:** **132 automated tests passing cleanly.**
