# Phase 15 — AI Module (Skeleton, except the wardrobe tool)

## Goal
Create the `ai` module's folder/file structure and route wiring **without** installing LangChain/LangGraph/OpenAI/Pinecone dependencies or writing real agent logic — with **one exception**: `getOutfitSuggestions` is real, because it's built directly on the vision-classification + vector-embedding pipeline Phase 14 already installed and populated. Every other tool stays a placeholder. `/api/v1/ai/chat` itself still returns "not available yet" for general conversation until the full agent graph is built — only the outfit tool's underlying logic is real at this point, wired in later once the chat/agent layer exists.

> 🔔 **Recommended Skill for this Phase:**
> Install **`rag-engineer`** (from `Jeffallan/claude-skills`) or **`langchain-architect`** before starting this phase to guide LangGraph agent graph configuration, tool calling patterns, and prompt engineering.

## Depends on
Phase 5 (bookings/requests services exist — future tools will call them) and Phase 14 (wardrobe items + their embeddings must already exist for `getOutfitSuggestions` to have anything to query).

---

## Steps

### 1. Create the folder structure exactly as defined in `01_PROJECT_STRUCTURE.md`
```
modules/ai/
├── ai.routes.js
├── ai.controller.js
├── chat/
├── agent/
│   ├── graph.js
│   └── prompts/
├── tools/
├── rag/
│   ├── ingestion/
│   ├── retriever.js
│   └── embeddings.js
└── memory/
```
Every file below is a **placeholder** — a few lines, correct exports, no real logic.

### 2. `ai.routes.js` + `ai.controller.js`
```js
// ai.controller.js
exports.chat = catchAsync(async (req, res) => {
  throw new ApiError(501, 'AI Assistant is not available yet');
});
```
```js
// ai.routes.js
router.post('/chat', authMiddleware, aiController.chat);
```
Mount under `/api/v1/ai` in `routes/index.js` so the route exists and is discoverable in Swagger, but every call returns `501 Not Implemented` with a clear message.

### 3. Tool stubs (`tools/*.tool.js`) — one file per planned tool

Most stay signature-only placeholders:
```js
// tools/searchStylists.tool.js
// Future: LangChain tool wrapping stylistService.search()
// Not implemented yet — placeholder only.
module.exports = {
  name: 'searchStylists',
  description: 'Search for stylists by filters',
  // schema: z.object({...}) — to be defined when the AI module is actually built
  handler: async () => { throw new Error('Not implemented'); },
};
```
Create the same placeholder shape for: `findNearestStylists`, `checkAvailability`, `createRequest`, `getBookings`, `getBookingDetails`, `cancelBooking`, `searchServices`.

**`getOutfitSuggestions` is the one real tool in this phase.** It doesn't need the agent/chat layer to exist first because it isn't a multi-turn conversation — it's a single direct function call:
```js
// tools/getOutfitSuggestions.tool.js
module.exports = {
  name: 'getOutfitSuggestions',
  description: "Given one of the client's wardrobe items, suggest what to pair it with — both from their own closet and general style knowledge.",
  handler: async ({ userId, itemId }) => {
    const targetItem = await wardrobeService.getItem(userId, itemId);

    // 1. Retrieval scoped to THIS user's own closet vectors (built in Phase 14) —
    //    a personal RAG, separate from the shared knowledge-base RAG under rag/.
    const ownedMatches = await wardrobeService.findCompatibleItems(userId, targetItem);

    // 2. Pure LLM knowledge, no retrieval — general pairing advice for this
    //    item's color/style, independent of what the client actually owns.
    const generalAdvice = await llm.complete({ prompt: buildStylePrompt(targetItem.aiDescription) });

    // 3. Merge — kept as two labeled fields, never blended into one blob, so the
    //    client can tell "you already own this" from "you'd need to buy this".
    return { fromYourCloset: ownedMatches, generalSuggestions: generalAdvice };
  },
};
```
> **Why two separate knowledge sources, not one?** Retrieval-only would miss good advice for items the client doesn't yet own (e.g. "white sneakers usually pair with raw denim" when there's no jeans in their closet). LLM-only would ignore the entire reason this feature exists — recommending from what the client actually has. Keeping them as two labeled response fields (instead of asking the LLM to silently merge them) keeps the source of each suggestion transparent and stops the LLM from inventing an item that isn't actually in the client's closet.

**Architectural point that applies to every tool, real or stub:** the handler calls existing `*.service.js` functions from other modules — never a model (or, for `getOutfitSuggestions`, the vector DB SDK) directly.

### 4. `rag/`, `agent/`, `memory/` — README placeholders only
Each empty-ish folder gets a short `README.md` describing its future purpose, not code, since there's genuinely nothing to implement yet:
```md
# rag/
Will contain the ingestion pipeline (chunking + embeddings) and retriever for
the shared knowledge base (fashion advice, style guides, FAQs, platform policies).
Uses OpenAI Embeddings + Pinecone/Qdrant. Never touches transactional data —
see 01_PROJECT_STRUCTURE.md, "AI Module" section, for the architectural rule.

Note: this is NOT where wardrobe/closet retrieval lives. Each client's own
wardrobe item vectors are indexed and queried by the `wardrobe` module
(Phase 14), scoped per-user — a separate personal index, not this shared
knowledge base. `getOutfitSuggestions` queries it via `wardrobeService`,
never through this folder.
```

### 5. Still do **not** yet
- Do not install LangChain / LangGraph — no multi-step agent graph exists yet; `getOutfitSuggestions` is one direct function call, not an agent tool invoked through a graph.
- Do not build `agent/graph.js` or `rag/retriever.js` (the **shared knowledge-base** retriever — style guides/FAQs/policies) for real, and do not wire `/api/v1/ai/chat` for general conversation — those stay `501`/placeholders.
- Do not talk to the vector DB SDK directly from this module — `getOutfitSuggestions` goes through `wardrobeService`, which already wraps it (installed and required as of Phase 14).
- No env changes needed here — `OPENAI_API_KEY` and the vector DB credentials are already **required** in `env.config.js` as of Phase 14, not optional.

---

## Definition of Done

- [ ] `POST /api/v1/ai/chat` still returns `501` with a clear message (general conversation isn't built yet) — not a 404 or crash.
- [ ] `getOutfitSuggestions` returns a real `{ fromYourCloset, generalSuggestions }` response for a seeded wardrobe item — not a stub throw.
- [ ] Every other tool file still throws `'Not implemented'` — confirm none were accidentally wired for real while building the outfit tool.
- [ ] Folder structure matches `01_PROJECT_STRUCTURE.md` exactly.
- [ ] No LangChain/LangGraph packages installed yet.
- [ ] `03_SKELETON_STATUS.md` "AI Module" section accurately reflects this mixed state (one real tool, the rest stubs) — see that file for the full activation checklist.
- [ ] Every new route in this phase has an @swagger JSDoc block covering summary, request body, and response codes; /api/docs renders it without errors.
