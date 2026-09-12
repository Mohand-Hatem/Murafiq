# Phase 13 — Security Hardening, Logging, API Docs, Test Coverage

## Goal
This phase doesn't add new business features — it hardens and documents everything built in Phases 0–12 to a genuinely production-ready bar.

> 🔔 **Recommended Skill for this Phase:**
> Install **`security-reviewer`** (from `Jeffallan/claude-skills`) or **`security-pentest-planner`** (from `OneWave-AI`) before starting this phase to run systematic security audits, NoSQL injection tests, mass-assignment checks, and CORS/JWT reviews.

## Depends on
All previous phases functionally complete.

---

## Steps

### 1. Security audit pass
- [ ] Confirm every mutating route (`POST/PATCH/PUT/DELETE`) has both `authMiddleware` and the correct `restrictTo(...)` role check — grep every router file.
- [ ] Confirm every Zod validator rejects unknown/extra fields (`.strict()`) to prevent mass-assignment style payload injection.
- [ ] Confirm `express-mongo-sanitize` is applied globally (Phase 0) and test with a `$where`/`$gt` injection payload.
- [ ] Confirm rate limiting exists on: global baseline, `/auth/*`, `/safety/sos` (prevent spam), `/payments/callback` (webhook abuse).
- [ ] Confirm file upload validation rejects non-image MIME types and oversized files (Phase 9).
- [ ] Confirm refresh tokens are stored hashed, never in plaintext, and rotated on each refresh.
- [ ] Confirm CORS only allows the actual frontend origin(s) in production, not `*`.
- [ ] Confirm secrets (`JWT_*`, `RESEND_API_KEY`, `FIREBASE_PRIVATE_KEY`, `CLOUDINARY_*`) are only in `.env`, never committed — check `.gitignore`.
- [ ] Confirm every `ApiError` thrown for auth/authorization failures follows the error message strategy defined in Phase 1: unauthenticated/credential failures use generic messages (`"Invalid credentials"`) to prevent user enumeration; post-auth failures (unverified, suspended) use specific, safe messages. Verify no route leaks "user not found" vs "wrong password" distinctions.

### 2. Logging pass
- [ ] Winston logs every unhandled error with stack trace to `logs/error.log`.
- [ ] Morgan HTTP logs include response time and status code, streamed into Winston.
- [ ] Sensitive fields (`passwordHash`, `otpCode`, tokens) are never logged, even accidentally via `console.log(user)` — grep for raw object logging of user/auth documents.
- [ ] Add correlation/request IDs (simple middleware assigning a UUID to `req.id`, included in every log line for that request) to make debugging a specific request traceable across async operations.

### 3. API documentation audit (Swagger/OpenAPI)
`swagger-jsdoc` + `swagger-ui-express` are mounted at `/api/docs` from **Phase 0**. Phase 1's routes were backfilled in Round 2 refinements, and every subsequent phase is required to maintain its own `@swagger` blocks per its Definition of Done. This step is strictly a final **audit, gap-fill, and description-tightening pass**, not an initial-build pass:
- [ ] Grep every `*.routes.js` file for a `@swagger` block above each route; fill in any that were missed during their originating phase.
- [ ] Ensure every documented endpoint includes: request body schema, query params, response shape, and auth requirement.
- [ ] Confirm `/api/docs` renders cleanly with no broken refs/schemas.

### 4. Test coverage pass
- [ ] Every module has at least: 1 happy-path integration test per endpoint, 1 authorization-failure test per protected endpoint, 1 validation-failure test per input-validated endpoint.
- [ ] Full end-to-end test: register → verify → complete profile → get verified (admin) → search stylist → create request → offer → accept → pay (mock) → chat message → check-in → mutual confirm → review — one long-running integration test proving the entire business flow works together, not just in isolated units.
- [ ] Run `npm run test -- --coverage` and set a minimum threshold (e.g. 70%+ on `services/` and `repositories/`) in `jest.config.js`.

### 5. Performance/indexing pass
- [ ] Confirm every field used in a common filter/sort has an index: `User.email` (unique), `User.location` (2dsphere), `StylistProfile.userId` (unique), `StylistProfile.location` (2dsphere), `Booking.stylistId+scheduledDate`, `Offer.stylistId+clientId+status`, `Review.{bookingId,direction}` (unique). Chat messages live in Firestore since the Phase 7 migration, not MongoDB — no `Message` model exists to index here; instead confirm Firestore has its own composite index on the `messages` subcollection (`conversationId`, `createdAt`), configured in the Firebase console/`firestore.indexes.json`, not this checklist.
- [ ] Run `explain()` on the stylist search aggregation and the booking-list query to confirm indexes are actually used (`IXSCAN` not `COLLSCAN`).

### 6. Environment/config review
- [ ] `.env.example` fully matches `env.config.js`'s Zod schema — no drift.
- [ ] Separate `.env.production`/staging config strategy documented in `README.md` (values not committed, just the variable list).

---

## Definition of Done

- [ ] Every checklist item above is checked off, not just attempted.
- [ ] `npm audit` shows no high/critical vulnerabilities in dependencies.
- [ ] Swagger UI at `/api/docs` renders and every endpoint is callable/testable from it.
- [ ] Test suite passes fully in CI-like conditions (`NODE_ENV=test npm run test`) with coverage threshold met.
