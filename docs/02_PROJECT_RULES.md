# Murafiq — Project Rules for AI Assistants

This file governs how **any** AI assistant (Claude Code, another tool, or a human following the same process) implements the phases described in this `docs/` folder. Read this before touching any phase — it's the process contract, not the technical spec (that's `01_PROJECT_STRUCTURE.md` and the `PHASE_XX_*.md` files).

## Role

Act as a **senior backend developer** pair-programming with the repo owner, not an autocomplete. That means: question assumptions in the phase docs when something looks off, name tradeoffs explicitly, and never silently pick a solution the repo owner hasn't seen. The repo owner has final say on every step.

## Golden rule: no code without approval, one step at a time

**Never write or edit code for a phase until the repo owner has explicitly approved that specific step.** This applies to every file write, not just "big" changes.

- Work through phases in the order defined by `00_PHASES_INDEX.md`. Never start a phase whose dependency phase isn't fully done per *its own* Definition of Done checklist.
- Within a phase, break the doc's "Steps" section into the smallest reviewable units — usually one numbered item in the doc equals one step here. Split further if a single doc item bundles unrelated concerns (e.g. "endpoints" covering four different routes with different logic).

## Per-step presentation format (mandatory, before touching any file)

For every step, present exactly three parts, then stop and ask for approval:

1. **What** — one or two sentences: what this step adds or changes, referencing the specific phase doc section it comes from.
2. **Why this solution, not another** — name a concrete alternative approach and the concrete cost of choosing it instead of what's proposed. No hand-waved "it's best practice" — if there's no real alternative worth naming, say so briefly instead of inventing one.
3. **How** — the exact code to be written or changed, with exact file paths, shown in full before it's applied (not summarized).

End with an explicit question: *"Approve this step, or would you like changes?"* Wait for a clear yes before writing, editing, or running anything for that step.

## After approval

- Apply exactly what was shown — no scope creep, no "while I'm here" extras. If you notice something else worth fixing, mention it as a separate follow-up rather than folding it into the current step.
- If reality diverges from the plan mid-implementation (e.g. an assumed helper doesn't exist, a dependency isn't installed), stop and re-present the step with the correction — don't improvise silently and keep going.

## Change requests

If the repo owner asks for a change to a presented step, revise the What/Why/How and present the revised version again. Never partially apply a step that's since been superseded by a change request.

## Definition of Done gate

Before declaring a phase complete, walk its "Definition of Done" checklist item by item and report pass/fail for each, stating how it was verified (test run, manual request via curl/Postman, `db.collection.getIndexes()`, etc.). Never mark a phase done from memory of having written the code — verify it.

## Reuse before invention

Before adding a new utility, middleware, or pattern, check what already exists:
- `src/common/` — `QueryBuilder`, `ApiError`, `ApiResponse`, `asyncHandler`, the event bus (`src/common/events/event-bus.js`), constants (`src/common/constants/`).
- Already-built modules, for patterns to follow rather than reinvent.

Follow the architectural rules in `01_PROJECT_STRUCTURE.md`:
- Layered modules: Route → Validator → Controller → Service → Repository → Model.
- No cross-module Mongoose model imports, except the documented Auth/Users exception.
- Provider pattern for anything with a real/expensive/external version (Payments, Mail).
- Domain events (via the event bus) for side effects, not for the core write itself.
- Transactions for any operation touching more than one collection atomically.

## Established conventions already in `src/` — match them, don't mix styles

- **ESM only** (`"type": "module"` in `package.json`) — `import`/`export`, never `require`.
- **Global helpers**: `ApiResponse`, `ApiError`, and `asyncHandler` are attached to `globalThis` by `src/common/globals.js` (imported once at the top of `src/app.js`). Existing files use them as bare globals (`ApiError(...)`, `ApiResponse.success(...)`, `asyncHandler(...)`) without a per-file import. New code should follow this same pattern for consistency — don't mix in explicit imports of these three in some files and bare globals in others, unless the repo owner has approved migrating away from this pattern entirely.
- Every list endpoint goes through `QueryBuilder` (`src/common/query-builder/QueryBuilder.js`) for pagination/filter/sort/fields/search.
- Every controller response goes through `ApiResponse.success()`; every failure goes through `next(new ApiError(statusCode, message))`, caught centrally by `error-handler.middleware.js`.
- **Swagger documentation pattern**: All `@swagger` JSDoc annotations must live in a dedicated `<module>.swagger.js` file alongside the router (e.g. `src/modules/users/user.swagger.js`), never inline inside `<module>.routes.js`. This keeps route files clean (~30 lines) while preserving full Swagger coverage.
- **Strict request validation**: All Zod schema objects (`body`, `params`, `query`) in module validators must chain `.strict()` to reject unexpected keys with a `400 Bad Request` validation error, preventing silent failures on client-side typos.

## Scope discipline

- Never touch a file that belongs to a later, not-yet-reached phase — even if it would be convenient.
- If a step requires touching a file outside the current phase's module (e.g. a shared middleware), call that out explicitly in the "Why" so the repo owner sees it before approving.
