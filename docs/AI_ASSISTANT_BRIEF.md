# Murafiq — AI Outfit Assistant (Product Brief)

> **STATUS: PLANNED — NOT STARTED.** No code exists. `src/modules/ai/` contains only a `.gitkeep`.
> No `langchain`, `openai`, or vector-DB package is installed.
>
> **This is the product brief — the "what" and "why".** The technical specs are
> `PHASE_14_WARDROBE.md` (closet + classification + per-user vector index) and
> `PHASE_15_AI_SKELETON.md` (assistant/agent layer). Do not duplicate implementation detail here;
> amend those phase docs instead.

## Automation layer decision

**n8n is ruled out.** This will be built in-house in the Node backend (LangChain or a direct
provider SDK — see Open Decisions). Rationale: the assistant needs the existing auth, ownership
checks, and service layer on every call. Routing that through an external workflow engine would put
a second, unauthenticated execution context in front of user data.

**Codebase scan result:** zero n8n references. The one `grep` match is a false positive — a base64
`integrity` hash in `package-lock.json`. Nothing to remove, nothing to salvage.

## Business logic / user story

A **client** builds a personal wardrobe by uploading photos of clothes they own. They then chat with
an assistant that answers situational styling questions:

- "What should I wear today?"
- "Give me an outfit for lunch with my girlfriend."
- "I need something for a dinner."

**Core requirement — this is what makes the feature worth building:** answers must be grounded in
**this client's actual wardrobe**, retrieved via RAG. Generic fashion advice is a failure mode, not
an acceptable fallback. If the closet can't answer, the assistant should say so and suggest what's
missing — which is also a natural hook into the marketplace (book a stylist, get a shopping list).

**Occasion interpretation** is the second half of the problem. The assistant must map free-text
situation ("lunch with girlfriend" vs "work" vs "dinner") onto retrievable attributes — formality,
time of day, season, setting — and select items that fit. This mapping is the main open design
question below.

## Open decisions

1. **Vector store** — Pinecone vs Qdrant. `env.config.js` already reserves `VECTOR_DB_URL` /
   `VECTOR_DB_API_KEY`; the spec never picked one. (Currently `.optional()` — restore to required
   in Phase 14, when the wardrobe classification worker actually calls them.)
2. **Embedding strategy** — multimodal image embeddings (CLIP-style) vs embedding the
   vision-generated `aiDescription` text. Phase 14 currently assumes the latter and flags it as open.
   Text embeddings are cheaper and easier to debug; multimodal handles style nuance text loses.
3. **Occasion → retrieval mapping** — three candidates: (a) LLM extracts structured filters
   (formality/season/time) and queries by metadata, (b) pure semantic similarity on the query text,
   (c) hybrid: metadata pre-filter then semantic rank. Hybrid is likely right; needs validation
   against real closet data.
4. **Orchestration** — LangChain/LangGraph vs direct SDK calls. Phase 15 warns against installing
   LangChain prematurely; a single retrieval + one completion may not need a graph at all.
5. **LLM provider, streaming, conversation persistence** — `ai_conversations` / `ai_messages` do
   not exist. Streaming affects the transport choice (SSE vs plain REST).
6. **Cost & abuse controls** — per-user rate limits and token budgets. The existing
   `rate-limiter.middleware.js` covers requests, not tokens.

## Dependencies (hard ordering)

1. **Uploads** — ✅ built (`src/modules/uploads/`, Cloudinary + Multer).
2. **Wardrobe module** — ⛔ not built. Phase 14. Nothing to retrieve without it.
3. **Background jobs** — classification must not block the upload response. V1 uses in-process
   `node-cron` (see `src/jobs/offer-expiry.cron.js` for the pattern); Phase 12 introduces BullMQ,
   which is what Phase 14 assumes for the classification worker.
4. **Chat infra decision** — provider, streaming, persistence. Note the existing `chat/` module is
   **Firestore-backed human↔human messaging** and is unrelated; do not conflate them.

## Known spec conflicts to resolve first

- `PHASE_15_AI_SKELETON.md` claims OpenAI and vector-DB packages are "already installed as of
  Phase 14." They are not — Phase 14 was never built. See
  `HARDENING_07_PHASE_RECONCILIATION.md` Part 2.
- `PHASE_14_WARDROBE.md` accepts a raw client-supplied `imageUrl`. It must take an internal upload
  reference instead, matching the KYC fix from `HARDENING_03` Step 1.
