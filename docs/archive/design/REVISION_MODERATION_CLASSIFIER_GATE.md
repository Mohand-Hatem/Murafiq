# External Moderation Classifier — 4-Point Gate Findings

> **Status: analysis only. Nothing enabled, nothing integrated.**
> `MODERATION_PROVIDER` remains `none`. The deterministic pipeline is unchanged. This document exists
> so the enable/don't-enable decision can be made on evidence rather than vibes.
>
> **Decision owner:** product owner. **Prepared:** 2026-08-28.

## How to read the confidence markers

| Marker | Meaning |
|---|---|
| **[VERIFIED]** | Checked directly against this codebase. Cite included. |
| **[NEEDS CHECK]** | External fact about a third party. Stated from general knowledge, **must be confirmed against the vendor's live pages before it is relied on.** Vendor pricing, quotas and terms change without notice, and this document's author cannot see them. |
| **[LEGAL]** | Requires qualified legal advice, not an engineering opinion. |

---

## Executive recommendation

**Do not enable an external classifier for v1. Revisit after you have real traffic data.**

The reasoning is not primarily cost or rate limits — those are probably manageable. It is that
**the only way the classifier adds real value is also the way that maximises privacy exposure**, and
Murafiq currently has no data with which to judge whether that trade is worth making.

Three findings drive this:

1. **The gap the classifier fills requires sending *everything*.** Threats and harassment don't trip
   any local rule, so a "only escalate what already matched locally" design — the cheap, low-exposure
   option — would never see them. Closing the gap means transmitting every message. See §0.
2. **You would be exporting exactly the data you are trying to protect.** Murafiq chat contains
   meeting addresses, phone numbers, and appearance discussion between a client and a stylist meeting
   in person. See §4.
3. **Egypt's PDPL restricts cross-border transfer of personal data.** This is a licensing question,
   not a config flag. See §3. **[LEGAL]**

None of these are blockers forever. They are reasons the decision should follow the observe-only
window (§O.9 of the spec), not precede it.

---

## §0. The architectural fork that determines all four answers

Before costing anything, decide *when* the classifier would be called. There are only two options and
they have completely different profiles:

| | **A — Escalate-on-hit** | **B — Scan-everything** |
|---|---|---|
| Called when | A local rule already matched | Every message, always |
| Volume | ~1–3% of messages | 100% |
| Cost | Negligible | Full volume |
| Rate-limit risk | Very low | Real, needs capacity planning |
| Data exposure | Only already-suspicious messages | **All private chat** |
| **Catches threats / harassment?** | **No** | **Yes** |
| **Reduces false positives?** | **Yes** — this is its real strength | Yes |

**The trap:** Option A looks obviously better on every line except the last two — and those are the
two reasons to want a classifier at all. Option A cannot see a threat, because no local rule fires on
one. It is a false-positive *reducer*, not a coverage *extender*.

Option A also has a perverse property worth naming: the messages it forwards are, by construction,
the ones that matched a contact-detail or blocked-domain rule — i.e. **the messages most likely to
contain a phone number or an email address.** You would be sending your highest-PII messages
externally and keeping the innocuous ones local.

**Recommendation:** if the classifier is ever enabled, use **Option A first**, framed honestly as a
false-positive reducer, and accept that threats remain covered by the user-report queue. Only move to
Option B if report volume proves that inadequate — and only after §3 is resolved.

---

## §1. Cost and free-tier limits

**Finding:** cost is very likely a non-issue and should **not** be the deciding factor.

| Provider | Cost position | Confidence |
|---|---|---|
| **OpenAI Moderation** (`omni-moderation-latest`) | Historically offered **free of charge** — it is billed differently from completions and does not consume tokens in the usual sense. | **[NEEDS CHECK]** — verify on OpenAI's current pricing page. "It was free" is not evidence that it is free today. |
| **Google Perspective API** | Free for standard use; a quota increase is requested via a form rather than paid for. | **[NEEDS CHECK]** |
| **Self-hosted** (e.g. a toxicity model via ONNX) | No per-call cost; adds a Python service or ONNX runtime to a project that is deliberately a single Node monolith. | **[VERIFIED]** — no such runtime exists here today. |

**Recommendation: treat cost as resolved and stop weighing it.** The original objection to OpenAI in
this project was cost, and that premise appears to be mistaken. But cost being fine does not make
enabling it correct — §3 and §4 are the real questions, and they were never about money.

**One cost that is real and easy to miss:** engineering time. A provider integration is not just the
API call — it is the timeout handling, the fail-open path, a circuit breaker, the observability to
know when it is degraded, and the tests for all of it. Budget that honestly against the benefit.

---

## §2. Rate limits and production capacity

**Finding:** cannot be answered yet, because **Murafiq has no message-volume data.** Anyone who gives
you a capacity number today is guessing.

**[NEEDS CHECK]** Both providers apply per-minute request limits, tier-dependent for OpenAI and
defaulting to roughly one request per second for Perspective with increases available on request.
Confirm current numbers directly.

### The number you actually need

Do not benchmark against a vendor limit. Benchmark against your own peak:

```
peak_messages_per_minute
  = daily_active_conversations
  × messages_per_conversation_per_day
  × peak_concentration_factor      (chat clusters around evenings — assume 3–5×)
  ÷ (60 × 24)
```

Under **Option A** divide the result by ~50. Under **Option B** it is the raw number.

**What can be said from the code today [VERIFIED]:** moderation is invoked from six call sites —
chat messages, booking messages, offer messages, request creation, request edits, and review comments
(`grep scanAndEnforce`). Chat is by far the highest-frequency of these. Requests and offers are
already bounded by plan entitlements (Free 1–5 requests/day, 3–20 offers/day), so **the non-chat call
sites cannot generate meaningful load**. Only chat needs capacity planning.

**Recommendation:**
- **Do not size this now.** Instrument first: log message counts per minute for two weeks, then
  compute. That measurement costs nothing and is worth doing regardless of this decision.
- **Whatever is eventually enabled must fail open** on timeout or 429 — allow the message, record
  `SUSPECT`. A moderation outage or a rate-limit spike must never halt a marketplace's chat. This is
  already the specified behaviour in §I.2 and is non-negotiable.
- **Add a circuit breaker,** not just a timeout. Under a sustained outage, a 2s timeout per message
  means every message is 2s slower; a breaker that trips after N consecutive failures and skips the
  call entirely for a cool-off window turns a degradation into a brief blip.

---

## §3. Data retention, privacy, and residency — **the actual blocker**

### Egypt's PDPL applies to this decision **[LEGAL]**

Egypt's **Personal Data Protection Law (Law No. 151 of 2018)** governs processing of personal data
and **restricts cross-border transfer**, generally requiring both a licence/permit from the competent
authority and a lawful basis for the transfer. Enforcement posture and the state of the executive
regulations have moved over time. **[NEEDS CHECK]**

**This is not something to resolve by reading a vendor's privacy page.** Sending Egyptian users'
private chat to a US processor is a regulated transfer, and the question of whether Murafiq may do it
— and what consent, notice, or licence is required — needs a qualified Egyptian data-protection
lawyer. Engineering cannot sign this off.

**Practical consequence:** this is a weeks-not-hours question. Which is another argument for shipping
v1 on the deterministic pipeline and treating the classifier as a later, deliberate project.

### Vendor-side handling **[NEEDS CHECK — verify all of this in the current DPA]**

Points to confirm in writing before any integration:

1. **Training use.** API data is generally not used to train models by default; confirm this in the
   current terms, in writing.
2. **Retention window.** Providers typically retain request data for a period for abuse monitoring.
   Get the exact number and confirm whether **Zero Data Retention** is available to you.
3. **Processing location.** Confirm which regions process the request. Assume no Egyptian option.
4. **Sub-processors.** Who else touches the payload.
5. **A signed DPA.** Absent one, the transfer has no contractual basis at all.

**Recommendation:** if this proceeds, **make Zero Data Retention a hard precondition, not a
preference.** Without it you are placing private chat between two named individuals into a third
party's logs for a retention window you do not control.

---

## §4. What content would be sent, and how it is handled

### What would leave the platform **[VERIFIED against the code]**

| Call site | Content transmitted |
|---|---|
| `chat.service.js:224` | **The full message body**, verbatim |
| `booking.service.js:371` | Booking-related message text |
| `offer.service.js:67` | The stylist's offer message |
| `request.service.js:61,155` | Request **title + description**, concatenated |
| `review.service.js:62` | Review comment text |

The user's ID is *not* sent — only the text. That is a genuine mitigation, but a weak one: the text
itself routinely identifies people.

### Why this content is unusually sensitive

Murafiq chat is not generic social chatter. It is two named individuals **arranging to meet in
person**, which means it predictably contains:

- **Meeting addresses** — where a specific woman will physically be, at a specific time
- **Phone numbers and emails** — the very thing the contact-detection rules exist to catch
- **Appearance, body, and clothing discussion** — the literal subject matter of a styling service
- **Scheduling** — when someone is out, and by implication when their home is empty

**The sharpest form of the problem:** under Option A, the messages forwarded externally are precisely
those that matched a phone-number or email regex. **The system would export the personal contact
details it was built to keep on-platform.**

### Required handling if enabled

1. **Never send the user ID, booking ID, or any identifier** alongside the text. Text only.
2. **Never log the request body** on your side — a debug log of every classifier call recreates the
   exposure locally and in whatever ships your logs.
3. **Store a hash plus a redacted excerpt, not plaintext** — already the specified design in §I.3.
   The current code stores a 300-character snippet (`moderation.service.js:48`); tighten this before
   any external integration.
4. **Disclose it in the privacy policy** in plain language: that message content is scanned by an
   automated third-party service, and where. Users arranging in-person meetings deserve to know.
   **[LEGAL]**
5. **Consider stripping detected contact details before transmission.** Local regex already found the
   phone number — redact it, then send the remainder. Preserves the classifier's ability to judge
   tone while not exporting the identifier. **This is the single highest-value mitigation available
   and it is cheap.**

---

## Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Cross-border transfer breaches PDPL | Unknown **[LEGAL]** | **Severe** — regulatory, plus trust | Legal sign-off before integration; consider consent capture |
| 2 | Chat retained in a third party's logs | High without ZDR | High | Zero Data Retention as a hard precondition |
| 3 | Exporting the contact details the system exists to protect | **Certain under Option A** | High | Redact local regex matches before transmission |
| 4 | Classifier outage stalls chat | Medium | High | Fail open + circuit breaker (already specified) |
| 5 | Rate limit hit at peak | Unknown — unmeasured | Medium | Instrument first; fail open; request a quota increase |
| 6 | Vendor changes pricing or terms | Medium | Medium | Provider interface already isolates this — swapping is a config change |
| 7 | False sense of coverage | **Medium** | Medium | Option A does **not** catch threats. Do not let enabling it justify de-prioritising the report queue. |

Risk 7 deserves emphasis. The most likely failure of this whole initiative is not technical — it is
enabling a classifier, believing harassment is now handled, and quietly letting the human review
queue rot. The queue is the thing that actually catches harassment today.

---

## Recommendation summary

| Point | Recommendation |
|---|---|
| **1. Cost** | Not a blocker; probably free. **Stop treating cost as the deciding factor** — it never was the real question. Verify current pricing before relying on it. |
| **2. Rate limits** | Unanswerable without data. Instrument chat volume for two weeks. Non-chat call sites are entitlement-bounded and irrelevant to capacity. Fail open + circuit breaker, always. |
| **3. Privacy / residency** | **The real gate.** Egyptian PDPL cross-border transfer needs legal sign-off. Zero Data Retention is a hard precondition, not a nice-to-have. Weeks, not hours. |
| **4. Content handling** | Text only, never identifiers. **Redact locally-detected contact details before transmission** — cheapest, highest-value mitigation. Privacy-policy disclosure required. |
| **Overall** | **Keep `none` for v1.** Revisit after the observe-only window produces a real false-positive rate and real volume numbers. |

## What would change this recommendation

Enabling becomes the right call if, after the observe-only window:

- the deterministic pipeline's **false-positive rate is high enough to damage legitimate
  conversations** (this is what Option A genuinely fixes), **or**
- the **user-report queue shows sustained harassment** that word lists provably miss,

**and** legal has cleared the transfer, **and** Zero Data Retention is contractually in place.

Absent all of those, the deterministic pipeline plus a working report queue is the better
engineering *and* the better risk position.

## Before deciding — verification checklist

- [ ] Current OpenAI Moderation pricing, in writing **[NEEDS CHECK]**
- [ ] Current rate limits for your account tier **[NEEDS CHECK]**
- [ ] Zero Data Retention availability and terms **[NEEDS CHECK]**
- [ ] Signed DPA, with sub-processor list and processing regions **[NEEDS CHECK]**
- [ ] Egyptian counsel's opinion on PDPL cross-border transfer **[LEGAL]**
- [ ] Two weeks of measured chat volume, with peak-minute figures
- [ ] Two weeks of observe-only moderation data, with a measured false-positive rate
- [ ] Privacy-policy update drafted and reviewed **[LEGAL]**
