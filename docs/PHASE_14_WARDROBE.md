# Phase 14 — Wardrobe (Closet) + AI Photo Classification & Indexing

## Goal
Let a client build a digital closet by uploading photos of clothes they own. Each photo gets automatically classified (category, colors, pattern, formality, season, material, style tags) and embedded into an **Upstash Vector** per-user namespace index at upload time.
- **Phase 14** owns: Closet CRUD + BullMQ async queue + Gemini Flash Vision photo classification + Upstash Vector indexing & cleanup.
- **Phase 15** owns: Conversational AI stylist + the `getOutfitSuggestions` tool that *queries* this Upstash Vector index with occasion reasoning.

---

## Depends on
Phase 2 (Users — client role, auth), Phase 9 (Uploads — Cloudinary).

> **Redis & BullMQ ownership:** `PHASE_12_BACKGROUND_JOBS.md` was scoped to node-cron sweeps (OTP cleanup, session reminders, auto-pause). This phase installs and owns Redis + BullMQ (Step 0 below) because photo classification is the first true queue-shaped workload in the system: slow, external API dependencies that must not block HTTP uploads and require automatic retries and backoff.

> **Multimodal AI & Vector DB Integration:** Phase 14 is where Gemini Flash (for vision classification) and Upstash Vector (for per-user vector namespaces) are integrated for real. Phase 15 builds conversational orchestration on top of what Phase 14 indexes.

---

## Technology Stack Decisions

| Component | Choice | Rationale |
|---|---|---|
| **AI Vision Model** | **Google Gemini Flash** (`@google/genai` or `@google/generative-ai`) | Single SDK/key for multimodal image classification & structured JSON extraction. Fast, cost-efficient tokenization. |
| **Vector DB** | **Upstash Vector** (`@upstash/vector`) | Serverless, pay-per-use REST SDK, native `namespace: userId` per-user isolation, built-in embedding generation. |
| **Queue & Worker** | **BullMQ** + **ioredis** | Decouples heavy AI API latency from `POST /wardrobe` HTTP response; provides automatic exponential backoff retry. |
| **Redis** | Native VPS / Redis instance | `maxRetriesPerRequest: null`, persistent TCP connection required for BullMQ blocking commands. |

---

## Data Schema (`src/modules/wardrobe/wardrobe-item.model.js`)

```javascript
const wardrobeItemSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  imageUrl: { type: String, required: true },
  
  // Structured AI Classification (client can manually override via PATCH)
  category: { 
    type: String, 
    enum: ['top', 'bottom', 'shoes', 'outerwear', 'accessory', 'dress'],
    required: false 
  },
  primaryColor: { type: String },
  secondaryColors: [{ type: String }],
  pattern: { type: String },     // e.g. 'solid', 'striped', 'plaid', 'floral', 'graphic', 'checkered'
  formality: { type: String },   // e.g. 'casual', 'smart_casual', 'business', 'formal', 'loungewear', 'sportswear'
  season: [{ type: String }],    // e.g. ['spring', 'summer', 'fall', 'winter', 'all_season']
  material: { type: String },    // e.g. 'cotton', 'denim', 'leather', 'wool', 'silk', 'linen', 'synthetic'
  styleTags: [{ type: String }], // e.g. ['minimalist', 'vintage', 'streetwear', 'boho']

  // Summary & Search Context
  aiDescription: { type: String }, // Short description (e.g., "White leather low-top sneakers with navy heel accents")
  
  // Vector DB Indexing Pointer
  embeddingId: { type: String },   // Upstash Vector ID pointer (raw vector stays in Upstash Vector DB)

  // Async Classification Lifecycle
  classificationStatus: { 
    type: String, 
    enum: ['pending', 'done', 'failed'], 
    default: 'pending',
    index: true 
  },
  classificationError: { type: String }
}, { timestamps: true });

wardrobeItemSchema.index({ userId: 1, category: 1 });
wardrobeItemSchema.index({ userId: 1, createdAt: -1 });
```

---

## Steps

### Step 0: Install & Configure Redis + BullMQ
1. `npm install bullmq ioredis @google/genai @upstash/vector`
2. Update `src/config/env.config.js` and `.env.example`:
   - `REDIS_URL` (`secret('redis://127.0.0.1:6379')`)
   - `GEMINI_API_KEY` (`secret()`)
   - `UPSTASH_VECTOR_REST_URL` (`secret()`)
   - `UPSTASH_VECTOR_REST_TOKEN` (`secret()`)
3. Create `src/config/redis.config.js` exporting a singleton `ioredis` connection with `{ maxRetriesPerRequest: null }`.
4. Create `src/config/vector.config.js` exporting Upstash Vector client.
5. Create `src/config/gemini.config.js` exporting Gemini client.
6. Add live Redis ping to `GET /api/v1/health`.

### Step 1: Model, Repository & Validation
- `src/modules/wardrobe/wardrobe-item.model.js` — Mongoose schema with granular fields + compound indexes.
- `src/modules/wardrobe/wardrobe.repository.js` — Data access methods (findMine, findByIdAndUser, updateClassification, deleteItem).
- `src/modules/wardrobe/wardrobe.validator.js` — Strict Zod schemas for `POST /wardrobe`, `PATCH /wardrobe/:id`, and query filters.
- `src/modules/wardrobe/wardrobe.dto.js` — Clean serialization avoiding internal database leakage.

### Step 2: BullMQ Queue & Async Classification Worker
- `src/jobs/queues/wardrobe.queue.js`:
  - BullMQ Queue named `'wardrobe-classification'` with default retry options (`attempts: 3`, `backoff: { type: 'exponential', delay: 3000 }`).
- `src/jobs/workers/wardrobe-classification.worker.js`:
  1. Receives `{ itemId, userId, imageUrl }`.
  2. Fetches/streams image & calls Gemini Flash Vision with strict JSON structured output schema:
     ```json
     {
       "category": "top|bottom|shoes|outerwear|accessory|dress",
       "primaryColor": "string",
       "secondaryColors": ["string"],
       "pattern": "string",
       "formality": "string",
       "season": ["string"],
       "material": "string",
       "styleTags": ["string"],
       "aiDescription": "string"
     }
     ```
  3. Upserts embedding into Upstash Vector namespaced to `userId`:
     - `vectorClient.namespace(userId.toString()).upsert({ id: itemId.toString(), data: aiDescription, metadata: { category, formality, season, material } })`.
  4. Updates Mongo document with classified fields, `embeddingId = itemId`, and `classificationStatus = 'done'`.
  5. On caught fatal error: updates Mongo document to `classificationStatus = 'failed'` with `classificationError`.

### Step 3: Wardrobe Controller, Service & Endpoints
- **`POST /wardrobe`**:
  - Requires `role: 'client'`.
  - Body: `{ imageUrl }` (already uploaded via Cloudinary `/uploads/wardrobe`).
  - Creates pending item doc in Mongo, pushes job to BullMQ queue, returns HTTP 201 with `classificationStatus: 'pending'` immediately.
- **`GET /wardrobe/mine`**:
  - Lists client's own items with pagination, filtering by `category`, `formality`, `season`, and text search over `aiDescription`.
- **`GET /wardrobe/:id`**:
  - Fetches single item. Enforces strict ownership check (`userId === req.user.id`).
- **`PATCH /wardrobe/:id`**:
  - Allows client manual overrides for `category`, `primaryColor`, `secondaryColors`, `pattern`, `formality`, `season`, `material`, `styleTags`.
  - If visual attributes changed, re-indexes vector description in Upstash Vector.
- **`DELETE /wardrobe/:id`**:
  - Hard-deletes document from Mongo.
  - **Deletes vector from Upstash Vector namespace** (`vectorClient.namespace(userId).delete(itemId)`).

### Step 4: Swagger Documentation & API Registration
- `src/modules/wardrobe/wardrobe.swagger.js` — Comprehensive OpenAPI annotations for all 5 endpoints.
- Mount wardrobe routes in `src/routes/index.js` at `/wardrobe`.

---

## Definition of Done

- [ ] Redis connection verified healthy; `GET /api/v1/health` reports `redis: 'connected'`.
- [ ] `POST /wardrobe` saves item as `pending` and returns immediately (< 150ms response time).
- [ ] BullMQ worker processes image with Gemini Flash Vision and updates Mongo doc to `done` with full granular fields and `aiDescription`.
- [ ] Upstash Vector receives indexed vector under the client's isolated namespace (`namespace: userId`).
- [ ] `PATCH /wardrobe/:id` allows client to correct any AI misclassification.
- [ ] `DELETE /wardrobe/:id` removes both the Mongo document and the Upstash Vector record.
- [ ] Strict multi-tenant isolation verified: Client A cannot view, edit, delete, or query Client B's items.
- [ ] Non-clients (stylists/admins) receive `403 Forbidden` on wardrobe routes.
- [ ] Comprehensive unit and integration test suites covering happy path, failure retry, manual override, and vector deletion.
- [ ] Swagger documentation rendered cleanly at `/api/docs`.
