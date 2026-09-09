# Phase 15D — Fashion Knowledge RAG

> Read `PHASE_15_AI_SKELETON.md` first for the locked architectural decisions.
> **Status:** ⛔ Not started. **Blocked by** `PHASE_15C`.

## Goal

Ground the stylist's reasoning in a curated fashion knowledge base so that "black tie means
X" and "this is what people actually wear to an Egyptian summer wedding" come from a
maintained corpus rather than from whatever the model happens to believe.

**This is the only genuine RAG in the system.** Everything else that looks like RAG is not:
the wardrobe is a Mongo query, the event taxonomy is code constants, preferences are one
document, products are a live grounded search.

## Depends on

`PHASE_15C`. (It can technically follow `PHASE_15B`, but shipping it after image input means
one measurement baseline instead of two.)

---

## Steps

### Step 1 — Curate the corpus

**Directory:** `content/fashion-knowledge/` (Markdown source, version-controlled)

Scope, strictly:

- **Dress codes** — black tie, formal, business, business casual, smart casual, casual, and
  what each actually means in practice for men and women.
- **Colour rules** — pairing, contrast, neutrals, what clashes and why.
- **Silhouette and fit** — proportion, layering, what balances what.
- **Fabric and season** — weight, breathability, what fails in Cairo in August.
- **Regional and cultural norms** — Egyptian wedding, engagement, eid, funeral, family
  gathering conventions. Modesty considerations, stated as guidance rather than as rules
  imposed on the user.
- **Occasion guidance** — the prose behind each event type in `dress-code.constant.js`.

Target a few hundred chunks. Small, dense and correct beats large and vague.

> **The KB is part of the scope boundary, not just a quality input.** It is tempting to
> broaden it — general etiquette, venue guides, travel advice — but every non-fashion chunk
> is a way for an out-of-scope answer to acquire grounding and *sound authoritative*. Curate
> it as strictly as the guard itself. Nothing but fashion.

Write it in **English** — it is the canonical retrieval language (`PHASE_15B` Step 3). Arabic
responses are rendered at step 8 from English-grounded reasoning.

### Step 2 — `FashionKnowledgeDoc` model

**Files:** `src/modules/ai/knowledge/*`

`{ slug, title, topic, locale, body, chunkIndex, promptVersion, createdAt }`

Mongo is the **source of truth**; the vectors are derived. This makes re-ingestion
reproducible and lets you diff the corpus in review rather than inspecting a vector store.

### Step 3 — Second Upstash index

**Config:** a new index, distinct from the wardrobe index.

**Two indexes, not one**, for three reasons: the embedding model is fixed at index creation
time and the corpora have different needs; the corpora are unrelated; and mixing per-user
closet vectors with shared knowledge in one index puts a cross-tenant leak one filter bug
away. Both fit comfortably in the free tier at this scale.

Namespace by `topic` (or `locale`) so retrieval can be scoped.

Add `UPSTASH_KB_VECTOR_REST_URL` / `_TOKEN` to `env.config.js` using the existing `secret()`
helper, and to the `HARDENING_08` Step 7 placeholder assertion.

> **Verify and write down which embedding model each index uses.** Upstash's default BGE
> models are English-only; `bge-m3` is multilingual. The canonical-English design makes this
> a non-blocker either way — which is exactly why it is the design — but it should be an
> explicit, recorded fact rather than an assumption.

### Step 4 — Ingestion script

**File:** `scripts/ingest-fashion-knowledge.js`

Idempotent and re-runnable, per the project's no-migrations convention: read
`content/fashion-knowledge/`, chunk, upsert to Mongo, upsert to the KB index keyed by slug +
chunk index. Re-running after an edit updates in place; it never duplicates.

### Step 5 — Retrieval service

**File:** `src/modules/ai/knowledge/knowledge.service.js`

```
searchFashionKnowledge(queryEn, { topic, topK = 3 }) -> chunks[]
```

**Redis cache keyed by `eventType + season`, TTL 24 h.** The KB is static — retrieving the
same wedding guidance for every wedding query is pure waste. This is the single largest
saving available in the retrieval path.

### Step 6 — Wire into composition

Pass the retrieved chunks into `composeAndRankOutfits` (`PHASE_15B` Step 5) and into the
gap-analysis side of the insufficiency branch, where they inform *which item types* are
missing for a given dress code.

Also enable Gemini **context caching** on the static system prompt plus retrieved chunks —
they repeat across requests.

---

## Definition of Done

- [ ] Corpus covers all six areas in Step 1; every chunk is fashion-scoped. A reviewer can confirm no general-knowledge content crept in.
- [ ] `FashionKnowledgeDoc` exists in Mongo as the source of truth.
- [ ] A **second** Upstash index exists, separate from the wardrobe index; the embedding model of each is recorded in this file or `01_PROJECT_STRUCTURE.md`.
- [ ] Ingestion script runs twice with no duplication and no change on the second run.
- [ ] `searchFashionKnowledge` returns relevant chunks for each of the ~20 event types.
- [ ] Redis cache hit is observable in the trace log on a repeated `eventType + season`.
- [ ] **Golden-set scores improve measurably against the `PHASE_15C` baseline.** If they do not, the corpus is wrong — fix it before shipping. Shipping a KB that does not improve results just adds cost and latency.
- [ ] No regression in refusal behaviour: an out-of-domain question still refuses, and the KB is never consulted for one.
- [ ] Full Jest suite green.
