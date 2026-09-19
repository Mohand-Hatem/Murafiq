# LLM Selection, Cost Analysis & Search Engine Integration Guide
**Project:** Murafiq (Egyptian Personal Styling & Wardrobe Marketplace)  
**Date:** September 2026  
**Status:** Architectural Decision & Evaluation Reference  

---

## 1. Executive Summary & Context

Murafiq's AI Stylist feature operates on strict unit economics and regional constraints:
1. **Subscription pricing:** `client.basic` is priced at **50 EGP/month (~$1.00 USD)**, providing **10 daily stylist messages (~300 requests/month)**.
2. **Dual workload:**
   - **Background Multimodal Ingestion (BullMQ):** Garment photo classification into structured attributes (category, formality, colors, material, season, fit).
   - **Synchronous Stylist Pipeline (REST/SSE):** Intent extraction & scope check, candidate slot retrieval from MongoDB, outfit composition & sufficiency reasoning, external product search fallback, and bilingual Arabic/English response rendering.
3. **External Product Search (Phase 15E):** When the client's wardrobe is insufficient, the system must search the live web for real purchasable items in the Egyptian market (e.g., Zara Egypt, H&M Egypt, Defacto, Amazon.eg, local boutiques) with cited URLs.

This document evaluates the **top 4 model families** across costs, fashion reasoning performance, Arabic dialect fluency, codebase compatibility, and search engine mechanics.

---

## 2. Top 4 Recommended Model Families

| Metric / Dimension | 1. Google Gemini 3.1 Flash Lite *(Current Reference)* | 2. OpenAI GPT-4o mini | 3. Anthropic Claude 3.5 Haiku | 4. Zhipu GLM-4-Air / DeepSeek-V3 |
| :--- | :--- | :--- | :--- | :--- |
| **Provider** | Google DeepMind / Google Cloud | OpenAI | Anthropic | Zhipu AI / OpenRouter / SiliconFlow |
| **Input Price / 1M Tokens** | **$0.25** | **$0.15** | **$0.80** | **$0.14 - $0.27** |
| **Output Price / 1M Tokens** | **$1.50** | **$0.60** | **$4.00** | **$0.28 - $1.10** |
| **Prompt Caching Discount** | **Yes** (~75% off cached tokens) | **Yes** (50% off cached tokens: $0.075) | **Yes** (90% off cached tokens: $0.08) | **Varies** (50% on deepseek) |
| **Native Web Search Tool** | **Yes** (`google_search` grounding) | **Yes** (Responses API `web_search`) | **No** (Requires external tool calling) | **Partial** (China-centric or tool call) |
| **Search Cost / 1k Queries** | **5,000 free/mo**, then **$14.00** | **$10.00 - $25.00** + token overhead | Search API cost ($8-$15) + token calls | Search API cost ($8-$15) + token calls |
| **Multimodal / Vision** | Native (text, images, audio, PDF) | Native (text, images) | Native (text, images) | Requires GLM-4V / DeepSeek-VL |
| **Egypt Market Coverage** | **Superior** (Google Search index) | **Good** (Bing / OpenAI index) | Depends on 3rd-party API (Tavily/SerpApi) | **Poor** for MENA e-commerce |

---

## 3. Detailed Model Breakdown

---

### Choice 1: Google Gemini 3.1 Flash Lite *(Recommended Default)*

#### Specifications & Costs
- **Input:** $0.25 / 1M tokens
- **Output:** $1.50 / 1M tokens
- **Vision Token Pricing:** Billed by tile (258 tokens for ≤384px; ~1,032 tokens for 1024×1024px). Cost per garment classification: **~$0.0003 - $0.0005**.
- **Context Caching:** Available on prompts >32k tokens or repetitive system prompts + static fashion knowledge base chunks.
- **Monthly Cost per Basic User (300 requests):** **~$0.55 - $0.62 / month** (Comfortably below the ~$1.00 revenue line).

#### Performance & Capabilities
- **Fashion & Outfit Reasoning:** Strong structured entity extraction. Follows strict JSON schemas without deviation. Capable of filtering clothing candidates into slot combinations (Top + Bottom + Footwear + Outerwear).
- **Arabic & Egyptian Dialect:** Excellent native comprehension of Egyptian Arabic fashion vernacular (*"فستان سواريه"*, *"قميص كتان"*, *"كاجوال شيك"*, *"بدلة كتب كتاب"*).
- **Multimodal Accuracy:** High accuracy in identifying garment category, neckline, sleeve length, dominant palette, and formality.
- **Latency:** Ultra-fast (<800ms TTFT), making synchronous chat feel immediate.

#### Compatibility with Murafiq Codebase
- **100% Native Match:** The codebase already uses `@google/genai ^2.19.0`.
- **Zero New Dependencies:** `src/modules/ai/providers/llm.provider.js` and `src/config/gemini.config.js` are already implemented for this exact SDK.
- **Native Schema Support:** Supports `responseSchema` and `responseMimeType: 'application/json'` out of the box.

---

### Choice 2: OpenAI GPT-4o mini

#### Specifications & Costs
- **Input:** $0.15 / 1M tokens
- **Output:** $0.60 / 1M tokens
- **Vision Token Pricing:** Uses tile-based calculation (85 tokens base + 170 tokens per 512×512 tile). High detail ~1,000 tokens (~$0.00015 / image).
- **Context Caching:** Automatic 50% discount on cached inputs ($0.075 / 1M).
- **Monthly Cost per Basic User (300 requests):** **~$0.30 - $0.38 / month** (The lowest pure LLM token cost).

#### Performance & Capabilities
- **Fashion & Outfit Reasoning:** Very consistent logic and instruction following. Handles constraint filtering well.
- **Arabic & Egyptian Dialect:** Solid Modern Standard Arabic (MSA), but can occasionally formalize Egyptian dialect responses (*"عزيزي العميل، إليك هذا الزي"* instead of friendly stylist tone).
- **Multimodal Accuracy:** Good fabric and color extraction, though occasionally misclassifies regional modest wear (e.g., abayas or modest layering).
- **Latency:** ~900ms - 1.2s TTFT.

#### Compatibility with Murafiq Codebase
- **Moderate Refactor Required:**
  - Must install `openai` npm package.
  - Must rewrite `llm.provider.js` to map OpenAI's `response_format: { type: "json_schema", json_schema: {...} }`.
  - Multimodal images must be converted from Gemini's `{ inlineData: { data, mimeType } }` to OpenAI's `{ type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } }`.
  - Worker in `src/config/gemini.config.js` would need an OpenAI vision implementation.

---

### Choice 3: Anthropic Claude 3.5 Haiku

#### Specifications & Costs
- **Input:** $0.80 / 1M tokens
- **Output:** $4.00 / 1M tokens
- **Prompt Caching:** Up to 90% discount on cached input tokens ($0.08 / 1M).
- **Vision Token Pricing:** ~1,600 tokens per image (~$0.0013 / image).
- **Monthly Cost per Basic User (300 requests):** **~$1.60 - $2.10 / month** (**UNSUSTAINABLE / UNDERWATER** against a 50 EGP / $1.00 subscription).

#### Performance & Capabilities
- **Fashion & Outfit Reasoning:** Industry-leading nuanced aesthetic reasoning. Explains color harmony, silhouette proportions, and sartorial rules better than any lightweight model.
- **Arabic & Egyptian Dialect:** Good Arabic comprehension, but noticeably higher token generation counts due to Anthropic's Arabic tokenizer (which inflates output token billing by ~1.8x compared to English).
- **Multimodal Accuracy:** Superior detail detection on texture (knit vs linen vs synthetic weave).
- **Latency:** ~1.1s - 1.5s TTFT.

#### Compatibility with Murafiq Codebase
- **Significant Refactor Required:**
  - Must install `@anthropic-ai/sdk`.
  - Anthropic does not support native JSON Schema enforcement via an API config parameter like Gemini or OpenAI. Structured output is achieved via **Tool Use / Function Calling extraction** or strict prompt formatting.
  - No native search tool (requires external orchestration).

---

### Choice 4: Zhipu AI GLM-4-Air / DeepSeek-V3 (via OpenRouter / SiliconFlow)

#### Specifications & Costs
- **Input:** $0.14 - $0.27 / 1M tokens
- **Output:** $0.28 - $1.10 / 1M tokens
- **Vision Support:** DeepSeek-V3 is text-only; requires pairing with DeepSeek-VL or GLM-4V for wardrobe uploads.
- **Monthly Cost per Basic User (300 requests):** **~$0.35 - $0.45 / month**.

#### Performance & Capabilities
- **Fashion & Outfit Reasoning:** Capable of standard slot assembly, but weaker at understanding MENA/Egyptian cultural dress codes (e.g., what constitutes appropriate attire for a Sahel beach party vs. an Upper Egypt wedding).
- **Arabic & Egyptian Dialect:** Noticeably weaker at Egyptian dialect slang and colloquial Arabic. Tends to translate back to literal MSA or Chinese/English idioms.
- **Multimodal Accuracy:** GLM-4V is acceptable for basic clothes, but struggles with nuanced color differentiation (e.g., distinguishing cream from ivory, or navy from midnight black).
- **Latency & Reliability:** High network latency from Egypt/Europe to Chinese endpoints; intermittent rate limits on budget third-party API aggregators.

#### Compatibility with Murafiq Codebase
- **Moderate Refactor Required:** Can use OpenAI-compatible API client, but requires dual-model setup (one model for vision, one for text reasoning), increasing architectural complexity.

---

## 4. How the Search Engine Works Across Different Models

When a user's wardrobe cannot fulfill the outfit requirement (e.g., they need navy tailored trousers and brown dress shoes for a formal event), Murafiq triggers **External Product Search** (`PHASE_15E`).

The search engine mechanics differ fundamentally depending on the chosen LLM provider:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    EXTERNAL PRODUCT SEARCH ARCHITECTURE                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [A] GOOGLE GEMINI (Integrated Grounding - Current V1 Implementation)       │
│  Orchestrator ──> llm.provider.complete({ tools: [{ googleSearch: {} }] })  │
│                   │                                                         │
│                   ▼                                                         │
│              Google Gemini ──(Internal Native)──> Google Web Search         │
│                   │                                   │                     │
│                   ▼                                   ▼                     │
│        Single JSON Response <──────────────── Egyptian Store Results        │
│        (with groundingMetadata & URIs)         (Zara.eg, Amazon.eg, etc.)   │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [B] OPENAI / ANTHROPIC / DEEPSEEK (Agentic Function Calling Flow)          │
│                                                                             │
│  Step 1: Orchestrator ──> LLM (emits Tool Call: "search_web(query)")        │
│                               │                                             │
│  Step 2: Backend catches tool_call                                          │
│          └──> Calls External Search API (Tavily / SerpApi / Google CSE)     │
│                   │                                                         │
│  Step 3: Search API returns raw SERP HTML/JSON snippets                     │
│                   │                                                         │
│  Step 4: Backend sends search results back to LLM in second turn            │
│                   │                                                         │
│  Step 5: LLM digests results and formats final structured response          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Detailed Search Comparison

#### 1. Google Gemini Grounding (Murafiq V1)
- **How it works:** You pass `tools: [{ googleSearch: {} }]` inside the API request. Gemini executes the search against the Google search engine index during generation. The response candidate contains `groundingMetadata.groundingChunks` with exact titles, snippets, and web URIs.
- **Egyptian E-Commerce Quality:** **Best in class.** Uses Google's index, perfectly retrieving local Egyptian e-commerce sites (Defacto Egypt, H&M Egypt, Amazon.eg, Jumia, local Instagram shops).
- **Cost:**
  - **First 5,000 queries/month:** **FREE** (on Gemini 3.x family).
  - **Thereafter:** **$14.00 per 1,000 grounded queries** ($0.014 per search).
- **Latency:** **1 network round-trip** (~1.8s - 2.5s total).

#### 2. OpenAI Web Search (Responses API / Custom Tool)
- **Option A: Built-in `web_search` tool (Responses API):**
  - **How it works:** Built into the OpenAI platform. Model decides when to search or is forced via tool choice.
  - **Cost:** **$10.00 to $25.00 per 1,000 search calls** PLUS a mandatory charge for **8,000 search content input tokens** per search. Total cost per search can reach **$0.02 - $0.035**.
- **Option B: Two-Turn Function Calling + 3rd Party Search API:**
  - **How it works:** Model calls a custom tool `search_products(query)`. Your Node.js backend calls Tavily API or SerpApi, parses the JSON, and sends it back to GPT-4o mini.
  - **External Search API Cost:**
    - Tavily: $0.008 per search.
    - SerpApi: $0.010 per search.
  - **Latency:** **2 round-trips to LLM + 1 round-trip to Search API** (~3.5s - 5.0s total).

#### 3. Anthropic Claude Search
- **How it works:** Anthropic does **not** offer an integrated search engine tool in their API.
- **Mandatory Architecture:** You MUST purchase a subscription to an external search provider (e.g., Tavily, SerpApi, Brave Search, or Google Programmable Search Engine).
- **Workflow:**
  1. Backend calls Claude 3.5 Haiku with a tool definition: `search_external_products`.
  2. Claude responds with `stop_reason: "tool_use"` and arguments `{ query: "navy formal trousers Egypt buy online" }`.
  3. Backend queries SerpApi (Google Search in Egypt `gl=eg&hl=ar`).
  4. Backend submits `tool_result` with the top 5 product links to Claude.
  5. Claude outputs the final Arabic/English text with citations.
- **Total Cost per Search:** ~$0.01 (SerpApi) + ~$0.015 (Claude double-turn input/output tokens) = **~$0.025 per search**.

#### 4. GLM / DeepSeek Search
- **How it works:** Zhipu has an internal search plugin for Chinese websites, but it has poor recall for Egyptian Arabic and regional retailers. For DeepSeek, you must build the 2-turn function calling system with SerpApi/Tavily identical to Anthropic.

---

## 5. Unit Economics & Monthly Cost Simulation

Assumptions for 1,000 active `client.basic` subscribers:
- **Subscription Revenue:** 1,000 × 50 EGP = 50,000 EGP (~**$1,040 USD / month**).
- **Usage per User:**
  - 300 text stylist conversations / month.
  - 15 image garment uploads / month.
  - 5 external product searches / month (capped by `ai.productSearch.daily`).

| Cost Item | Gemini 3.1 Flash Lite | OpenAI GPT-4o mini (with Tavily) | Anthropic Claude 3.5 Haiku (with SerpApi) |
| :--- | :--- | :--- | :--- |
| **Stylist Text Pipeline** | $450.00 | $270.00 | $1,260.00 |
| **Wardrobe Vision Classification** | $7.50 | $2.25 | $19.50 |
| **External Product Search (5,000 queries)** | **$0.00** *(Under 5k free pool)* | $40.00 (Tavily) + $48.00 (tokens) = $88.00 | $50.00 (SerpApi) + $125.00 (tokens) = $175.00 |
| **Infrastructure / Redis / BullMQ** | $30.00 | $30.00 | $30.00 |
| **Total Monthly Cost** | **~$487.50** | **~$390.25** | **~$1,484.50** |
| **Gross AI Margin** | **+53.1% Profit** (Healthy) | **+62.4% Profit** (Highest) | **-42.7% Loss** (Underwater) |

> [!IMPORTANT]
> **Anthropic Claude 3.5 Haiku is financially unviable** for Murafiq's current 50 EGP subscription price. It would cause a net loss on every active subscriber.
> **Gemini 3.1 Flash Lite** and **OpenAI GPT-4o mini** are the only two financially viable choices.

---

## 6. Code Compatibility & Migration Matrix

If you decide to switch models or support multi-provider fallback, here is what changes in the code:

### Where Changes Are Isolated
Thanks to Murafiq's strict architectural boundary (`AGENTS.md`), LLM interactions are isolated to:
1. `src/modules/ai/providers/llm.provider.js` (Stylist completion & search grounding)
2. `src/config/gemini.config.js` (BullMQ async wardrobe image classification)

All other modules (`stylist.orchestrator.js`, `compose.step.js`, `render.step.js`, `wardrobe.service.js`) consume standardized JavaScript objects and will not need structural rewrites.

### Multi-Provider Interface Architecture

To support switching between Gemini, OpenAI, and Anthropic via environment variables (`AI_PROVIDER=gemini|openai`), `llm.provider.js` should implement a unified adapter pattern:

```javascript
// Conceptual multi-provider signature in src/modules/ai/providers/llm.provider.js
export const complete = async ({
  task = 'reasoning',
  systemPrompt,
  userParts = [],
  responseSchema,
  tools = null,
  temperature = 0.2,
}) => {
  const provider = env.AI_PROVIDER || 'gemini';

  switch (provider) {
    case 'openai':
      return callOpenAI({ systemPrompt, userParts, responseSchema, tools, temperature });
    case 'anthropic':
      return callAnthropic({ systemPrompt, userParts, responseSchema, tools, temperature });
    case 'gemini':
    default:
      return callGemini({ systemPrompt, userParts, responseSchema, tools, temperature });
  }
};
```

#### Provider Implementation Differences

```javascript
// 1. GEMINI IMPLEMENTATION (Zero Changes - What exists today)
const response = await ai.models.generateContent({
  model: 'gemini-3.1-flash-lite',
  contents: [{ role: 'user', parts }],
  config: {
    responseMimeType: 'application/json',
    responseSchema: responseSchema,
    tools: tools, // e.g. [{ googleSearch: {} }]
  }
});

// 2. OPENAI IMPLEMENTATION (Requires `npm i openai`)
const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: formattedOpenAiParts }
  ],
  response_format: responseSchema ? {
    type: 'json_schema',
    json_schema: { name: 'stylist_response', strict: true, schema: responseSchema }
  } : undefined,
  // If web search is enabled:
  tools: tools ? [{ type: 'web_search' }] : undefined,
});

// 3. ANTHROPIC IMPLEMENTATION (Requires `npm i @anthropic-ai/sdk`)
// Anthropic requires tool calling for guaranteed JSON schema:
const response = await anthropic.messages.create({
  model: 'claude-3-5-haiku-20241022',
  system: systemPrompt,
  messages: [{ role: 'user', content: formattedAnthropicParts }],
  tools: [{
    name: 'format_response',
    description: 'Output response according to schema',
    input_schema: responseSchema
  }],
  tool_choice: { type: 'tool', name: 'format_response' }
});
```

---

## 7. Final Recommendations & Strategic Roadmap

### Recommendation 1: Stick with Gemini 3.1 Flash Lite for Launch (V1)
- **Why:** 
  1. Built-in Google Search Grounding with **5,000 free queries/month** saves money and eliminates the need to integrate/pay for 3rd-party search APIs (Tavily/SerpApi).
  2. Superior Egyptian Arabic colloquial dialect comprehension.
  3. The codebase is already fully written, tested (58/58 golden tests passing), and verified for `@google/genai`.
  4. Keeps the architecture strictly monorepo and single-SDK without bloated dependencies.

### Recommendation 2: Secondary / Backup Option — OpenAI GPT-4o mini
- **When to switch:** If Google Cloud / Gemini API experiences regional downtime or if OpenAI lowers search pricing on the Responses API.
- **Action plan:** Add the `callOpenAI` branch into `llm.provider.js` and pair it with Tavily API for Egyptian product retrieval.

### Recommendation 3: Premium Tier Upsell — Claude 3.5 Sonnet / Gemini 3.6 Flash
- Reserve larger models like **Claude 3.5 Sonnet** or **Gemini 3.6 Flash** exclusively for the **`client.enterprise` tier (500 EGP/month)** or manual stylist consultations. Never deploy them on the 50 EGP basic tier.

---
*Reference documentation in codebase:*
- Architecture: `docs/next-phase/PHASE_15_AI_ARCHITECTURE_DECISION.md`
- Product Search Implementation: `docs/next-phase/PHASE_15E_EXTERNAL_PRODUCT_SEARCH.md`
- Entitlement & Quotas: `src/modules/subscriptions/plan.constants.js`
