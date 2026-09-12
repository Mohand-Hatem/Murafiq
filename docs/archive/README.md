# Archive — historical records

Everything under `docs/archive/` is **preserved history, not current guidance.**

These documents describe what was decided, built or found **at the time they were written**.
They are kept because the project's development history has real value: they explain *why* the
system looks the way it does. They are not maintained, and they are not authoritative about how
the system behaves today.

**If an archived document disagrees with an active document, the active document is correct.**

| Looking for | Read this instead |
|---|---|
| What is built today | [`../STATUS.md`](../STATUS.md) |
| Current business rules | [`../BUSINESS_RULES.md`](../BUSINESS_RULES.md) |
| Current architecture | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) |
| Open technical debt | [`../next-phase/BACKLOG.md`](../next-phase/BACKLOG.md) |
| The active phase | [`../PHASES_INDEX.md`](../PHASES_INDEX.md) |

## Contents

| Directory | What it holds |
|---|---|
| `phases/` | Build records for Phases 0–14, preserved individually, one file per phase |
| `audits/` | `AUDIT_2026_09_FULL_SYSTEM` and the post-simplification audit. **All findings are closed.** Frequently cited by finding ID (X1, X9, X17…) from code comments — those citations point here deliberately |
| `remediation/` | The completed remediation programme |
| `simplification/` | The S0–S7 assessment, implementation plan and test baseline. **Executed in full.** |
| `hardening/` | The `HARDENING_00–08` series plus per-issue analyses. Their status labels are stale by design — `next-phase/BACKLOG.md` holds real current status |
| `design/` | Design records for features that have since shipped. The rules they proposed now live in `BUSINESS_RULES.md` |
| `handoffs/` | Historical handoff documents |
| `reviews/` | Point-in-time code reviews, dated in the filename |
