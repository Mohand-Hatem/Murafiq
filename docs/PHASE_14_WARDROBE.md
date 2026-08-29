# Phase 14 — Wardrobe (Closet) + AI Photo Classification/Indexing

## Goal
Let a client build a digital closet by uploading photos of clothes they own. Each photo gets automatically classified (category/color/style) and embedded into a per-user vector index at upload time — this phase does the classification + indexing for real; Phase 15's `getOutfitSuggestions` tool is what *queries* that index later.

> 🔔 **Recommended Skill for this Phase:**
> Install **`rag-engineer`** (from `Jeffallan/claude-skills`) or **`langchain-architect`** before starting this phase to ensure high-precision vision LLM classification prompting, vector embedding generation, and metadata filtering.

## Depends on
Phase 2 (Users — client role, auth), Phase 9 (Uploads — Cloudinary).

> **Redis/BullMQ ownership moved here (2026-08-24).** `PHASE_12_BACKGROUND_JOBS.md` was re-scoped
> to node-cron-only scheduled sweeps (OTP cleanup, session reminders) — it never installs a queue.
> This phase now installs and owns Redis + BullMQ itself (Step 0 below), because the photo
> classification worker is the first genuinely queue-shaped work in the project: a slow, per-item,
> externally-dependent call that must not block the upload request and needs real retry/backoff —
> not a recurring sweep a cron schedule can express. Do not wait on Phase 12 for this; it doesn't
> provide it.

> **Deviation from the "AI stays a skeleton until Phase 15" rule:** every phase before this one avoids AI dependencies entirely, and that rule was correct until this feature existed. Wardrobe is useless without live classification — a client uploading a photo and getting nothing back until some future "AI activation" would defeat the point. So this phase is where the vision/embedding SDK and vector DB client are actually installed and called for real, ahead of the rest of the AI module.

---

## Steps

### 0. Install and configure Redis + BullMQ

This is the first phase in the project that needs either. `REDIS_URL` was deliberately removed from
`src/config/env.config.js` during the v1 scope pass (it was `secret()` — required in production —
for a variable nothing read; see `03_SKELETON_STATUS.md` §7). Reverse that here:

1. `npm install bullmq ioredis`.
2. Re-add `REDIS_URL` to `env.config.js` as `secret('redis://127.0.0.1:6379')`, and to `.env.example`.
3. Recreate `src/config/redis.config.js` exporting a real `ioredis` connection
   (`new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null })` — the `maxRetriesPerRequest: null`
   is a BullMQ requirement, not optional).
4. Add a Redis check to `GET /api/v1/health` alongside the existing Mongo check — deliberately absent
   in v1 (`PHASE_16_DEPLOYMENT_READINESS.md` §4 explains why: no Redis existed to check).
5. **PM2 instance count is unaffected by this alone.** `ecosystem.config.cjs` stays
   `instances: 1` because `src/jobs/offer-expiry.cron.js` and Phase 12's two cron jobs still have no
   distributed lock. Multi-instance only becomes safe once every cron job is migrated onto this
   BullMQ setup or given a real lock — don't flip `instances` up as part of this phase.
6. Optional, not required for wardrobe to work: migrate `mailService.sendMail()` and
   `notificationService.send()` callers onto a `mail`/`notification` BullMQ queue now that the
   infrastructure exists, closing the two queues Phase 12 deferred here. Do this as a separate,
   reviewable step from the wardrobe classification queue — different failure modes, different
   urgency.

### 1. `wardrobe-item.model.js`
```js
const wardrobeItemSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  imageUrl: { type: String, required: true },
  category: { type: String, enum: ['top', 'bottom', 'shoes', 'outerwear', 'accessory', 'dress'] }, // AI-filled, client can override
  color: String,           // AI-filled, client can override
  styleTags: [String],     // AI-filled, e.g. ['casual', 'summer', 'streetwear']
  aiDescription: String,   // short AI-generated description, e.g. "white leather low-top sneakers with navy accents" — used both as embedding input and as LLM context in Phase 15
  embeddingId: String,     // pointer into the vector DB (Pinecone/Qdrant) — the raw vector itself never lives in Mongo
  classificationStatus: { type: String, enum: ['pending', 'done', 'failed'], default: 'pending' },
}, { timestamps: true });
```
> Storing an `embeddingId` pointer rather than the raw vector keeps the Mongo document small and keeps the vector DB as the single source of truth for similarity search — reusing the same Pinecone/Qdrant instance `01_PROJECT_STRUCTURE.md` already lists for the AI module, just for a second purpose (a personal per-user index, filtered by `userId` metadata on every vector so one client's items can never surface in another client's query).

### 2. Upload endpoint — classification happens async, not inline
- `POST /wardrobe` — client only. Body: `{ imageUrl }` (image uploaded first via the existing generic `/uploads/wardrobe` folder from Phase 9 — same pattern every other module already follows). Creates the item with `classificationStatus: 'pending'`, enqueues a `wardrobe-classification` job on **this phase's own BullMQ setup** (Step 0 above, mirroring `jobs/queues/*.queue.js` + `jobs/workers/*.worker.js` — those directories exist as `.gitkeep` placeholders today), and returns immediately with the pending item.
- The worker (`wardrobe-classification.worker.js`):
  1. Calls a vision model on `imageUrl` to produce `category`, `color`, `styleTags`, and `aiDescription`.
  2. Embeds `aiDescription` (or the image itself, depending on the embedding model chosen) and upserts it into the vector DB with metadata `{ userId, itemId }`.
  3. Writes `embeddingId` + the classified fields back onto the `WardrobeItem` document and sets `classificationStatus: 'done'` (or `'failed'` with a logged reason — the item still exists and is visible to the client either way, just without AI-filled fields).
> **Why queue this instead of doing it inline in the request?** Vision + embedding calls are slow external API calls. Blocking the upload response on them would make `POST /wardrobe` feel broken on a slow network or provider hiccup. `attempts`/`backoff` on this queue (per BullMQ's `defaultJobOptions`) is what turns a flaky vision-API call into `classificationStatus: 'failed'` instead of a lost item — the retry behavior a cron sweep can't give you.

### 3. Remaining endpoints
- `GET /wardrobe/mine` — client's own items, via `QueryBuilder` (filter by `category`/`styleTags`, pagination). Add `.search(['aiDescription'])` so free-text search works too.
- `GET /wardrobe/:id` — single item detail, owner only.
- `PATCH /wardrobe/:id` — client can manually correct `category`/`color`/`styleTags` if the AI got it wrong. This is not optional polish — vision classification will be wrong sometimes, and there must be an escape hatch that doesn't involve deleting and re-uploading the photo.
- `DELETE /wardrobe/:id` — hard delete (not soft-delete like `User`): a wardrobe item has no other collection referencing it, so there's no referential-integrity reason to keep a tombstone, and keeping deleted-but-hidden image records around indefinitely has no benefit here. **Must also delete the corresponding vector from the vector DB** using `embeddingId` — an easy step to forget, called out explicitly because an orphaned vector is a silent, unbounded leak with no error to notice it by.

### 4. Role restriction
`POST /wardrobe` and all other wardrobe routes are client-only (`restrictTo('client')`) — this is explicitly a client-facing closet feature per the original request, not a stylist tool.

### 5. Env additions
`OPENAI_API_KEY`, `VECTOR_DB_URL`, and `VECTOR_DB_API_KEY` already exist in `env.config.js`'s schema (added ahead of time during the spec's production-readiness pass, same dev-default-then-required-in-prod pattern as every other credential — see `secret()` in `env.config.js`). This phase is where they stop being forward-references and actually get used for the first time — confirm real values are set before deploying past this phase, dev defaults are fine until then.

---

## Definition of Done

- [ ] Redis connection confirmed healthy at boot; `GET /api/v1/health` reports it.
- [ ] Uploading a photo creates a `pending` item immediately and the response doesn't wait on classification.
- [ ] The worker correctly fills `category`/`color`/`styleTags`/`aiDescription`/`embeddingId` and flips status to `done` on a real test image; a deliberately-broken provider call flips it to `failed` without crashing the worker or losing the item.
- [ ] A forced worker failure (e.g. bad vision-API credentials) retries per the configured backoff and lands in the failed-jobs list rather than silently dropping — verify against BullMQ's own job state, not just `classificationStatus`.
- [ ] `PATCH /wardrobe/:id` lets the client override any AI-filled field.
- [ ] `DELETE /wardrobe/:id` removes both the Mongo document and the vector DB entry — verified by querying the vector DB directly after deletion, not just checking Mongo.
- [ ] A client only ever sees their own items; a vector-similarity query for client A never returns client B's items (verify the `userId` metadata filter is actually applied, not just present in the schema).
- [ ] Non-client (stylist/admin) calling any `/wardrobe/*` route gets `403`.
- [ ] Unit + integration tests for upload → queue → worker classification → retrieval, including the failure path.
- [ ] Every new route in this phase has an @swagger JSDoc block covering summary, request body, and response codes; /api/docs renders it without errors.
