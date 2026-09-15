# Murafiq — Phase 15A–15F Postman Testing Guide

> **Authoritative Specification & Postman Testing Reference**  
> **Target Module:** AI Stylist Subsystem (`src/modules/ai/`)  
> **Phases Covered:** Phase 15A, 15B, 15C, 15D, 15E, 15F  
> **Source of Truth:** Actual Express Route Registration, Controllers, Validators, Services, and Mongoose Schemas  
> **Default Port:** `4000` (Defined in `src/config/env.config.js`)  
> **Base URL:** `http://localhost:4000/api/v1`

---

## 1. Discover All Phase 15 Routes

Below is the complete inventory of all routes associated with Phase 15 (including directly mounted `/ai` endpoints and tightly coupled upload/wardrobe bridge endpoints).

### 1.1 Direct AI Module Routes (`/api/v1/ai`)

These routes are declared in `src/modules/ai/ai.routes.js` and mounted at `/api/v1/ai` in `src/routes/index.js`.

| Phase | Method | Route | Auth Middleware | Role RBAC | Kill-Switch Guard | Controller Handler | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **15B** | `POST` | `/api/v1/ai/stylist` | `authMiddleware` | `client` | None | `aiController.handleStylistRequest` | End-to-end AI Stylist occasion styling, outfit retrieval & composition. |
| **15F** | `POST` | `/api/v1/ai/shape-model` | `authMiddleware` | `client` | `tryOnGuard` | `shapeModelController.createShapeModel` | Create or replace active Shape Model with client biometric consent. |
| **15F** | `GET` | `/api/v1/ai/shape-model` | `authMiddleware` | `client` | `tryOnGuard` | `shapeModelController.getActiveShapeModel` | Retrieve authenticated client's active Shape Model with 1-hour signed URL. |
| **15F** | `DELETE` | `/api/v1/ai/shape-model` | `authMiddleware` | `client` | `tryOnGuard` | `shapeModelController.deleteShapeModel` | Soft-delete active Shape Model and purge Cloudinary authenticated asset. |
| **15F** | `POST` | `/api/v1/ai/try-on` | `authMiddleware` | `client` | `tryOnGuard` | `tryOnController.createTryOn` | Submit Virtual Try-On generation request with pre-billing and deduplication. |
| **15F** | `GET` | `/api/v1/ai/try-on/:id` | `authMiddleware` | `client` | `tryOnGuard` | `tryOnController.getTryOnById` | Retrieve status, error, or signed result URL for a specific Try-On job. |
| **15F** | `GET` | `/api/v1/ai/try-on` | `authMiddleware` | `client` | `tryOnGuard` | `tryOnController.listTryOns` | List paginated history of Try-On generations for the authenticated client. |
| **15F** | `DELETE` | `/api/v1/ai/try-on/:id` | `authMiddleware` | `client` | `tryOnGuard` | `tryOnController.deleteTryOn` | Delete Try-On generation record and purge Cloudinary output asset. |

### 1.2 Supporting Bridge Endpoints

The AI subsystem depends on dedicated upload folders and wardrobe bridges. Testing Phase 15 without these endpoints is impossible:

| Phase | Method | Route | Auth Middleware | Role RBAC | Controller Handler | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **15C** | `POST` | `/api/v1/uploads/ai-chat` | `authMiddleware` | `client`, `admin` | `uploadController.uploadFile` | Upload garment photograph for multimodal styling (Flow B). Compressed to 768px. |
| **15C** | `POST` | `/api/v1/wardrobe/from-chat` | `authMiddleware` | `client` | `wardrobeController.saveFromChat` | Convert an uploaded chat image into a permanent wardrobe item via `saveMessageId`. |
| **15F** | `POST` | `/api/v1/uploads/shape-models` | `authMiddleware` | `client`, `admin` | `uploadController.uploadFile` | Upload full-body photo to private authenticated Cloudinary storage. |
| **Pre** | `POST` | `/api/v1/uploads/wardrobe` | `authMiddleware` | `client`, `admin` | `uploadController.uploadFile` | Upload wardrobe item photo for closet inventory seeding. |
| **Pre** | `POST` | `/api/v1/wardrobe` | `authMiddleware` | `client` | `wardrobeController.createWardrobeItem` | Register wardrobe item from `uploadRef` for classification and retrieval. |

### 1.3 Implementation vs. Documentation Discrepancies

1. **Phase 15A (Data Model & Retrieval Primitives):**
   * *Status:* **0 Public HTTP Routes.**
   * *Architecture:* Phase 15A implements internal Mongoose schemas (`StylePreference`, `Outfit`, `AiConversation`, `AiMessage`), constants (`DRESS_CODE_MAP`), and slot-based MongoDB retrieval (`wardrobeService.getCandidateGarmentsBySlot`). They are invoked directly by the stylist orchestrator (`src/modules/ai/stylist/stylist.orchestrator.js`).
2. **Phase 15D (Fashion Knowledge RAG):**
   * *Status:* **0 Public HTTP Routes.**
   * *Ingestion:* Run offline via CLI: `node scripts/ingest-fashion-knowledge.js`.
   * *Retrieval:* Executed automatically in-memory/vector via `knowledgeService.retrieveRelevantKnowledge()` within Step 5 of the stylist pipeline.
3. **Phase 15E (External Product Search):**
   * *Status:* **0 Standalone Product Search Routes.**
   * *Execution:* Executed within `POST /api/v1/ai/stylist` when wardrobe sufficiency is `'partial'` or `'none'` and the user possesses `ai.productSearch.daily` quota.
4. **Middleware Execution Order in `ai.routes.js`:**
   * *Observation:* For Shape Model and Try-On routes, `tryOnGuard` is placed *before* `authMiddleware`.
   * *Effect:* When `AI_TRY_ON_ENABLED=false`, requests immediately return `404 Not Found` without validating authentication or tokens, preventing route enumeration.

---

## 2. Postman Environment

Create an environment in Postman named **`Murafiq - Local Dev`** with the following variables:

| Variable | Initial Value | Current Value | Description & How to Obtain |
| :--- | :--- | :--- | :--- |
| `baseUrl` | `http://localhost:4000/api/v1` | `http://localhost:4000/api/v1` | Project root API prefix (`PORT=4000` in `src/config/env.config.js`). |
| `accessToken` | *(Empty)* | *(Extracted)* | JWT returned from `POST /auth/login` (User A - Client). |
| `refreshToken` | *(Empty)* | *(Extracted)* | Refresh token returned from `POST /auth/login`. |
| `userId` | *(Empty)* | *(Extracted)* | User ID of User A (`data.user.id`). |
| `accessTokenB` | *(Empty)* | *(Extracted)* | JWT for User B (Attacker / Second Client for IDOR). |
| `userIdB` | *(Empty)* | *(Extracted)* | User ID of User B (`data.user.id`). |
| `stylistToken` | *(Empty)* | *(Extracted)* | JWT for a Stylist user (for 403 RBAC verification). |
| `conversationId` | *(Empty)* | *(Extracted)* | Created automatically or passed into `POST /ai/stylist`. |
| `chatImageRef` | *(Empty)* | *(Extracted)* | Cloudinary public ID from `POST /uploads/ai-chat` (`murafiq/ai-chat/<userId>/<uuid>`). |
| `saveMessageId` | *(Empty)* | *(Extracted)* | Returned in `data.saveMessageId` from `POST /ai/stylist` when an image is attached. |
| `wardrobeItemId` | *(Empty)* | *(Extracted)* | Created via `POST /wardrobe` or `POST /wardrobe/from-chat`. |
| `shapeModelImageRef` | *(Empty)* | *(Extracted)* | Cloudinary public ID from `POST /uploads/shape-models`. |
| `shapeModelId` | *(Empty)* | *(Extracted)* | Created via `POST /ai/shape-model` (`data.id`). |
| `tryOnGenerationId` | *(Empty)* | *(Extracted)* | Created via `POST /ai/try-on` (`data.id`). |

---

## 3. Global Headers

Every request in Postman must specify headers according to the payload type:

### Standard JSON Endpoints

```http
Authorization: Bearer {{accessToken}}
Content-Type: application/json
```

### Auth Endpoints (Dual-Delivery Mode)

> [!IMPORTANT]
> The Murafiq auth middleware (`src/modules/auth/auth.controller.js`) delivers tokens via `httpOnly` cookies for `web` clients. To receive `accessToken` and `refreshToken` directly in the JSON response body for Postman variable extraction, **you must include `X-Client-Type: mobile`**.

```http
Content-Type: application/json
X-Client-Type: mobile
```

### Multipart File Upload Endpoints

For `POST /api/v1/uploads/:folder`:

```http
Authorization: Bearer {{accessToken}}
```

*(Do **not** set `Content-Type: multipart/form-data` manually in Postman; let Postman automatically append the multipart boundary parameter).*

---

## 4. Authentication Setup

### Step 4.1: Register Client User A

* **Method:** `POST`
* **URL:** `{{baseUrl}}/auth/register`
* **Headers:**
  * `Content-Type: application/json`
  * `X-Client-Type: mobile`
* **Body (raw JSON):**

```json
{
  "name": "Ahmed Ayman",
  "email": "client.a@murafiq.dev",
  "password": "Password123!",
  "confirmpassword": "Password123!",
  "gender": "male",
  "role": "client"
}
```

* **Expected Response (`201 Created`):**

```json
{
  "success": true,
  "message": "Registration successful. Check your email for a verification code (or request a new one if not received).",
  "data": {
    "user": {
      "id": "66e5f32b842345001a111111",
      "name": "Ahmed Ayman",
      "email": "client.a@murafiq.dev",
      "role": "client",
      "isEmailVerified": false
    }
  }
}
```

### Step 4.2: Verify Email OTP

* **Method:** `POST`
* **URL:** `{{baseUrl}}/auth/verify-email`
* **Headers:**
  * `Content-Type: application/json`
* **Body (raw JSON):**

*(In development, check server console logs for the 6-digit OTP)*

```json
{
  "email": "client.a@murafiq.dev",
  "otp": "123456"
}
```

* **Expected Response (`200 OK`):**

```json
{
  "success": true,
  "message": "Email verified successfully. You can now log in.",
  "data": {
    "user": {
      "id": "66e5f32b842345001a111111",
      "email": "client.a@murafiq.dev",
      "isEmailVerified": true
    }
  }
}
```

### Step 4.3: Login Client User A

* **Method:** `POST`
* **URL:** `{{baseUrl}}/auth/login`
* **Headers:**
  * `Content-Type: application/json`
  * `X-Client-Type: mobile`
* **Body (raw JSON):**

```json
{
  "email": "client.a@murafiq.dev",
  "password": "Password123!"
}
```

* **Expected Response (`200 OK`):**

```json
{
  "success": true,
  "message": "Login successful.",
  "data": {
    "user": {
      "id": "66e5f32b842345001a111111",
      "name": "Ahmed Ayman",
      "email": "client.a@murafiq.dev",
      "role": "client"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "d7a46e138bb5c7..."
  }
}
```

* **Postman `Tests` Script to Extract Credentials:**

```javascript
if (pm.response.code === 200) {
    const json = pm.response.json();
    if (json.data && json.data.accessToken) {
        pm.environment.set("accessToken", json.data.accessToken);
        pm.environment.set("refreshToken", json.data.refreshToken);
        pm.environment.set("userId", json.data.user.id);
        console.log("Extracted accessToken and userId for User A:", json.data.user.id);
    }
}
```

---

## 5. Phase 15A Testing (Data Model & Retrieval Primitives)

### 5.1 Architecture & Scope Verification

In Murafiq, Phase 15A is deliberately **AI-free and route-free**. Its purpose is to implement:
1. `DRESS_CODE_MAP` with 21 canonical occasions (`src/common/constants/dress-code.constant.js`).
2. Mongoose Schemas:
   * `StylePreference`: `{ userId: 1 }` (unique).
   * `Outfit`: `{ userId: 1, createdAt: -1 }` (compound index; strictly NO `visualizationUrl`).
   * `AiConversation`: `{ userId: 1, lastMessageAt: -1 }`.
   * `AiMessage`: `{ conversationId: 1, createdAt: 1 }`.
3. Slot-based deterministic retrieval in `wardrobeService.getCandidateGarmentsBySlot(userId, options)`.

### 5.2 Verification via Postman

Because Phase 15A exposes no direct endpoints, its primitives are verified through the Stylist route (`POST /api/v1/ai/stylist`) and Wardrobe inventory:

#### Test Case 15A-1: Verify No Standalone `/api/v1/ai` Root
* **Method:** `GET`
* **URL:** `{{baseUrl}}/ai`
* **Expected:** `404 Not Found` (Express 404 handler).

#### Test Case 15A-2: Verify Style Preference Laziness
* When `POST /api/v1/ai/stylist` executes, `stylePreferenceService.getOrCreate(userId)` automatically resolves or lazily provisions a default `StylePreference` record without throwing `404`.

#### Test Case 15A-3: Slot-Based Wardrobe Candidate Filtering
* Seed User A's wardrobe with items of varying formality (`formal` suit vs `casual` t-shirt).
* Requesting a `wedding_formal` event returns only the formal candidates in `fromYourWardrobe[]`.

---

## 6. Phase 15B Testing (AI Stylist Pipeline)

### 6.1 Route Specification

* **Method:** `POST`
* **URL:** `{{baseUrl}}/ai/stylist`
* **Auth:** Bearer Token (`client` role required)
* **Zod Validator:** `stylistRequestSchema` (`src/modules/ai/ai.validator.js`)
* **Constraints:** `.strict()` rejection of undeclared body properties.

### 6.2 Request Body Schema

```json
{
  "message": "string (min 1, max 500 characters, required)",
  "conversationId": "string (optional, ObjectId format)",
  "imageRef": "string (optional, format: murafiq/ai-chat/<userId>/<uuid>)"
}
```

### 6.3 Response Body Schema (`200 OK`)

```json
{
  "success": true,
  "message": "Stylist outfits generated successfully",
  "data": {
    "fromYourWardrobe": [
      {
        "outfitId": "66e5f32b842345001a222222",
        "score": 95,
        "rationale": "Crisp white tailored shirt paired with black formal trousers.",
        "anchor": null,
        "fromYourWardrobe": [
          {
            "itemId": "66e5f32b842345001a333333",
            "name": "White Formal Shirt",
            "category": "top",
            "subcategory": "dress shirt",
            "imageUrl": "https://res.cloudinary.com/murafiq/image/upload/v1/sample.jpg",
            "primaryColor": "white",
            "formality": "formal",
            "material": "cotton"
          }
        ]
      }
    ],
    "outfits": [ ... ],
    "sufficiency": "good",
    "missingSlots": [],
    "gapDescriptions": [],
    "suggestedToAcquire": [],
    "suggestBookStylist": false,
    "stylistBookingCta": null,
    "anchor": null,
    "matchHint": null,
    "canSaveToWardrobe": false,
    "saveToWardrobeCta": null,
    "saveMessageId": "66e5f32b842345001a444444",
    "language": "en"
  }
}
```

---

### 6.4 Realistic Postman Examples

#### Example 1: Formal Wedding Request (Happy Path)

* **Method:** `POST`
* **URL:** `{{baseUrl}}/ai/stylist`
* **Headers:**
  * `Authorization: Bearer {{accessToken}}`
  * `Content-Type: application/json`
* **Body:**

```json
{
  "message": "I have a formal Egyptian wedding tomorrow evening at a hotel ballroom. What should I wear from my wardrobe?"
}
```

* **Expected Status:** `200 OK`
* **Test Verification:**
  * `data.sufficiency` is `'good'` or `'partial'`.
  * `data.language` is `'en'`.
  * `data.fromYourWardrobe` contains valid outfits with genuine item IDs from User A's wardrobe.

#### Example 2: Arabic Formal Occasion (Egyptian Wedding / فرح مصري)

* **Method:** `POST`
* **URL:** `{{baseUrl}}/ai/stylist`
* **Headers:**
  * `Authorization: Bearer {{accessToken}}`
  * `Content-Type: application/json`
* **Body:**

```json
{
  "message": "عندي فرح صاحبي في فندق الأسبوع الجاي، محتاج بدلة أو طقم رسمي شيك."
}
```

* **Expected Status:** `200 OK`
* **Test Verification:**
  * `data.language` is `'ar'`.
  * `rationale` in each outfit is written in modern, fluent Arabic.

#### Example 3: Casual Summer Day (خروجة كاجوال في الصيف)

* **Method:** `POST`
* **URL:** `{{baseUrl}}/ai/stylist`
* **Body:**

```json
{
  "message": "Going out for a casual lunch with friends in New Cairo on a hot summer afternoon."
}
```

* **Expected Status:** `200 OK`
* **Test Verification:**
  * `data.fromYourWardrobe` contains lightweight/casual items (`t-shirt`, `chinos`, `sneakers`).

#### Example 4: Out-of-Domain Request (Scope Guard Refusal)

* **Method:** `POST`
* **URL:** `{{baseUrl}}/ai/stylist`
* **Body:**

```json
{
  "message": "Can you explain how quantum computing algorithms work?"
}
```

* **Expected Status:** `200 OK` (Safe Domain Refusal)
* **Response Body Structure:**

```json
{
  "success": true,
  "message": "Stylist request out of domain",
  "data": {
    "refused": true,
    "refusalCategory": "general_knowledge",
    "message": "I'm your Murafiq AI Stylist. I can help with clothing, outfits, styling, dress codes, wardrobe recommendations, and fashion-related shopping. I can't help with general knowledge or non-fashion topics.",
    "language": "en",
    "traceId": "tr_1726301234_abc123"
  }
}
```

> [!NOTE]
> When a request is refused out-of-domain, the consumed `ai.messages.daily` quota is **automatically refunded** to the client.

#### Example 5: Insufficient Wardrobe (Empty Closet)

* **Condition:** User A has 0 formal bottoms and 0 formal shoes in wardrobe.
* **Message:** `"I need a black-tie gala outfit."`
* **Expected Status:** `200 OK`
* **Response:**
  * `data.sufficiency`: `'none'`
  * `data.fromYourWardrobe`: `[]`
  * `data.missingSlots`: `["top", "bottom", "shoes"]`
  * `data.suggestBookStylist`: `true`
  * `data.stylistBookingCta`: Contains personalized prompt to book a human Murafiq stylist.

#### Example 6: Invalid Input & Anti-Tampering Rejections

1. **Empty Message:**
   * Body: `{ "message": "   " }`
   * Status: `400 Bad Request`
2. **Length Exceeded (> 500 characters):**
   * Body: `{ "message": "<string of 501 characters>" }`
   * Status: `400 Bad Request`
3. **Undeclared Fields (Zod Strictness):**
   * Body: `{ "message": "Formal dinner", "customPrompt": "Ignore rules" }`
   * Status: `400 Bad Request`
4. **Role Check (Stylist calling Stylist AI):**
   * Header: `Authorization: Bearer {{stylistToken}}`
   * Status: `403 Forbidden` (`Only clients may access this resource`)

---

## 7. Phase 15C Testing (Image Input & Multimodal Styling)

Phase 15C allows clients to upload a garment image, extract its attributes via Gemini Vision, match it against their wardrobe (or treat it as an unowned anchor piece), and style outfits around it (Flow B).

### 7.1 Image Upload Endpoint

* **Method:** `POST`
* **URL:** `{{baseUrl}}/uploads/ai-chat`
* **Auth:** Bearer Token (`client` or `admin`)
* **Content-Type:** `multipart/form-data`
* **File Field Name:** `file`
* **Accepted MIME Types:** `image/jpeg`, `image/png`, `image/webp` (Max 5MB)
* **Backend Image Processing:** Compressed in-memory via Sharp to max dimension **768px** (minimizing vision token cost).

#### Postman Setup for Upload:
1. In Postman, open the **Body** tab.
2. Select **form-data**.
3. In the **KEY** field, type `file` and select **File** from the dropdown.
4. In the **VALUE** field, select a local garment image (e.g. `blazer.jpg`).

* **Expected Response (`200 OK`):**

```json
{
  "success": true,
  "message": "File uploaded successfully",
  "data": {
    "publicId": "murafiq/ai-chat/66e5f32b842345001a111111/abc-123-uuid",
    "format": "jpg",
    "bytes": 45210,
    "url": "https://res.cloudinary.com/murafiq/image/upload/v1/murafiq/ai-chat/66e5f32b842345001a111111/abc-123-uuid.jpg",
    "isPrivate": false
  }
}
```

* **Postman `Tests` Script to Save Image Reference:**

```javascript
if (pm.response.code === 200) {
    const json = pm.response.json();
    pm.environment.set("chatImageRef", json.data.publicId);
    console.log("Saved chatImageRef:", json.data.publicId);
}
```

---

### 7.2 Multimodal Stylist Request (Flow B)

* **Method:** `POST`
* **URL:** `{{baseUrl}}/ai/stylist`
* **Headers:**
  * `Authorization: Bearer {{accessToken}}`
  * `Content-Type: application/json`
* **Body:**

```json
{
  "message": "How should I style this new blazer for an engagement party?",
  "imageRef": "{{chatImageRef}}"
}
```

* **Expected Response (`200 OK`):**

```json
{
  "success": true,
  "message": "Stylist outfits generated successfully",
  "data": {
    "fromYourWardrobe": [
      {
        "outfitId": "66e5f32b842345001a555555",
        "score": 90,
        "rationale": "Anchor navy blazer complemented with grey dress trousers and black leather oxfords.",
        "anchor": {
          "id": "anchor_item",
          "category": "outerwear",
          "colorFamily": "navy",
          "formality": "formal",
          "isAnchor": true
        },
        "fromYourWardrobe": [ ... ]
      }
    ],
    "canSaveToWardrobe": true,
    "saveToWardrobeCta": "Would you like to save this piece to your wardrobe for future styling?",
    "saveMessageId": "66e5f32b842345001a666666"
  }
}
```

* **Save `saveMessageId` in Postman `Tests`:**

```javascript
if (pm.response.code === 200) {
    const json = pm.response.json();
    if (json.data && json.data.saveMessageId) {
        pm.environment.set("saveMessageId", json.data.saveMessageId);
    }
}
```

---

### 7.3 Save Garment from Chat to Wardrobe

* **Method:** `POST`
* **URL:** `{{baseUrl}}/wardrobe/from-chat`
* **Headers:**
  * `Authorization: Bearer {{accessToken}}`
  * `Content-Type: application/json`
* **Body:**

```json
{
  "messageId": "{{saveMessageId}}"
}
```

* **Expected Response (`201 Created`):**

```json
{
  "success": true,
  "message": "Wardrobe item saved from chat successfully",
  "data": {
    "id": "66e5f32b842345001a777777",
    "category": "outerwear",
    "subcategory": "blazer",
    "primaryColor": "navy",
    "formality": "formal",
    "classificationStatus": "done"
  }
}
```

* **Postman `Tests` Script to Save Item ID:**

```javascript
if (pm.response.code === 201) {
    const json = pm.response.json();
    pm.environment.set("wardrobeItemId", json.data.id);
}
```

---

## 8. Phase 15D Testing (Fashion Knowledge RAG)

### 8.1 Architecture & Ingestion

Phase 15D does **not** expose a public HTTP route. Editorial fashion guidelines are maintained in markdown files under `content/fashion-knowledge/`:
* `dress-codes.md` (Formal, Black Tie, Cocktail, Smart Casual)
* `egyptian-regional-norms.md` (Cairo weddings, North Coast summer, Ramadan / Eid modest fashion)
* `color-theory.md` (Monochromatic, Analogous, Complementary)
* `silhouette-layering.md` (Balancing volumes, outerwear layering)
* `fabric-seasonality.md` (Linen, Wool, Egyptian cotton)

### 8.2 Executing the Ingestion Pipeline

To populate MongoDB and the Upstash Knowledge Base Vector index:

```bash
# Dry run verification (does not mutate database or Upstash)
node scripts/ingest-fashion-knowledge.js --dry-run

# Production/Development Ingestion
node scripts/ingest-fashion-knowledge.js
```

### 8.3 Verifying RAG Retrieval via Postman

1. Ensure the ingestion script has been executed.
2. In Postman, invoke `POST /api/v1/ai/stylist` with a culturally specific styling prompt:

```json
{
  "message": "I'm attending an upscale Katameya Heights engagement party in Cairo during early September. What fabric and color rules should I follow?"
}
```

3. **Verify Response:**
   * Inspect `rationale` in `fromYourWardrobe[]`.
   * The rationale reflects specific Egyptian context from `egyptian-regional-norms.md` and fabric rules from `fabric-seasonality.md` (e.g. breathable cotton/linen blends, evening formal decorum).

---

## 9. Phase 15E Testing (External Product Search & Gap Closing)

Phase 15E bridges the client's wardrobe gaps using Google Search Grounding with Gemini 3.1 Flash Lite.

### 9.1 Entitlement & Cache Rules

* **Quota Metric:** `ai.productSearch.daily` (Free = 0/day, Basic = 1/day, Mid = 3/day, Pro = 5/day, Enterprise = 10/day).
* **Redis Cache Key:** `ai:product-search:{season}:{gender}:{queryHash}` (TTL = 86,400s / 24 hours).
* **Strict Isolation:** Owned wardrobe pieces appear in `fromYourWardrobe[]`; external recommendations appear strictly in `suggestedToAcquire[]`.

---

### 9.2 Test Cases

#### Case A: Sufficient Wardrobe
* **Precondition:** User A's wardrobe contains all required slots for the event (e.g. formal shirt, trousers, shoes).
* **Request:**

```json
{
  "message": "Formal business presentation next Tuesday morning."
}
```

* **Expected Response:**
  * `data.sufficiency`: `'good'`
  * `data.fromYourWardrobe`: 1–2 complete outfits.
  * `data.suggestedToAcquire`: `[]` (Empty array).

---

#### Case B: Partial Wardrobe (With Available Search Quota)
* **Precondition:** User A has a formal suit and shirt, but **no dress shoes**. User A possesses at least 1 `ai.productSearch.daily` quota.
* **Request:**

```json
{
  "message": "I need an outfit for an executive interview tomorrow, but I don't have suitable formal shoes."
}
```

* **Expected Response:**
  * `data.sufficiency`: `'partial'`
  * `data.missingSlots`: `["shoes"]`
  * `data.gapDescriptions`: `["black polished leather oxford shoes"]`
  * `data.fromYourWardrobe`: Outfits using owned shirt + trousers.
  * `data.suggestedToAcquire`: Grounded product suggestions:

```json
{
  "suggestedToAcquire": [
    {
      "slot": "shoes",
      "itemType": "black oxford shoes",
      "title": "Zara Men Classic Leather Oxford Shoes",
      "description": "Black polished genuine leather dress shoes with lace-up closure.",
      "estimatedPriceEgp": 2490,
      "retailer": "Zara Egypt",
      "sourceUrl": "https://www.zara.com/eg/...",
      "sourceTitle": "Zara Egypt",
      "citations": [
        {
          "title": "Zara Egypt Men Shoes",
          "url": "https://www.zara.com/eg/..."
        }
      ],
      "isGrounded": true
    }
  ]
}
```

---

#### Case C: Product Search Quota Exhausted (Graceful Degradation)
* **Precondition:** User A has `ai.productSearch.daily` exhausted (or is on Client Free plan with 0 limit).
* **Request:**

```json
{
  "message": "I need an outfit for an executive interview tomorrow, but I don't have suitable formal shoes."
}
```

* **Expected Response:**
  * `data.sufficiency`: `'partial'`
  * `data.missingSlots`: `["shoes"]`
  * `suggestedToAcquire`: Falls back to **ungrounded template suggestions** without throwing an error:

```json
{
  "suggestedToAcquire": [
    {
      "slot": "shoes",
      "itemType": "Polished formal leather dress shoes, oxfords, or classic evening heels",
      "title": "Polished formal leather dress shoes, oxfords, or classic evening heels",
      "description": "Polished formal leather dress shoes, oxfords, or classic evening heels",
      "estimatedPriceEgp": null,
      "retailer": null,
      "sourceUrl": null,
      "sourceTitle": null,
      "citations": [],
      "isGrounded": false
    }
  ]
}
```

---

## 10. Phase 15F Testing (Shape Model Subsystem)

The Shape Model represents the client's full-body biometric reference photo for Virtual Try-On.

### 10.1 Step 1: Upload Shape Model Photo to Cloudinary

* **Method:** `POST`
* **URL:** `{{baseUrl}}/uploads/shape-models`
* **Headers:**
  * `Authorization: Bearer {{accessToken}}`
* **Body:** `form-data` with key `file` (Select a full-body photograph)

* **Expected Response (`200 OK`):**

```json
{
  "success": true,
  "message": "File uploaded successfully",
  "data": {
    "publicId": "murafiq/shape-models/66e5f32b842345001a111111/fullbody-photo-uuid",
    "format": "jpg",
    "bytes": 524288,
    "url": "https://res.cloudinary.com/murafiq/image/authenticated/s--xyz--/v1/murafiq/shape-models/...",
    "isPrivate": true
  }
}
```

* **Save in Postman `Tests`:**

```javascript
if (pm.response.code === 200) {
    const json = pm.response.json();
    pm.environment.set("shapeModelImageRef", json.data.publicId);
}
```

---

### 10.2 Step 2: Create or Replace Active Shape Model

* **Method:** `POST`
* **URL:** `{{baseUrl}}/ai/shape-model`
* **Headers:**
  * `Authorization: Bearer {{accessToken}}`
  * `Content-Type: application/json`
* **Body (raw JSON):**

```json
{
  "imageRef": "{{shapeModelImageRef}}",
  "consent": true,
  "format": "jpg",
  "bytes": 524288,
  "width": 1080,
  "height": 1920
}
```

* **Expected Response (`201 Created`):**

```json
{
  "success": true,
  "message": "Shape model created successfully",
  "data": {
    "id": "66e5f32b842345001a888888",
    "status": "active",
    "format": "jpg",
    "width": 1080,
    "height": 1920,
    "bytes": 524288,
    "signedUrl": "https://res.cloudinary.com/.../image/authenticated/s--abc--/...?expires_at=...",
    "consentAt": "2026-09-14T05:00:00.000Z",
    "createdAt": "2026-09-14T05:00:00.000Z",
    "replacedAt": null
  }
}
```

* **Save Shape Model ID in Postman `Tests`:**

```javascript
if (pm.response.code === 201) {
    const json = pm.response.json();
    pm.environment.set("shapeModelId", json.data.id);
}
```

---

### 10.3 Step 3: Get Active Shape Model

* **Method:** `GET`
* **URL:** `{{baseUrl}}/ai/shape-model`
* **Headers:**
  * `Authorization: Bearer {{accessToken}}`
* **Expected Response (`200 OK`):**

```json
{
  "success": true,
  "message": "Active shape model retrieved",
  "data": {
    "id": "{{shapeModelId}}",
    "status": "active",
    "signedUrl": "https://res.cloudinary.com/...signed_url...",
    "consentAt": "2026-09-14T05:00:00.000Z"
  }
}
```

---

### 10.4 Step 4: Delete Active Shape Model

* **Method:** `DELETE`
* **URL:** `{{baseUrl}}/ai/shape-model`
* **Headers:**
  * `Authorization: Bearer {{accessToken}}`
* **Expected Response (`200 OK`):**

```json
{
  "success": true,
  "message": "Shape model deleted successfully",
  "data": null
}
```

---

## 11. Phase 15F Testing (Virtual Try-On Generation & Polling)

### 11.1 Create Try-On Generation

* **Method:** `POST`
* **URL:** `{{baseUrl}}/ai/try-on`
* **Headers:**
  * `Authorization: Bearer {{accessToken}}`
  * `Content-Type: application/json`
* **Body Schema Validation (`createTryOnSchema`):**
  * `shapeModelId`: 24-character hex ObjectId (must belong to authenticated client and be active).
  * `garments`: Array of 1 to 4 items. Supported sources:
    * `wardrobe`: `{ "source": "wardrobe", "itemId": "{{wardrobeItemId}}" }`
    * `upload`: `{ "source": "upload", "imageRef": "{{chatImageRef}}", "slot": "top" }`
  * `resolution`: `'512x512'` or `'1024x1024'` (default: `'1024x1024'`).
  * `promptVersion`: string (default: `'v1'`).

#### Request Body:

```json
{
  "shapeModelId": "{{shapeModelId}}",
  "garments": [
    {
      "source": "wardrobe",
      "itemId": "{{wardrobeItemId}}"
    }
  ],
  "resolution": "1024x1024",
  "promptVersion": "v1"
}
```

* **Expected Response (`202 Accepted`):**

```json
{
  "success": true,
  "message": "Try-on request accepted for processing",
  "data": {
    "id": "66e5f32b842345001a999999",
    "shapeModelId": "{{shapeModelId}}",
    "garments": [
      {
        "source": "wardrobe",
        "itemId": "{{wardrobeItemId}}",
        "imageRef": null,
        "slot": "outerwear",
        "label": "Navy Blazer"
      }
    ],
    "status": "pending",
    "resolution": "1024x1024",
    "promptVersion": "v1",
    "attempts": 0,
    "result": null,
    "error": null,
    "createdAt": "2026-09-14T05:10:00.000Z"
  }
}
```

* **Save Generation ID in Postman `Tests`:**

```javascript
if (pm.response.code === 202 || pm.response.code === 200) {
    const json = pm.response.json();
    pm.environment.set("tryOnGenerationId", json.data.id);
    console.log("Saved tryOnGenerationId:", json.data.id);
}
```

---

### 11.2 24-Hour Deterministic Deduplication (Decision Q2)

If the identical request (same `userId`, `shapeModelId`, sorted garments, and `promptVersion`) is re-submitted:
1. **While Pending/Processing:** Returns HTTP `202 Accepted` pointing to the existing job without re-billing.
2. **When Completed (within 24 hours):** Returns HTTP `200 OK` pointing to the cached result with message `"Completed try-on retrieved from cache"`, without consuming quota or enqueuing duplicate BullMQ jobs.

---

### 11.3 Poll Try-On Generation Status

* **Method:** `GET`
* **URL:** `{{baseUrl}}/ai/try-on/{{tryOnGenerationId}}`
* **Headers:**
  * `Authorization: Bearer {{accessToken}}`

#### Status Progression:
1. **Pending / Processing:**
   * `data.status`: `"pending"` or `"processing"`
   * `data.result`: `null`
2. **Completed:**

```json
{
  "success": true,
  "message": "Try-on generation retrieved",
  "data": {
    "id": "{{tryOnGenerationId}}",
    "status": "completed",
    "resolution": "1024x1024",
    "attempts": 1,
    "result": {
      "signedUrl": "https://res.cloudinary.com/murafiq/image/authenticated/s--def--/v1/murafiq/try-on-results/.../tryon_result.jpg?expires_at=...",
      "completedAt": "2026-09-14T05:11:15.000Z"
    },
    "error": null
  }
}
```

3. **Failed (Terminal Failure with Automatic Refund Guarantee):**

```json
{
  "success": true,
  "message": "Try-on generation retrieved",
  "data": {
    "id": "{{tryOnGenerationId}}",
    "status": "failed",
    "attempts": 2,
    "result": null,
    "error": {
      "message": "Image generation API timed out",
      "failedAt": "2026-09-14T05:12:00.000Z"
    }
  }
}
```

> [!IMPORTANT]
> When a Try-On job fails terminally (`attempts >= 2`), the BullMQ worker (`src/jobs/workers/tryon-generation.worker.js`) automatically refunds the pre-billed quota (`ai.tryOn.monthly` or `ai.tryOn.trial.lifetime`) to the user.

---

### 11.4 List Try-On History

* **Method:** `GET`
* **URL:** `{{baseUrl}}/ai/try-on?page=1&limit=10`
* **Headers:**
  * `Authorization: Bearer {{accessToken}}`
* **Expected Response (`200 OK`):**

```json
{
  "success": true,
  "message": "Try-on generations retrieved",
  "data": [
    {
      "id": "{{tryOnGenerationId}}",
      "status": "completed",
      "result": { ... }
    }
  ],
  "meta": {
    "total": 1,
    "page": 1,
    "totalPages": 1
  }
}
```

---

### 11.5 Delete Try-On Generation

* **Method:** `DELETE`
* **URL:** `{{baseUrl}}/ai/try-on/{{tryOnGenerationId}}`
* **Headers:**
  * `Authorization: Bearer {{accessToken}}`
* **Expected Response (`200 OK`):**

```json
{
  "success": true,
  "message": "Try-on generation deleted successfully",
  "data": null
}
```

---

## 12. Phase 15F Feature Isolation & Kill-Switch Testing

Approved Decision Q1 dictates that when `AI_TRY_ON_ENABLED=false`, the Virtual Try-On subsystem must be completely dormant and return `404 Not Found` across all 15F routes without leaking existence or consuming quotas.

### 12.1 Disable Virtual Try-On in `.env`

```ini
AI_TRY_ON_ENABLED=false
```

Restart the application (`npm run dev`).

### 12.2 Verification in Postman

| Request | Method | URL | Expected Status | Response Message |
| :--- | :--- | :--- | :--- | :--- |
| Create Shape Model | `POST` | `{{baseUrl}}/ai/shape-model` | **`404 Not Found`** | `"Not found"` |
| Get Shape Model | `GET` | `{{baseUrl}}/ai/shape-model` | **`404 Not Found`** | `"Not found"` |
| Delete Shape Model | `DELETE` | `{{baseUrl}}/ai/shape-model` | **`404 Not Found`** | `"Not found"` |
| Create Try-On | `POST` | `{{baseUrl}}/ai/try-on` | **`404 Not Found`** | `"Not found"` |
| Get Try-On by ID | `GET` | `{{baseUrl}}/ai/try-on/{{tryOnGenerationId}}` | **`404 Not Found`** | `"Not found"` |
| List Try-Ons | `GET` | `{{baseUrl}}/ai/try-on` | **`404 Not Found`** | `"Not found"` |

### 12.3 Verify Phases 15A–15E Still Function Normally

With `AI_TRY_ON_ENABLED=false`:
* Send `POST {{baseUrl}}/ai/stylist` with `{ "message": "Formal wedding tomorrow" }`.
* **Result:** Returns `200 OK` with full outfit recommendations. This confirms that disabling Virtual Try-On has zero negative side-effects on the core AI Stylist.

---

## 13. Security & IDOR Testing

### 13.1 Authentication Failures

1. **Missing Token:**
   * `POST {{baseUrl}}/ai/stylist` without `Authorization` header.
   * **Result:** `401 Unauthorized`.
2. **Invalid / Malformed Token:**
   * Header: `Authorization: Bearer invalid_jwt_token`
   * **Result:** `401 Unauthorized`.
3. **Expired Token:**
   * Header with expired JWT.
   * **Result:** `401 Unauthorized`.

---

### 13.2 RBAC Role Restrictions

1. **Stylist Role Blocked:**
   * Header: `Authorization: Bearer {{stylistToken}}`
   * Call `POST {{baseUrl}}/ai/stylist` or `POST {{baseUrl}}/ai/try-on`.
   * **Result:** `403 Forbidden` (`Only clients may access this resource`).

---

### 13.3 Insecure Direct Object Reference (IDOR) Attacks

For these tests, use **User B** (`accessTokenB` / `userIdB`) to attack **User A's** resources:

#### IDOR Attack 1: User B tries to hijack User A's Shape Model
* **Method:** `POST`
* **URL:** `{{baseUrl}}/ai/try-on`
* **Headers:** `Authorization: Bearer {{accessTokenB}}`
* **Body:**

```json
{
  "shapeModelId": "{{shapeModelId}}",
  "garments": [
    {
      "source": "upload",
      "imageRef": "murafiq/ai-chat/{{userIdB}}/garment_uuid",
      "slot": "top"
    }
  ]
}
```

* **Expected Result:** `403 Forbidden` (`Forbidden: You do not own this shape model`).

#### IDOR Attack 2: User B tries to use User A's Wardrobe Item in Try-On
* **Method:** `POST`
* **URL:** `{{baseUrl}}/ai/try-on`
* **Headers:** `Authorization: Bearer {{accessTokenB}}`
* **Body:**

```json
{
  "shapeModelId": "{{shapeModelIdB}}",
  "garments": [
    {
      "source": "wardrobe",
      "itemId": "{{wardrobeItemId}}"
    }
  ]
}
```

* **Expected Result:** `404 Not Found` (Wardrobe ownership check isolates item).

#### IDOR Attack 3: User B attempts to forge image upload path
* **Method:** `POST`
* **URL:** `{{baseUrl}}/ai/shape-model`
* **Headers:** `Authorization: Bearer {{accessTokenB}}`
* **Body:**

```json
{
  "imageRef": "murafiq/shape-models/{{userId}}/forged_uuid",
  "consent": true
}
```

* **Expected Result:** `400 Bad Request` (`imageRef must be a valid shape-models path scoped to the user`).

#### IDOR Attack 4: User B attempts to read User A's Try-On Result
* **Method:** `GET`
* **URL:** `{{baseUrl}}/ai/try-on/{{tryOnGenerationId}}`
* **Headers:** `Authorization: Bearer {{accessTokenB}}`
* **Expected Result:** `403 Forbidden` (`Forbidden: You do not have access to this try-on generation`).

#### IDOR Attack 5: User B attempts to delete User A's Try-On Record
* **Method:** `DELETE`
* **URL:** `{{baseUrl}}/ai/try-on/{{tryOnGenerationId}}`
* **Headers:** `Authorization: Bearer {{accessTokenB}}`
* **Expected Result:** `403 Forbidden` (`Forbidden: You do not have permission to delete this generation`).

---

## 14. Quota Testing & Entitlement Verification

Murafiq enforces quotas through the `UsageCounter` collection (`src/modules/subscriptions/usage-counter.model.js`) and `entitlementService`.

### 14.1 Phase 15 Client Entitlement Limits by Plan

| Metric | Granularity | Client Free | Client Basic | Client Mid | Client Pro | Client Enterprise |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `ai.messages.daily` | Daily (Cairo Midnight) | 3 / day | 10 / day | 35 / day | 80 / day | 150 / day |
| `ai.imageMessages.daily` | Daily (Cairo Midnight) | 1 / day | 3 / day | 10 / day | 25 / day | 60 / day |
| `ai.productSearch.daily` | Daily (Cairo Midnight) | 0 / day | 1 / day | 3 / day | 5 / day | 10 / day |
| `ai.tryOn.monthly` | Monthly (Cairo 1st) | 0 / month | 5 / month | 15 / month | 30 / month | 75 / month |
| `ai.tryOn.trial.lifetime` | Lifetime Trial | 1 trial | 0 | 0 | 0 | 0 |

---

### 14.2 Quota Exhaustion Test Walkthrough

#### Step 1: Exhaust `ai.messages.daily` on Free Tier (Limit = 3)
1. Send Request 1 to `POST /ai/stylist`: Status `200 OK`.
2. Send Request 2 to `POST /ai/stylist`: Status `200 OK`.
3. Send Request 3 to `POST /ai/stylist`: Status `200 OK`.
4. Send Request 4 to `POST /ai/stylist`:
   * **Status:** `429 Too Many Requests`
   * **Response Body:**

```json
{
  "success": false,
  "message": "Daily quota exceeded for ai.messages.daily. Your limit is 3/day on the client.free plan. Upgrade your plan for higher limits."
}
```

#### Step 2: Test Virtual Try-On Lifetime Trial Consumption
1. On `client.free` plan, submit `POST /ai/try-on`.
   * **Result:** `202 Accepted` (Consumes 1 lifetime trial).
2. Submit a second `POST /ai/try-on` with different garments:
   * **Status:** `429 Too Many Requests`
   * **Response Body:**

```json
{
  "success": false,
  "message": "Virtual Try-On quota exceeded. Your try-on limit has been reached on the client.free plan. Upgrade your plan for additional try-ons."
}
```

---

## 15. Postman Test Scripts Library

Add these scripts to Postman request **Tests** tabs for complete automation:

### Auto-Extract Login Tokens & User ID
```javascript
if (pm.response.code === 200) {
    const body = pm.response.json();
    if (body.data && body.data.accessToken) {
        pm.environment.set("accessToken", body.data.accessToken);
        pm.environment.set("refreshToken", body.data.refreshToken);
        pm.environment.set("userId", body.data.user.id);
        console.log("Tokens and User ID updated.");
    }
}
```

### Auto-Extract Cloudinary Image Ref from Upload
```javascript
if (pm.response.code === 200) {
    const body = pm.response.json();
    if (body.data && body.data.publicId) {
        pm.environment.set("chatImageRef", body.data.publicId);
        console.log("chatImageRef set:", body.data.publicId);
    }
}
```

### Auto-Extract Shape Model ID
```javascript
if (pm.response.code === 201) {
    const body = pm.response.json();
    if (body.data && body.data.id) {
        pm.environment.set("shapeModelId", body.data.id);
        console.log("shapeModelId set:", body.data.id);
    }
}
```

### Auto-Extract Try-On Generation ID
```javascript
if (pm.response.code === 202 || pm.response.code === 200) {
    const body = pm.response.json();
    if (body.data && body.data.id) {
        pm.environment.set("tryOnGenerationId", body.data.id);
        console.log("tryOnGenerationId set:", body.data.id);
    }
}
```

---

## 16. Complete Recommended Test Order

Follow this exact sequence to ensure all dependencies and prerequisites exist:

```text
 1. Start Infrastructure
    ├── MongoDB (replica set or local standalone)
    └── Redis (port 6379)

 2. Seed / Ingest Data
    ├── npm run seed:plans
    └── node scripts/ingest-fashion-knowledge.js (Phase 15D)

 3. Start Application & Workers
    ├── Terminal 1: npm run dev
    └── Terminal 2: node src/jobs/workers/tryon-worker.runner.js (Phase 15F worker)

 4. Authenticate Users (Section 4)
    ├── Register & Login User A (Client) -> Save accessToken, userId
    ├── Register & Login User B (Attacker Client) -> Save accessTokenB, userIdB
    └── Register & Login Stylist -> Save stylistToken

 5. Seed User A Wardrobe (Prerequisites for 15A/15B)
    ├── POST /uploads/wardrobe (Upload top, bottom, shoes)
    └── POST /wardrobe (Register 3 items) -> Save wardrobeItemId

 6. Verify Phase 15A (Section 5)
    └── Confirm GET /api/v1/ai returns 404

 7. Test Phase 15B Stylist API (Section 6)
    ├── Formal request (English)
    ├── Egyptian wedding request (Arabic)
    ├── Out-of-domain prompt (Verify refusal + quota refund)
    └── Validation error tests (Empty message, length > 500)

 8. Test Phase 15C Image Input (Section 7)
    ├── POST /uploads/ai-chat (Upload garment image) -> Save chatImageRef
    ├── POST /ai/stylist with imageRef (Flow B) -> Save saveMessageId
    └── POST /wardrobe/from-chat -> Save new wardrobe item

 9. Verify Phase 15D Fashion Knowledge RAG (Section 8)
    └── Run Katameya Heights prompt; verify editorial rationale

10. Test Phase 15E External Product Search (Section 9)
    ├── Sufficient closet test -> suggestedToAcquire is empty
    ├── Wardrobe gap test -> suggestedToAcquire contains grounded recommendations
    └── Quota exhausted test -> fallback to ungrounded template

11. Test Phase 15F Shape Model (Section 10)
    ├── POST /uploads/shape-models -> Save shapeModelImageRef
    ├── POST /ai/shape-model (Consent true) -> Save shapeModelId
    ├── GET /ai/shape-model (Verify 1h signed URL)
    └── DELETE /ai/shape-model (Verify soft delete)

12. Test Phase 15F Virtual Try-On (Section 11)
    ├── Re-create active Shape Model
    ├── POST /ai/try-on (Wardrobe + Upload garments) -> Save tryOnGenerationId
    ├── Re-submit identical request -> Verify 24h deduplication (202 / 200)
    ├── GET /ai/try-on/:id (Poll until completed with signed URL)
    ├── GET /ai/try-on (List generations)
    └── DELETE /ai/try-on/:id

13. Execute Security & IDOR Suite (Section 13)
    ├── Test missing/invalid tokens (401)
    ├── Test Stylist calling Client AI routes (403)
    ├── Test User B accessing User A Shape Model (403)
    ├── Test User B using User A Wardrobe Item (404)
    ├── Test User B accessing User A Try-On result (403)
    └── Test User B deleting User A Try-On job (403)

14. Execute Quota Tests (Section 14)
    ├── Exhaust daily message quota -> Verify 429
    └── Exhaust try-on lifetime trial -> Verify 429

15. Test Feature Isolation Kill-Switch (Section 12)
    ├── Set AI_TRY_ON_ENABLED=false -> Restart server
    ├── Verify all 15F routes return 404
    └── Verify 15B stylist route continues to work 100%
```

---

## 17. Test Data Reference

### 17.1 Test Users

* **User A (Primary Client):**
  * `email`: `client.a@murafiq.dev`
  * `password`: `Password123!`
  * `role`: `client`
* **User B (Second Client / IDOR Attacker):**
  * `email`: `client.b@murafiq.dev`
  * `password`: `Password123!`
  * `role`: `client`
* **Stylist User (RBAC Verification):**
  * `email`: `stylist.pro@murafiq.dev`
  * `password`: `Password123!`
  * `role`: `stylist`

---

### 17.2 Wardrobe Fixtures for User A

To thoroughly test styling and Try-On, create these 3 items via `POST /uploads/wardrobe` and `POST /wardrobe`:

1. **Formal Shirt (Top):**
   * `category`: `top`
   * `subcategory`: `dress shirt`
   * `primaryColor`: `white`
   * `formality`: `formal`
   * `season`: `["spring", "summer", "fall", "winter"]`
2. **Tailored Trousers (Bottom):**
   * `category`: `bottom`
   * `subcategory`: `dress trousers`
   * `primaryColor`: `black`
   * `formality`: `formal`
   * `season`: `["spring", "summer", "fall", "winter"]`
3. **Formal Oxfords (Shoes):**
   * `category`: `shoes`
   * `subcategory`: `oxfords`
   * `primaryColor`: `black`
   * `formality`: `formal`

---

## 18. Environment Configuration Matrix

All configuration is parsed in `src/config/env.config.js`.

| Group | Variable Name | Required? | Default / Example Value | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Core** | `NODE_ENV` | Yes | `development` | Runtime mode (`development`, `production`, `test`). |
| **Core** | `PORT` | No | `4000` | HTTP port. |
| **Core** | `API_URL` | No | `http://localhost:4000` | Public backend URL. |
| **Database** | `MONGO_URI` | Yes | `mongodb://127.0.0.1:27017/murafiq` | MongoDB connection URI. |
| **Redis** | `REDIS_URL` | Yes | `redis://127.0.0.1:6379` | Redis for rate limiting, quotas & BullMQ. |
| **Auth** | `JWT_ACCESS_SECRET` | Yes | `dev_access_secret_change_me_in_prod` | Signing secret for access tokens (15m). |
| **Auth** | `JWT_REFRESH_SECRET` | Yes | `dev_refresh_secret_change_me_in_prod` | Signing secret for refresh tokens (30d). |
| **Cloudinary**| `CLOUDINARY_CLOUD_NAME`| Yes | `YOUR_CLOUD_NAME` | Cloudinary storage tenant. |
| **Cloudinary**| `CLOUDINARY_API_KEY` | Yes | `YOUR_API_KEY` | Cloudinary API key. |
| **Cloudinary**| `CLOUDINARY_API_SECRET` | Yes | `YOUR_API_SECRET` | Cloudinary API secret. |
| **Gemini AI** | `GEMINI_API_KEY` | Yes | `YOUR_GEMINI_API_KEY` | Google Gemini multimodal & reasoning API key. |
| **Gemini AI** | `AI_MODEL_VISION` | No | `gemini-3.1-flash-lite` | Multimodal vision model ID. |
| **Gemini AI** | `AI_MODEL_REASONING` | No | `gemini-3.1-flash-lite` | Stylist orchestration & search grounding model ID. |
| **Upstash** | `UPSTASH_KB_VECTOR_REST_URL` | Yes | `https://YOUR_KB.upstash.io` | Upstash Knowledge Base Vector Index URL. |
| **Upstash** | `UPSTASH_KB_VECTOR_REST_TOKEN`| Yes | `YOUR_KB_TOKEN` | Upstash Knowledge Base Vector Index Token. |
| **Try-On** | `AI_TRY_ON_ENABLED` | Yes | `true` | Subsystem kill-switch (`true` or `false`). |
| **Try-On** | `AI_IMAGE_PROVIDER` | No | `gemini` | Try-on generation engine (`gemini` or `mock`). |
| **Try-On** | `AI_MODEL_IMAGE` | No | `gemini-3.1-flash-lite-image` | Model ID for image composite synthesis. |
| **Try-On** | `AI_IMAGE_RESOLUTION` | No | `1024x1024` | Default resolution (`512x512` or `1024x1024`). |

---

## 19. Expected HTTP Status Codes & Error Catalog

| Status Code | Reason & Origin in Implementation |
| :--- | :--- |
| **`200 OK`** | Request succeeded. In `POST /ai/try-on`, indicates a 24-hour cache deduplication match. |
| **`201 Created`** | Resource successfully created (Shape Model created, or wardrobe item saved from chat). |
| **`202 Accepted`** | Asynchronous generation job accepted and queued in BullMQ (`POST /ai/try-on`). |
| **`400 Bad Request`** | Input validation failure (Zod strict validation error, message > 500 chars, conflicting garment slots, invalid upload namespace). |
| **`401 Unauthorized`** | Missing, malformed, or expired JWT access token. |
| **`403 Forbidden`** | RBAC check failed (e.g. Stylist accessing Client AI route) or IDOR ownership validation failed. |
| **`404 Not Found`** | Resource not found (non-existent generation or shape model) OR `AI_TRY_ON_ENABLED=false` kill-switch triggered. |
| **`409 Conflict`** | Resource conflict (e.g. duplicate active subscription plan). |
| **`429 Too Many Requests`** | Quota limit exceeded for `ai.messages.daily`, `ai.productSearch.daily`, or `ai.tryOn.monthly`. |
| **`502 Bad Gateway`** | Third-party upstream failure (Cloudinary network error or Gemini API outage). |
| **`503 Service Unavailable`** | Infrastructure failure (MongoDB or Redis disconnected during health check). |

---

## 20. Final Verification Checklist

Use this checklist before signing off on any Phase 15 release or PR:

```text
[ ] Postman Environment 'Murafiq - Local Dev' created on port 4000
[ ] Mobile header 'X-Client-Type: mobile' included on login requests
[ ] User A and User B registered, verified, and authenticated
[ ] Phase 15A verified: No standalone /api/v1/ai route exists
[ ] Phase 15A verified: StylePreference and Outfit indexes active in MongoDB
[ ] Phase 15B verified: English formal wedding returns 200 OK with ranked outfits
[ ] Phase 15B verified: Arabic prompt returns 200 OK with fluent Arabic rationale
[ ] Phase 15B verified: Out-of-domain prompt returns safe refusal and refunds daily quota
[ ] Phase 15B verified: Empty message and message > 500 characters return 400 Bad Request
[ ] Phase 15C verified: POST /uploads/ai-chat uploads and compresses to 768px
[ ] Phase 15C verified: Multimodal stylist styles around uploaded anchor piece
[ ] Phase 15C verified: POST /wardrobe/from-chat converts chat image into wardrobe item
[ ] Phase 15D verified: scripts/ingest-fashion-knowledge.js ingests 5 editorial docs
[ ] Phase 15D verified: Stylist rationale incorporates Egyptian cultural dress codes
[ ] Phase 15E verified: Sufficient closet returns suggestedToAcquire = []
[ ] Phase 15E verified: Closet gap consumes product-search quota and returns grounded citations
[ ] Phase 15E verified: Quota exhaustion degrades gracefully to ungrounded template list
[ ] Phase 15F verified: Shape Model photo uploads to private Cloudinary folder
[ ] Phase 15F verified: POST /ai/shape-model creates active model with consent
[ ] Phase 15F verified: GET /ai/shape-model returns active model with 1-hour signed URL
[ ] Phase 15F verified: DELETE /ai/shape-model soft-deletes model and purges asset
[ ] Phase 15F verified: POST /ai/try-on accepts request with 202 Accepted
[ ] Phase 15F verified: 24-hour deduplication returns cached result with 200 OK
[ ] Phase 15F verified: Polling GET /ai/try-on/:id returns completed image with signed URL
[ ] Phase 15F verified: Terminal failure refunds try-on quota automatically
[ ] Feature Isolation verified: AI_TRY_ON_ENABLED=false causes all 15F routes to return 404
[ ] Feature Isolation verified: AI_TRY_ON_ENABLED=false does not break 15A–15E stylist
[ ] IDOR verified: User B cannot access User A's Shape Model, Garments, or Try-On results
[ ] RBAC verified: Stylist role receives 403 Forbidden across all /ai endpoints
[ ] Swagger/OpenAPI documentation matches all 8 direct AI routes
```
