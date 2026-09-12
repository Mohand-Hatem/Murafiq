# Phase 15E — External Product Search (final V1 phase)

> Read `PHASE_15_AI_SKELETON.md` first for the locked architectural decisions.
> **Status:** ⛔ Not started. **Blocked by** `PHASE_15D`.

## Goal

Close the loop when the client's wardrobe cannot produce a suitable outfit: identify the
missing item types, then find real, purchasable, **cited** products.

*"The wardrobe does not contain a sufficiently suitable combination — here is what you'd
need: navy formal trousers, a white dress shirt, a dark blazer, formal leather shoes"* —
followed by grounded links.

This is the last phase of V1. After it, Phases A→E deliver the complete product statement.

## Depends on

`PHASE_15D`.

---

## Steps

### Step 1 — Product search service

**File:** `src/modules/ai/products/product-search.service.js`

```
searchExternalProducts(gapDescription, { locale, budget? }) -> { items[], citations[] }
```

Uses the **same model** (`AI_MODEL_REASONING`) with the `google_search` grounding tool
enabled. Grounding is combinable with structured output on Gemini 3.x.

> **Why grounding and not a product catalog or an affiliate API:** nothing to ingest, no
> price or stock staleness to manage, no partner integration to negotiate, no scraped
> product database raising a PDPL data-residency question, and Egypt-market coverage comes
> from Google rather than from us. It also means **no new vendor** — same SDK, same key.

Return **titles, descriptions and source links**. Product imagery is best-effort: grounding
returns citations, not a guaranteed image per result. Do not promise images in the API
contract.

Citations must be surfaced to the user — that is both a grounding-quality signal and a
display requirement of the tool.

### Step 2 — Gap analysis

**File:** `src/modules/ai/stylist/compose.step.js` (extend the insufficiency branch)

On `sufficiency: 'none'`, turn `missingSlots[]` plus the resolved dress code plus the
`PHASE_15D` knowledge chunks into concrete item **types** — *"navy formal trousers"*, not
*"bottoms"*. That description is what gets searched.

### Step 3 — Quota

**Files:** `src/modules/subscriptions/plan.constants.js`, `entitlement.service.js`

New key **`ai.productSearch.daily`**. Suggested **0 / 1 / 3 / 5 / 10** across
free/basic/mid/pro/enterprise — paid tiers only, unlike image input which gets a free-tier
taste.

**Why this one is stricter.** Grounding costs **$14 per 1,000 queries**, with 5,000/month
free on the Gemini 3.x family. At $0.014 per search that is roughly the margin of seven
stylist requests. The free pool is **account-level and shared across all users**, so one
heavy user can drain it for everybody — which is exactly why a per-user quota is required
and a tier gate alone is not enough.

Consume **only** on the branch that actually performs a search. Never on a wardrobe-sufficient
request. Add to `FALLBACK_FREE_ENTITLEMENTS`. **No plan names in the AI module.**

### Step 4 — Gating rules

Product search runs only when **all** of these hold:

1. `sufficiency === 'none'` (or the user explicitly asked to buy something —
   *"what can I buy that goes with this shirt?"*, which is **in domain**), **and**
2. `ai.productSearch.daily` has remaining quota, **and**
3. the user's tier permits it.

**Never automatic.** When blocked, degrade gracefully to a shopping list from model knowledge
plus an optional `suggestBookStylist` CTA — Murafiq's actual business, and the hook
`next-phase/PHASE_15_PRODUCT_BRIEF.md:33` already anticipates. A blocked search is a soft outcome, not an
error.

### Step 5 — Response shape

External results go in **`suggestedToAcquire[]`**, always separate from `fromYourWardrobe[]`.

> Owned and not-owned **never** blend into one blob. The client must be able to tell "you
> already own this" from "you would need to buy this" without reading prose. This is the
> third invariant in `PHASE_15_AI_SKELETON.md` and it is what makes the external path honest.

Persist as an `Outfit` with `source: 'external'` so recommendations remain reviewable.

### Step 6 — Cost monitoring

Log grounded-query count per request in the trace. Track monthly consumption against the
5,000 free pool and alert before it is exhausted — the first paid query should not be a
surprise on an invoice.

---

## Definition of Done

- [ ] A client whose wardrobe cannot cover a formal wedding receives concrete item types plus cited external products.
- [ ] Results carry titles, descriptions and source links; citations are rendered.
- [ ] `suggestedToAcquire[]` and `fromYourWardrobe[]` are **never** merged, in any response shape.
- [ ] `ai.productSearch.daily` blocks at the boundary; a blocked search degrades to a knowledge-only shopping list rather than erroring.
- [ ] A free-tier client never triggers a grounded query.
- [ ] A wardrobe-sufficient request never consumes product-search quota — verified in the trace.
- [ ] *"What can I buy that goes with this shirt?"* is **answered**, not refused — it is in domain.
- [ ] **Still no** LangChain, LangGraph, second AI provider, or new vector store in `package.json`.
- [ ] Grounded-query count appears in the trace log; monthly free-pool consumption is monitored.
- [ ] Golden set extended with insufficiency cases in both languages.
- [ ] Full Jest suite green.

---

## ── END OF V1 ──

Phases `HARDENING_08` → `15A` → `15B` → `15C` → `15D` → `15E` deliver the complete product:

> An AI personal stylist that helps a client decide what to wear for a specific event **or
> for a specific garment they show it**, prioritizing the client's own wardrobe and falling
> back to external fashion/product recommendations when the wardrobe is insufficient.

**Not in V1, not committed:** multi-turn conversation and streaming (the phase where
LangGraph gets re-evaluated against the triggers in `PHASE_15_AI_SKELETON.md`), item-centric
pairing (`getOutfitSuggestions`), and outfit image generation.
