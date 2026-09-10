# Wardrobe Search — Unescaped Regex, No Index

## Status
DEFERRED — NOT FIXED

## Priority
MEDIUM

## Why It Was Deferred
The wardrobe module's genuinely blocking pre-Phase-15 issues — the SSRF in the
classification worker's image fetch and the unenforced `wardrobe.photos.max`
quota — were fixed in the pre-Phase-15 pass, since they sat directly on the
Phase 15 critical path. This search-hardening item is scoped strictly per-user
(the query is always filtered to the caller's own `userId` first), so its blast
radius is limited to degrading the performance of one user's own search request,
not cross-tenant data exposure. It was flagged as Tier 4 hardening in the
original audit.

## Current Problem
`GET /wardrobe/mine?search=...` passes the caller-supplied `search` string
directly into a MongoDB `$regex` with no escaping:

```js
if (search) {
  query.aiDescription = { $regex: search, $options: 'i' };
}
```

Two separate issues:
1. **No escaping.** `search` comes straight from `req.query` via
   `wardrobeQuerySchema` (a plain `z.string()`), and is never passed through the
   project's own `escapeRegex` helper (defined in `QueryBuilder.js` and already
   used at other call sites, e.g. `stylist-search.service.js`). A search string
   containing regex metacharacters is interpreted as a pattern, not literal text.
2. **No index.** `aiDescription` has no text or regex-friendly index, so every
   search (escaped or not) is a full collection scan across that user's wardrobe
   items.

## Evidence
- `src/modules/wardrobe/wardrobe.repository.js` — the `$regex` construction
  (~line 34).
- `src/modules/wardrobe/wardrobe.validator.js` — `wardrobeQuerySchema`'s
  `search: z.string().optional()`, with no length cap or sanitization.
- `src/common/query-builder/QueryBuilder.js` — `escapeRegex`, the helper this
  call site does not use, contrasted with its correct use elsewhere (e.g.
  `stylist-search.service.js`, `request-feed.service.js`).
- `src/modules/wardrobe/wardrobe-item.model.js` — the model's index list has no
  index covering `aiDescription`.

## Risk / Impact
Because the query is always scoped to `{ userId, ...}` first (verified: `GET
/wardrobe/mine` is per-user by construction, matching the multi-tenant
isolation the wardrobe module already gets right elsewhere), a malicious search
string can only degrade performance against the *caller's own* wardrobe — a
free-tier user has at most 250 items (enterprise cap), so the practical
worst-case cost of an unindexed scan or a pathological regex pattern
(catastrophic backtracking, e.g. `(a+)+$`) is bounded by that per-user
collection size, not the whole database. This is a real correctness/robustness
gap worth closing, but it is not a cross-tenant or unbounded-scale risk the way
an unescaped regex against a shared collection would be.

## Expected Future Fix
Route `search` through the project's existing `escapeRegex` helper before
constructing the `$regex` query, matching the pattern already used at other
search call sites. Separately, consider adding a text index on `aiDescription`
(or migrating this specific search to Upstash Vector's semantic search, which
the wardrobe module already uses for embeddings and which `PHASE_15A_DATA_MODEL_RETRIEVAL.md`
identifies as the intended free-text search path once the AI Stylist phases are
built) rather than adding a second, parallel indexing strategy to a field that
may end up superseded by vector search regardless.

## Dependencies
- No phase dependency for the escaping fix (self-contained, one-line change
  using an already-existing helper).
- The indexing/search-strategy question is worth deciding alongside
  `PHASE_15A_DATA_MODEL_RETRIEVAL.md`'s `searchWardrobeSemantic` work (the first
  intended real caller of Upstash's `vectorNs.query()`), since building a
  MongoDB text index now and then replacing the search mechanism during Phase
  15A would be redundant effort.

## When To Fix
The escaping fix: During Final Hardening (pre-production) — it is cheap and
should not wait. The indexing/search-strategy decision: can wait until Phase
15A's wardrobe retrieval work lands, to avoid building two parallel search
mechanisms.

## Verification Plan
- A test asserting a search string containing regex metacharacters (e.g. `(a+)+`)
  is treated as literal text, not a pattern, once escaped.
- A test confirming the escaped search still correctly matches items whose
  `aiDescription` contains the literal search substring.
- If a text index is added: confirm via `explain()` or `getIndexes()` that the
  search query uses it rather than a collection scan.

## Status Checklist
- [ ] Issue fixed
- [ ] Tests added/updated
- [ ] Regression verified
- [ ] Documentation updated
