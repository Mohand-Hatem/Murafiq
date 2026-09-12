# Phase 15A — Data Model & Retrieval Primitives

> Read `PHASE_15_AI_SKELETON.md` first for the locked architectural decisions.
> **Status:** ⛔ Not started. **Blocked by** `HARDENING_08_WARDROBE_AI_READINESS.md`.

## Goal

Build everything the stylist pipeline reads from, with **no AI calls at all**. At the end of
this phase there is still no `/api/v1/ai` route — but every retrieval primitive the pipeline
needs exists, is indexed, and is unit-tested against fixture wardrobes.

Keeping this phase AI-free is deliberate: retrieval bugs are much easier to find without a
model in the loop, and these functions are where a cross-user privacy leak would live.

## Depends on

`HARDENING_08` (garment attributes and enums must exist first), Phase 14, Phase 2.

---

## Steps

### Step 1 — Dress-code constants

**File:** `src/common/constants/dress-code.constant.js`

A map of roughly 20 event types to hard retrieval filters. **This is code, not RAG** — it is
a lookup table, it must be versioned and unit-testable, and embedding it would be a category
error. The nuanced prose lives in the knowledge base (`PHASE_15D`); the hard filters live here.

```
wedding_formal  -> { formality: ['formal','business'],
                     requiredSlots: ['top','bottom','shoes'],
                     optionalSlots: ['outerwear','accessory'],
                     highStakes: true }
dinner_casual   -> { ... }
```

Include: weddings (formal/casual), engagement, birthday party, dinner (casual / nice
restaurant), business meeting, interview, work (office / smart casual), university, travel,
gym/sport, beach, funeral, eid/religious occasion, date, family gathering.

Also export `deriveSeason(date)` using `getBusinessDayRange()` / `BUSINESS_TIMEZONE`
(`Africa/Cairo`) from `src/common/utils/businessDay.util.js`. **No weather API.**

This map doubles as the pipeline's **second, deterministic scope gate** — an `eventType`
that does not resolve here stops the request regardless of what the model returned.

### Step 2 — `StylePreference` model

**Files:** `src/modules/ai/preferences/*` (model, repository, service)

One document per user: `favoriteColors[]`, `avoidedColors[]`, `preferredFormality`,
`sizes{}`, `dislikedStyleTags[]`, `modestyPreference` (relevant to the Egyptian market),
`notes`. Created lazily on first read; absence is not an error.

**Not RAG.** It is small, structured, and always relevant — retrieval over a document you
always need is pure overhead.

### Step 3 — `Outfit` model

**Files:** `src/modules/ai/outfits/*`

```
{ userId, conversationId, items: [ObjectId ref WardrobeItem],
  anchorItemId?, externalSuggestions: [{ type, description, sourceUrl, sourceTitle }],
  eventContext: { eventType, formality, season, timeOfDay, setting },
  rationale, score, source: 'wardrobe' | 'external',
  userFeedback: 'liked' | 'disliked' | null,
  promptVersion, createdAt }
```

Index `{ userId: 1, createdAt: -1 }`.

**Do not add `visualizationUrl`.** This instruction **stands unchanged** after
`PHASE_15F_VIRTUAL_TRY_ON.md` was added on 2026-09-10, and the reason is now stronger rather
than weaker: 15F's generated images live in their own `TryOnGeneration` collection, because a
try-on may reference garments the client uploaded and may have **no `Outfit` at all**. A
generation is not a property of an outfit. Do not add the field "now that generation exists."

This model is also the evaluation dataset — every recommendation the system makes is
recoverable, which is what makes prompt regressions measurable.

### Step 4 — `AiConversation` and `AiMessage` models

**Files:** `src/modules/ai/conversation/*`

`AiConversation`: `{ userId, title, lastMessageAt, createdAt }`
`AiMessage`: `{ conversationId, role: 'user'|'assistant', content, structuredResult?, traceId, createdAt }`

**MongoDB, not Firestore.** The existing `chat/` module is Firestore-backed human↔human
messaging with security rules built around booking participants. The AI conversation needs
server-side reads for context assembly and has an entirely different access pattern. Do not
conflate them — `next-phase/PHASE_15_PRODUCT_BRIEF.md:66-67` gives the same warning.

`PHASE_15C` extends `AiMessage` with image fields. V1 is single-turn, so these models are
written now but only lightly used until multi-turn ships.

### Step 5 — Slot-based wardrobe retrieval

**File:** `src/modules/wardrobe/wardrobe.service.js` (extend)

```
getWardrobeCandidates(userId, { slots, formality, season, genderPresentation, limitPerSlot })
  -> { top: [...], bottom: [...], shoes: [...], outerwear: [...], accessory: [...] }
```

One indexed Mongo query per requested slot, using `{ userId, category, formality }` from
`HARDENING_08`. Excludes `isArchived` and `classificationStatus !== 'done'`.

**Cap `limitPerSlot` at ~6–8.** Beyond that the composition prompt grows without improving
the answer, and it makes the weaker/cheaper model's job harder.

Return a compact projection — the composition prompt does not need `imageUrl`,
`embeddingId`, or timestamps. Hydration from full documents happens after validation.

> **This is the primary retrieval path for the whole product.** It is a Mongo query, not a
> vector search, and that is deliberate — see `PHASE_15_AI_SKELETON.md`.

### Step 6 — Semantic wardrobe search

**File:** `src/modules/wardrobe/wardrobe.service.js` (extend)

```
searchWardrobeSemantic(userId, queryEn, { filters, topK }) -> items[]
```

The **first real caller** of `vectorNs.query()` (`vector.config.js:74-81`), which has had
zero callers since Phase 14. Queries the per-user Upstash namespace, then hydrates from Mongo.

Two uses: free-text closet search ("that blue linen thing"), and garment matching in
`PHASE_15C`. **Secondary path** — not used for outfit composition.

Also use it to replace the `$regex` collection scan at `wardrobe.repository.js:34`, which
has no text index behind it.

### Step 7 — Compound index

`{ userId: 1, category: 1, formality: 1 }` on `WardrobeItem` if `HARDENING_08` did not
already add it. Verify with `getIndexes()`, not by reading the schema.

---

## Definition of Done

- [ ] `dress-code.constant.js` covers ≥ 20 event types; `deriveSeason()` returns correct seasons for dates across all four seasons in `Africa/Cairo`.
- [ ] An unknown `eventType` returns a clear "unresolved" result the caller can branch on — it must not silently default to `casual`.
- [ ] `StylePreference`, `Outfit`, `AiConversation`, `AiMessage` models exist with indexes verified via `getIndexes()`.
- [ ] `Outfit` has **no** `visualizationUrl` field.
- [ ] `getWardrobeCandidates` returns correctly filtered items per slot against a fixture wardrobe, respects `limitPerSlot`, and excludes archived and non-`done` items.
- [ ] `searchWardrobeSemantic` returns hydrated items and is the first caller of `vectorNs.query()`.
- [ ] **Multi-tenant isolation test, both paths:** client A's retrieval never returns client B's items. This is a required test — `AGENTS.md:228-230` calls a cross-user leak "a silent, hard-to-notice privacy bug."
- [ ] `wardrobe.repository.js` no longer uses an unindexed `$regex` scan for search.
- [ ] **No `/api/v1/ai` route exists yet.** No model call is made anywhere in this phase.
- [ ] Full Jest suite green.
