# Murafiq — Subscription Plans, Entitlements & Pricing Architecture

> Canonical architectural reference for subscription tiers, quota enforcement, pricing schedules, and historical design decisions.

---

## 1. Overview & System Architecture

The subscription and entitlement system is the core monetization and capacity-gating engine in Murafiq. It governs marketplace limits (requests, offers) and AI compute consumption (text chat, vision multimodal queries, Google Search grounding, virtual try-on, and digital wardrobe storage).

### Core Invariants

1. **Exactly One Active Subscription Per User:**
   - Every registered user is auto-provisioned a lifetime free subscription (`client.free` or `stylist.free`) at account creation.
   - `currentPeriodEnd = null` represents a non-expiring free tier.
   - Eliminates `if (!subscription)` null-branch defenses across all downstream entitlement checks.
2. **Atomic CAS Quota Metering:**
   - Quotas are tracked in MongoDB via `UsageCounter` using atomic Compare-And-Swap (`findOneAndUpdate` with `$inc` and conditional `{ used: { $lte: limit - count } }`).
   - Period keys are strictly resolved in the Cairo business timezone (`Africa/Cairo`):
     - Daily quotas: `YYYY-MM-DD`
     - Monthly quotas: `YYYY-MM`
     - Lifetime quotas: `lifetime`
3. **Hard Domain Enforcement (No Synthetic Barriers):**
   - Limits are enforced at the service level, returning `ApiError(429, ...)` when exceeded.
   - Out-of-domain scope refusals (e.g. non-fashion prompts, non-garment photos) automatically refund consumed message quotas via `refundConsumedQuotas()`.
4. **Currency & Conversion Boundaries:**
   - Operational plans and API responses represent prices in **decimal EGP** (with `round2()`).
   - The double-entry financial ledger strictly stores integer piastres (`amountMinor = Math.round(egp * 100)`) to eliminate float drift.
   - USD values displayed in client apps are marketing labels converted via `USD_TO_EGP_RATE = 49`.

---

## 2. Canonical Plans & Entitlements Matrix

### 2.1 Client Subscription Plans

| Plan Code | Name | Tier | Monthly Price (EGP) | Monthly Display (USD) | Yearly Price (EGP) | Yearly Display (USD) | Requests (Daily / Active) | AI Messages | AI Image Messages (Daily) | AI Product Search (Monthly) | Virtual Try-On (Monthly) | Wardrobe Max Items |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `client.free` | Client Free | Free | 0 EGP | $0 | N/A | N/A | 1 / 1 | 10 (Lifetime) | *Unconstrained* (up to 10 total) | 0 | 1 Trial (Lifetime) | 7 |
| `client.basic` | Client Basic | Basic | 50 EGP | $1 | 588 EGP | $12 | 2 / 2 | 5 / day | 3 / day | 15 | 4 | 25 |
| `client.mid` | Client Mid | Mid | 150 EGP | $3 | 1,715 EGP | $35 | 3 / 3 | 35 / day | 10 / day | 30 | 6 | 45 |
| `client.pro` | Client Pro | Pro | 250 EGP | $5 | 2,842 EGP | $58 | 4 / 4 | 80 / day | 25 / day | 45 | 8 | 100 |
| `client.enterprise` | Client Enterprise | Enterprise | 500 EGP | $10 | 5,635 EGP | $115 | 5 / 5 | 150 / day | 60 / day | 60 | 10 | 200 |

> [!NOTE]
> **Free Tier Philosophy:** On `client.free`, users receive **10 lifetime AI messages** and **7 wardrobe items**. `ai.imageMessages.daily` is intentionally omitted from the plan definition, allowing new users to use all 10 messages with images in 1 hour or 1 day during their trial without artificial daily throttles.

### 2.2 Stylist Subscription Plans

| Plan Code | Name | Tier | Monthly Price (EGP) | Monthly Display (USD) | Yearly Price (EGP) | Yearly Display (USD) | Offers (Daily / Active) | Feed Priority |
|---|---|---|---|---|---|---|---|---|
| `stylist.free` | Stylist Free | Free | 0 EGP | $0 | N/A | N/A | 3 / 3 | No |
| `stylist.basic` | Stylist Basic | Basic | 50 EGP | $1 | 588 EGP | $12 | 6 / 6 | No |
| `stylist.pro` | Stylist Pro | Pro | 125 EGP | $2.50 | 1,470 EGP | $30 | 10 / 10 | Yes |
| `stylist.enterprise` | Stylist Enterprise | Enterprise | 250 EGP | $5 | 2,940 EGP | $60 | 20 / 20 | Yes |

---

## 3. Issues, Root Causes & Architectural Decisions

During end-to-end integration testing of Phase 15 and subscription plans with live MongoDB databases, five distinct edge cases were identified, diagnosed, and resolved.

---

### Issue 1: Lifetime Quota Enforcement & Missing Compound Index Vulnerability

#### Symptom
A test user on `client.free` with `ai.messages.lifetime: 10` sent multiple messages without ever being blocked by a 429 quota exhaustion error.

#### Root Cause Analysis
In `src/modules/subscriptions/entitlement.service.js`, the `consume()` function previously relied exclusively on MongoDB's atomic Compare-And-Swap pattern:
```javascript
UsageCounter.findOneAndUpdate(
  { subjectId: userId, metric, periodKey, used: { $lte: limit - count } },
  { $inc: { used: count } },
  { upsert: true, returnDocument: 'after' }
)
```
When `used >= limit`, `{ used: { $lte: limit - count } }` matches 0 documents. MongoDB then executes the `upsert: true` clause (an insert).
- **If the unique compound index `{ subjectId: 1, metric: 1, periodKey: 1 }` is active:** The insert throws duplicate key error `E11000`, which is caught and rethrown as `ApiError(429)`.
- **If the index is missing, delayed, or inactive (e.g. dev database or Atlas replica set re-indexing):** A second counter document is silently created with `used: 1`, completely bypassing the quota!

#### Architectural Decision & Fix
Applied a **defense-in-depth pre-CAS limit check** in `entitlement.service.js`:
1. Check existing usage with an explicit `.findOne()`:
   ```javascript
   const existing = await UsageCounter.findOne({ subjectId: userId, metric, periodKey }).lean();
   if (existing && existing.used >= limit) {
     throw new ApiError(429, `${quotaPrefix} exceeded for ${metric}...`);
   }
   ```
2. Cleaned duplicate/stale counter records in the development database.
3. Verified the unique compound index is created and synchronized at boot.

---

### Issue 2: Free Plan Image Message Daily Limit Friction

#### Symptom
When testing image styling on the free tier, users who had plenty of lifetime messages remaining were blocked from uploading images because of an arbitrary daily cap (`ai.imageMessages.daily: 2`).

#### Root Cause Analysis
The free tier specification originally defined both `ai.messages.lifetime: 10` and `ai.imageMessages.daily: 2`. This created unnatural UX friction: a user evaluating the app could not test 3 outfit photos in an afternoon, even though they had 8 unused messages in their account.

#### Architectural Decision & Fix
- **Omitted `ai.imageMessages.daily` from `client.free`:**
  In `src/modules/subscriptions/plan.constants.js`, `client.free` defines only `ai.messages.lifetime: 10`.
- In `src/modules/ai/stylist/stylist.orchestrator.js`, when a message contains an image (`hasImage === true`), the orchestrator checks `userPlan.entitlements['ai.imageMessages.daily']`. If undefined, no daily image deduction is made.
- Both text and image messages consume from `ai.messages.lifetime: 10`.
- **Why this solution:** Users can spend all 10 messages on image queries in 1 hour or over 2 weeks. Total compute cost per trial account is strictly capped at 10 requests.

---

### Issue 3: Empty Wardrobe Results on Small Closets (Formality Mismatch)

#### Symptom
A free user with 7 classified garments in their digital wardrobe (cream Polo sweater, 2 dress shirts, dark navy jeans, dress trousers, white sneakers, black smart shoes) sent:
> `"شوفلى طقم لخروجه شبابى"` *(Style me an outfit for a youth casual outing)*

The AI returned: `outfits: [], fromYourWardrobe: [], sufficiency: "none"` with `missingSlots: ["top", "bottom"]`.

#### Root Cause Analysis
The candidate retrieval query in `src/modules/wardrobe/wardrobe.repository.js` enforced a strict AND filter:
```javascript
if (formality && formality.length > 0) {
  query.formality = Array.isArray(formality) ? { $in: formality } : formality;
}
```
1. `"شوفلى طقم لخروجه شبابى"` was classified as `casual_outing` (`formality: ['casual']`).
2. The user's tops were `smart_casual` (sweater) and `business` (dress shirts).
3. The user's bottoms were `smart_casual` (jeans) and `business` (dress trousers).
4. Because none was strictly `'casual'`, MongoDB returned 0 tops and 0 bottoms. The preflight guard short-circuited before the LLM was ever called!

#### Architectural Decision & Fix
Implemented **Progressive Formality Relaxation**:
1. Added `FORMALITY_ADJACENCY` in `src/common/constants/wardrobe.constants.js`:
   - `casual` expands to `['casual', 'smart_casual']`
   - `smart_casual` expands to `['smart_casual', 'casual', 'business']`
   - `business` expands to `['business', 'smart_casual', 'formal']`
   - `formal` expands to `['formal', 'business', 'smart_casual']`
2. Modified `findCandidatesForSlot()` into a **two-pass query**:
   - **Pass 1:** Queries strictly matching the requested occasion formality.
   - **Pass 2:** If Pass 1 returns 0 items for that slot, automatically broadens the query to adjacent formality levels.
3. Users with large wardrobes receive strictly filtered items; users with small closets get stylish, adjacent garments styled up or down.

---

### Issue 4: Misleading Product Search on Free Tier

#### Symptom
When a free user asked `"شوفلى طقم من الانترنيت"` *(Find me an outfit from the internet)*, the AI responded:
> *"إليك قطع وتنسيقات مقترحة للاقتناء من المتاجر الإلكترونية"*

However, all returned items had `retailer: null`, `sourceUrl: null`, and `isGrounded: false` because free users have `ai.productSearch.monthly: 0`.

#### Root Cause Analysis
In `src/modules/ai/stylist/stylist.orchestrator.js`, when `quotaCheck.allowed === false`, the orchestrator logged a trace step but continued to `renderStylistResponse()`. In `render.step.js`, missing external suggestions fell back to static ungrounded templates (`ACQUISITION_TEMPLATES`) while the message still claimed items were from online stores.

#### Architectural Decision & Fix
1. Added `searchQuotaBlocked` boolean and `productSearchUpgradeCta` string to the response payload.
2. In `stylist.orchestrator.js`, passed `searchQuotaBlocked: !quotaCheck.allowed`.
3. When `isShoppingRequest && searchQuotaBlocked`:
   - `suggestedToAcquire` returns `[]` (eliminating broken null-cards).
   - The assistant message honestly states:
     > *"خطتك الحالية لا تتضمن ميزة البحث في المتاجر الإلكترونية. يمكنك ترقية باقتك للحصول على اقتراحات تسوق وروابط مباشرة من المتاجر."*
   - Returns a structured upgrade call-to-action for the mobile UI.

---

### Issue 5: Duplicate Root Payload & Single-Look Generation

#### Symptom
In responses to styling requests, the composed outfits list appeared twice in Swagger and mobile client JSON payloads (`data.fromYourWardrobe` and `data.outfits`). Furthermore, hybrid requests like `"شوفلى طقم لخروجه شبابى كلاسك"` only generated 1 look instead of 2.

#### Root Causes
1. **Duplicate Root Key:** `renderStylistResponse()` in `render.step.js` returned `{ fromYourWardrobe: renderedOutfits, outfits: renderedOutfits }`.
2. **Strict Event Override:** In `stylist.orchestrator.js`, `resolvedDressCode.formality` (`['casual']`) completely overwrote `intent.formality` (`'smart_casual'`).
3. Because Pass 1 found 1 casual shoe (white sneakers), Pass 2 was skipped for shoes. Tops and bottoms only matched 1 smart-casual item each.
4. Gemini was provided only 1 top, 1 bottom, and 1 pair of shoes. Under Rule 4 (which forbids duplicate garments), the LLM could only compose 1 look.

#### Architectural Decision & Fix
1. **Clean Response Contract:**
   - Removed `fromYourWardrobe` from the root of the API response.
   - `data.outfits` is now the single primary array of composed looks.
   - `outfit.fromYourWardrobe` is retained inside each outfit object to represent that outfit's client garments.
2. **Formality Blending:**
   - In `stylist.orchestrator.js`, when events are not high-stakes (`!resolvedDressCode.highStakes`), `targetFormality` combines the event formality and explicit user intent (`['casual', 'smart_casual']`).
3. **Multi-Look Prompting:**
   - Strengthened Rule 4 in `compose.step.js` to instruct Gemini to compose **2 distinct ranked looks** (e.g. Look 1: Smart Evening, Look 2: Fresh Casual) whenever candidate garments permit.

---

## 4. Verification & Testing Evidence

All 141 automated test suites pass across the entire repository with zero failures:

| Test Suite | File | Tests Passed | Status |
|---|---|---|---|
| Wardrobe Candidate Relaxation | `tests/unit/wardrobe-candidates.test.js` | 8 / 8 | ✅ Pass |
| Entitlement & CAS Quota Service | `tests/unit/entitlement.service.test.js` | 15 / 15 | ✅ Pass |
| AI Orchestrator Core | `tests/unit/ai-orchestrator.test.js` | 9 / 9 | ✅ Pass |
| AI Orchestrator Product Search | `tests/unit/ai-orchestrator-product-search.test.js` | 7 / 7 | ✅ Pass |
| AI Product Search Entitlement | `tests/unit/ai-product-search-entitlement.test.js` | 11 / 11 | ✅ Pass |
| AI Product Render Step | `tests/unit/ai-product-render.test.js` | 4 / 4 | ✅ Pass |
| AI Image Entitlement | `tests/unit/ai-image-entitlement.test.js` | 12 / 12 | ✅ Pass |
| AI Orchestrator Image Step | `tests/unit/ai-orchestrator-image.test.js` | 5 / 5 | ✅ Pass |
| AI Try-On Entitlement | `tests/unit/ai-tryon-entitlement.test.js` | 15 / 15 | ✅ Pass |
| Stylist Golden Evaluation Harness | `tests/ai/golden/stylist-pipeline.eval.test.js` | 58 / 58 | ✅ Pass |
| **Total Automated Tests** | | **141 / 141** | **100% Pass** |

### Live Retest on MongoDB (`userId: 6ab288309e02fb995b1732f8`)
```
Request: "شوفلى طقم لخروجه شبابى كلاسك"
- Duplicate root key: false
- Outfits generated: 2 distinct looks
  * Look 1 (Score 95): Cream Polo Sweater + Dark Navy Jeans + Black Smart Shoes
  * Look 2 (Score 88): Cream Polo Sweater + Dark Navy Jeans + White Casual Sneakers
- Sufficiency: good
- Quota: 10th message succeeded, 11th message blocked with 429
```
