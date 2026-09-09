# Murafiq — Recommended Skills Roadmap by Phase

> **Mandatory Agent Rule:** Before starting any phase listed below, the agent **MUST** check if the recommended skill is installed in `~/.gemini/config/skills/`. If it is not installed, the agent must proactively **remind and prompt the user to install it before beginning that phase**.

---

## Skill-to-Phase Mapping Matrix

| Phase | Phase Name | Recommended Skill | Source Library | Primary Purpose in this Phase |
|---|---|---|---|---|
| **Phase 12** | Background Jobs & Queues | `data-pipeline-builder` / `bullmq-redis-patterns` | `OneWave-AI/claude-skills` | Queue workers, cron repeats (expiry sweeps, reminders), backoff retry strategies |
| **Phase 13** | Security Hardening & Audit | `security-reviewer` or `security-pentest-planner` | `Jeffallan/claude-skills` / `OneWave-AI` | NoSQL injection, mass assignment guards, rate limiter audit, CORS, JWT hygiene |
| **Phase 14** | Wardrobe AI & Embeddings | `rag-engineer` / `langchain-architect` | `Jeffallan/claude-skills` | Gemini vision classification, Upstash Vector embeddings, metadata filters |
| **Phase 15** | AI Stylist Pipeline | `rag-engineer` | `Jeffallan/claude-skills` | Prompt engineering, structured output, knowledge-base RAG. **Not LangGraph** — see `PHASE_15_AI_SKELETON.md` |
| **Phase 16** | Production Deployment | `devops-engineer` or `docker-debugger` | `Jeffallan/claude-skills` / `OneWave-AI` | Multi-stage Dockerfile, MongoDB replica set config, Nginx reverse proxy, PM2 clustering |

---

## Detailed Skill Specifications

### 1. Phase 12 (Background Jobs & Queues)
* **Skill:** `data-pipeline-builder` (or `bullmq-redis-patterns`)
* **Source:** `github.com/OneWave-AI/claude-skills/blob/main/data-pipeline-builder/`
* **Why:** Guides BullMQ job queue architecture, idempotent job registration at server boot, Redis connection failure handling, and exponential backoff retry policies.

---

### 2. Phase 13 (Security Hardening & Auditing)
* **Skill:** `security-reviewer` (or `security-pentest-planner`)
* **Source:** `github.com/Jeffallan/claude-skills/blob/main/skills/security-reviewer/`
* **Why:** Enforces OWASP API security top 10 compliance, NoSQL injection tests, Zod `.strict()` payload rejection checks, IDOR prevention, and sanitization audits.

---

### 3. Phases 14 & 15 (Wardrobe AI, Vector Embeddings & the Stylist Pipeline)
* **Skill:** `rag-engineer` (or `langchain-architect`)
* **Source:** `github.com/Jeffallan/claude-skills/blob/main/skills/rag-engineer/`
* **Why:** Guides vision model prompting, structured-output schemas, vector similarity queries, and strict per-user namespace isolation (preventing cross-user leaks). **Note:** embeddings are generated server-side by Upstash (you send text, not vectors), and LangGraph is explicitly **not** used — ignore any agent-graph guidance the skill offers.

---

### 4. Phase 16 (Deployment Readiness & Containers)
* **Skill:** `devops-engineer` (or `docker-debugger`)
* **Source:** `github.com/Jeffallan/claude-skills/blob/main/skills/devops-engineer/`
* **Why:** Guides production Docker builds, non-root user container security, MongoDB replica set deployment (essential for transactions), and Nginx reverse proxy setup.
