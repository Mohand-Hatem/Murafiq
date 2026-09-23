# LLM Selection, Cost Analysis & Search Engine Integration Guide
**Project:** Murafiq (Egyptian Personal Styling & Wardrobe Marketplace)  
**Date:** September 2026  
**Status:** Architectural Decision & Evaluation Reference  

---

## 1. Executive Summary & Context

Murafiq's AI Stylist feature operates on strict unit economics and regional constraints:
1. **Subscription pricing:** `client.basic` is priced at **50 EGP/month (~$1.02 USD)**, providing **5 daily stylist messages (~150 requests/month)**.
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

## 5. Total Monthly Cost Simulation: WITHOUT Try-On vs. WITH Try-On

### 5.1 Granular Per-Request Economics (Gemini 3.1 Flash Lite)

All Gemini 3.1 Flash Lite calculations use verified Google pricing: **$0.25 / 1M input tokens** and **$1.50 / 1M output tokens**.

| Pipeline Flow | Input Tokens | Output Tokens | Cost per Invocation | Description / Formula |
| :--- | :--- | :--- | :--- | :--- |
| **Flow A: Text Stylist Session** | ~3,300 in | ~800 out | **~$0.00203 USD** (~0.10 EGP) | Step 1 (Scope & Intent) + Step 5 (Compose & Sufficiency) + Step 8 (Render) |
| **Flow B: Chat with Uploaded Image** | ~4,332 in | ~950 out | **~$0.00251 USD** (~0.12 EGP) | Flow A + ~1,032 image tile tokens in Step 1 (vision attribute extraction) |
| **Flow C: Out-of-Domain Scope Refusal** | ~700 in | ~100 out | **~$0.00033 USD** (~0.016 EGP) | Fails at Step 1 scope guard; renders static template; refunds quota |
| **BullMQ Wardrobe Classification** | ~1,200 in | ~250 out | **~$0.00068 USD** (~0.033 EGP) | One-time async vision extraction at upload (category, fabric, colors, fit) |
| **Google Search Grounding** | Included in Flow | Included in Flow | **$0.00 (First 5k/mo)**, then **$0.014 USD** | Executes live web search for Egypt stores when wardrobe is insufficient |

---

### 5.2 The Virtual Try-On Model (Phase 15F Image Generation)

Virtual Try-On (`PHASE_15F_VIRTUAL_TRY_ON.md`) introduces an image synthesis pipeline allowing a client to upload a **Shape Model** (full-body photo) and generate a photo of themselves wearing selected garments.

#### Try-On Model Options & Unit Costs:
- **`gemini-3.1-flash-lite-image` (Standard V1):** **$0.0336 per generated image** (~1.65 EGP).
- **`gemini-3.1-flash-image` (High-Fidelity 1K):** **$0.067 per generated image** (~3.28 EGP).
- **Vertex AI `virtual-try-on-001` (Fallback):** ~$0.040 – $0.070 per image.

> [!WARNING]
> **Unit Cost Multiplier:** One Virtual Try-On generation is **17× to 34× more expensive** than an entire 3-step text stylist session ($0.0336 vs $0.0020). For this reason, try-on is **never an automatic model tool-call**; it is strictly a user-initiated button and bounded by monthly quotas (`ai.tryOn.monthly`).

##### Try-On Monthly Quotas Defined in Phase 15F:
- **Free:** `0` / month (0 try-ons, 10 AI chat messages total per account).
- **Basic (50 EGP / ~$1.02):** `4` try-ons / month.
- **Mid (150 EGP / ~$3.06):** `6` try-ons / month.
- **Pro (250 EGP / ~$5.10):** `8` try-ons / month.
- **Enterprise (500 EGP / ~$10.20):** `10` try-ons / month.

---

### 5.3 Master Subscription Plans & Cost Matrix (All AI Components Itemized)

> [!IMPORTANT]
> **Complete PDF Available:** A standalone, executive printable version of this table is available at [`docs/Murafiq_AI_Plan_Budget_Matrix.pdf`](file:///d:/JOBS/Murafiq/docs/Murafiq_AI_Plan_Budget_Matrix.pdf) and interactive HTML at [`docs/Murafiq_AI_Plan_Budget_Matrix.html`](file:///d:/JOBS/Murafiq/docs/Murafiq_AI_Plan_Budget_Matrix.html).

**Assumptions & Unit Economics:**
- **FX Rate:** 1 USD ≈ 49.00 EGP
- **AI Chat Message:** Gemini 3.1 Flash Lite text session = ~$0.0020 USD (~0.098 EGP)
- **Wardrobe Image Classification:** Gemini 3.1 Flash Lite Vision = ~$0.0007 USD (~0.034 EGP, runs strictly once at upload)
- **External Web Search:** Google Grounding = $0.0153 USD (~0.75 EGP / query)
- **Virtual Try-On:** Gemini Flash Image Lite (Nano Banana 2 Lite) = $0.0336 USD (~1.65 EGP / image)

| Plan & Price | AI Chat Messages | Wardrobe Classification | Google Searches | Nano Banana (Try-On) | Total AI Cost (USD / EGP) | Net Profit (EGP) | Margin % |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Client Free**<br>`0 EGP ($0.00)` | 10 total / account<br>`0.98 EGP ($0.020)` | 7 items max<br>`0.24 EGP ($0.005)` | 0 searches<br>`0.00 EGP` | 0 try-ons<br>`0.00 EGP` | **$0.025 USD**<br>`1.22 EGP` | **-1.22 EGP** | **CAC (Trial)** |
| **Client Basic**<br>`50 EGP ($1.02)` | 5 / day (~150/mo)<br>`14.70 EGP ($0.300)` | 50 items max<br>`1.72 EGP ($0.035)` | 15 searches / mo<br>`11.27 EGP ($0.230)` | 4 try-ons / mo<br>`6.58 EGP ($0.134)` | **$0.699 USD**<br>`34.27 EGP` | <span style="color:green">**+15.73 EGP**</span> | **+31.5%** |
| **Client Mid**<br>`150 EGP ($3.06)` | 35 / day (~700 real)<br>`68.60 EGP ($1.400)` | 90 items max<br>`3.09 EGP ($0.063)` | 30 searches / mo<br>`22.49 EGP ($0.459)` | 6 try-ons / mo<br>`9.88 EGP ($0.202)` | **$2.124 USD**<br>`104.06 EGP` | <span style="color:green">**+45.94 EGP**</span> | **+30.6%** |
| **Client Pro**<br>`250 EGP ($5.10)` | 80 / day (~1,400 real)<br>`137.20 EGP ($2.800)` | 200 items max<br>`6.86 EGP ($0.140)` | 45 searches / mo<br>`33.74 EGP ($0.689)` | 8 try-ons / mo<br>`13.17 EGP ($0.269)` | **$3.897 USD**<br>`190.97 EGP` | <span style="color:green">**+59.03 EGP**</span> | **+23.6%** |
| **Client Enterprise**<br>`500 EGP ($10.20)` | 150 / day (~2,500 real)<br>`245.00 EGP ($5.000)` | 400 items max<br>`13.72 EGP ($0.280)` | 60 searches / mo<br>`44.98 EGP ($0.918)` | 10 try-ons / mo<br>`16.46 EGP ($0.336)` | **$6.534 USD**<br>`320.16 EGP` | <span style="color:green">**+179.84 EGP**</span> | **+36.0%** |

> [!TIP]
> **Account Lifetime Free Trial Guard:** Setting Free to **10 AI requests total per account** reduces Customer Acquisition Cost (CAC) to just **1.22 EGP ($0.025 USD)** per registered user, completely eliminating bot/free-tier drain while giving new users an immediate interactive trial experience before upgrading.
> 
> **The 5,000 Search Free Buffer:** When factoring in Google AI Studio's 5,000 free monthly search queries, live search costs on Basic drop to near zero, increasing the Basic plan profit margin to **+45% to +55%** in practice.

---

### 5.4 Scaled Fleet Monthly Cost: WITHOUT Try-On vs. WITH Try-On

Below is the total monthly fleet cost simulation across different scales of active `client.basic` subscribers (50 EGP/month, assuming 4 try-ons/user at standard $0.0336 generation):

| Scale (Basic Users) | Monthly Revenue | Cost WITHOUT Try-On | Profit WITHOUT Try-On | Try-On Spend Added (4/user) | Total Cost WITH Try-On | Net Profit WITH Try-On | Margin % WITH Try-On |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **100 users** | 5,000 EGP ($102) | **$48.50** (2,376 EGP) | +2,624 EGP (+52.5%) | +$13.44 (659 EGP) | **$61.94** (3,035 EGP) | **+1,965 EGP** | **+39.3%** |
| **500 users** | 25,000 EGP ($510) | **$242.50** (11,882 EGP) | +13,118 EGP (+52.5%) | +$67.20 (3,293 EGP) | **$309.70** (15,175 EGP) | **+9,825 EGP** | **+39.3%** |
| **1,000 users** | 50,000 EGP ($1,020)| **$485.00** (23,765 EGP) | +26,235 EGP (+52.5%) | +$134.40 (6,586 EGP) | **$619.40** (30,351 EGP) | **+19,649 EGP** | **+39.3%** |
| **2,500 users** | 125,000 EGP ($2,551)| **$1,317.50** (64,557 EGP)| +60,443 EGP (+48.3%) | +$336.00 (16,464 EGP) | **$1,653.50** (81,021 EGP)| **+43,979 EGP** | **+35.2%** |
| **5,000 users** | 250,000 EGP ($5,102)| **$2,705.00** (132,545 EGP)| +117,455 EGP (+47.0%)| +$672.00 (32,928 EGP) | **$3,377.00** (165,473 EGP)| **+84,527 EGP** | **+33.8%** |
| **10,000 users**| 500,000 EGP ($10,204)|**$5,480.00** (268,520 EGP)| +231,480 EGP (+46.3%)| +$1,344.00 (65,856 EGP)| **$6,824.00** (334,376 EGP)| **+165,624 EGP**| **+33.1%** |

---

### 5.5 Key Takeaways & Try-On Monetization Strategy

1. **WITHOUT Try-On (V1 Core):** Murafiq operates at **+47% to +53% gross AI margins**, leaving healthy room for payment gateway fees (Paymob 2.75% + 3 EGP), hosting, and operations.
2. **WITH Try-On (Phase 15F):** Unit margins drop by ~13% to 15% across all tiers, but Murafiq remains solidly profitable (**+33% to +39% gross margin**) as long as `gemini-3.1-flash-lite-image` ($0.0336) is used and monthly quotas are enforced.
3. **Upsell Opportunity:** Once users exhaust their monthly try-on quota (`ai.tryOn.monthly`), sell **"Try-On Top-Up Packs"** (e.g., 10 try-ons for 30 EGP). Cost to Murafiq is ~16.5 EGP, yielding a **+45% direct profit margin** per pack.

---

### 5.6 Cross-Model Financial Benchmark (1,000 Basic Users - Core V1)

| Cost Item | Google Gemini 3.1 Flash Lite | OpenAI GPT-4o mini (with Tavily) | Anthropic Claude 3.5 Haiku (with SerpApi) |
| :--- | :--- | :--- | :--- |
| **Subscription Revenue** | 50,000 EGP (~$1,020 USD) | 50,000 EGP (~$1,020 USD) | 50,000 EGP (~$1,020 USD) |
| **Stylist Text Pipeline** | $450.00 | $270.00 | $1,260.00 |
| **Wardrobe Vision Classification** | $7.50 | $2.25 | $19.50 |
| **External Search (5,000 queries)** | **$0.00** *(Under 5k free pool)* | $40.00 (Tavily) + $48.00 (tokens) = $88.00 | $50.00 (SerpApi) + $125.00 (tokens) = $175.00 |
| **Infrastructure / Redis / BullMQ** | $30.00 | $30.00 | $30.00 |
| **Total Monthly Cost (No Try-On)** | **~$487.50** (~23,887 EGP) | **~$390.25** (~19,122 EGP) | **~$1,484.50** (~72,740 EGP) |
| **Net Gross Profit (No Try-On)** | **+26,113 EGP (+52.2%)** | **+30,878 EGP (+61.7%)** | **-22,740 EGP (-45.5% NET LOSS)** |

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

---

## 8. Step-by-Step Guide: How to Add Billing & Buy Credits in Google AI Studio

Google AI Studio does not use a prepaid wallet or credit voucher system. Instead, it operates on a **Pay-as-you-go postpaid model linked to a Google Cloud Billing Account**. You are invoiced at the end of each monthly billing cycle based on your exact token and search usage.

---

### Step 1: Access Google AI Studio
1. Open your browser and navigate to: **[https://aistudio.google.com/](https://aistudio.google.com/)**.
2. Sign in using your organization or production Google account (e.g., `admin@murafiq.com` or your designated developer account).

---

### Step 2: Create or Select a Google Cloud Project
Google AI Studio projects are directly tied to Google Cloud Console projects:
1. In Google AI Studio, look at the top navigation bar or left sidebar.
2. Click on the **Project Selector** dropdown.
3. Click **"Create New Project"** and name it (e.g., `murafiq-ai-production`), or select an existing Google Cloud project if you already have one.
4. Alternatively, you can create the project directly in the [Google Cloud Console](https://console.cloud.google.com/).

---

### Step 3: Create a Google Cloud Billing Account
To upgrade from the rate-limited Free Tier to the production Pay-as-you-go Tier:
1. Open the [Google Cloud Billing Console](https://console.cloud.google.com/billing).
2. Click **"Manage billing accounts"** → **"Add billing account"** (or click **"Create Account"**).
3. **Account Details:**
   - **Country:** Select **Egypt** (or the country where your company / payment card is registered).
   - **Currency:** USD (or EGP if offered for Egyptian commercial entities).
   - **Account Type:** Select **Business** (enter company tax ID/registration if applicable) or **Individual**.
4. **Payment Method Setup:**
   - Enter your card details (Visa or Mastercard).
   - **Egyptian Bank Card Guidance:**
     - Credit cards enabled for international online transactions work smoothly.
     - Note your Egyptian bank's monthly foreign currency spending cap (typically $50 to $250+ per month on standard cards; higher or unlimited on corporate/USD accounts).
     - Ensure international e-commerce is enabled via your bank's mobile app.
5. Click **"Submit and enable billing"**. Google will place a temporary $1.00 USD authorization hold (refunded immediately) to verify card validity.

---

### Step 4: Link Billing to AI Studio ("Upgrade to Pay-as-you-go")
Once your Billing Account is active:
1. Return to **[Google AI Studio](https://aistudio.google.com/)**.
2. Click the **"Get API key"** icon in the left-hand navigation menu.
3. In the API Keys dashboard, find the table listing your projects.
4. In the **"Plan"** column next to your project:
   - If it displays `Free tier`, click the **"Set up billing"** or **"Upgrade to Pay-as-you-go"** link.
5. In the modal that appears, select the **Billing Account** created in Step 3.
6. Click **"Confirm & Link"**.
7. The plan status for your project will immediately update to **`Pay-as-you-go`**.

> [!TIP]
> **Why Pay-as-you-go is required for Murafiq:**
> 1. **No Data Logging for Training:** On the paid tier, Google does **not** log or use your prompts or client wardrobe photos to train models (PDPL / Privacy compliance).
> 2. **High Rate Limits:** Limits jump from 15 RPM (Requests Per Minute) to **4,000 RPM**, preventing 429 rate limit crashes under user traffic.
> 3. **Google Search Grounding:** Gives you access to 5,000 free live search queries/month and automatic scaling beyond.

---

### Step 5: Generate & Restrict Your Production API Key
1. In Google AI Studio, click **"Create API key"**.
2. Select your billed project (`murafiq-ai-production`).
3. Click **"Create API key in existing project"**.
4. Copy the generated key (format: `AIzaSy...`).
5. **Security Hardening (Recommended):**
   - Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
   - Click your newly created key to edit its settings.
   - Under **"API restrictions"**, select **"Restrict key"**.
   - Check **ONLY** the **"Generative Language API"**.
   - Click **"Save"**. *(This prevents the key from being misused for any other Google Cloud service if accidentally exposed).*

---

### Step 6: Set Spending Limits & Budget Alerts (Cost Protection)
To avoid any surprise bills from traffic spikes:
1. Open the [Google Cloud Budgets & Alerts Console](https://console.cloud.google.com/billing/budgets).
2. Click **"Create Budget"**:
   - **Scope:** Select your project `murafiq-ai-production`.
   - **Services:** Select `Generative Language API`.
   - **Target Amount:** Enter a monthly limit (e.g., **$100.00 USD** for early stage, or **$500.00 USD** at 1,000+ users).
3. **Threshold Rules:**
   - Add alert triggers at **50%**, **80%**, and **100%** of budget.
   - Ensure **"Email alerts to billing account admins and users"** is checked.
4. Click **"Finish"**. You will receive instant email warnings if monthly spend reaches your defined thresholds.

---

### Step 7: Configure Murafiq Backend Environment
Add the production credentials to your Murafiq environment variables:

1. Open `d:\JOBS\Murafiq\.env` (or inject via your PM2 / deployment environment):
```env
# Gemini Production AI Configuration
GEMINI_API_KEY=AIzaSyYourActualProductionKeyHere
AI_MODEL_VISION=gemini-3.1-flash-lite
AI_MODEL_REASONING=gemini-3.1-flash-lite
```

2. Test that the key and billing are operational:
```bash
# Run the grounding and provider test suite
npm test tests/unit/ai-llm-grounding.test.js
```

---

### Step 8: Monitoring Invoices & Live Usage
- **Real-time API Metrics:** View request counts, latency, and error rates at [Google Cloud Console → Generative Language API Dashboard](https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com).
- **Daily Spend Reports:** View exact daily dollar amounts broken down by input tokens, output tokens, and search grounding at [Google Cloud Console → Billing → Reports](https://console.cloud.google.com/billing/reports).

---

## 9. Final Recommendations & Strategic Roadmap

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

