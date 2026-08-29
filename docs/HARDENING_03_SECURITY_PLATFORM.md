# Hardening 3 — Security & Platform Gaps (P1 + P2)

## Goal

Close the remaining P1 security defects that `HARDENING_01` and `HARDENING_02` didn't cover, plus the
P2 items in the same area. Two of these (uploads, audit trail) are missing modules rather than broken
code — they're here because their absence actively breaks a shipped feature, not because they're new
scope.

## Depends on

`HARDENING_01_CRITICAL.md` complete. Step 1 below (uploads) pairs naturally with
`HARDENING_01` Step 6 (admin seed) — together they're what makes the KYC funnel actually work.

---

## Steps

### 1. Build the uploads module — KYC documents are currently arbitrary client URLs

**The defect.** `01_PROJECT_STRUCTURE.md` §2 lists "File Storage: Cloudinary + Multer — **Active**".
Reality: **neither package is in `package.json`**, `src/modules/uploads/` contains only a `.gitkeep`,
and `src/config/cloudinary.config.js` re-exports three env vars and **is imported by nothing**.

Consequently `PATCH /users/me/verification-documents` accepts a raw client-supplied URL
(`src/modules/users/user.validator.js:28` — `url: z.string().url('Document URL must be a valid URL')`)
and stores it verbatim (`user.service.js:82`). This means:

- **KYC identity documents live on hosts the platform doesn't control** and can be changed or deleted
  by the uploader after approval. There is no immutable record of what an admin actually approved.
- The admin review flow fetches attacker-chosen URLs — an SSRF/phishing surface aimed directly at the
  highest-privilege users in the system.
- A user can submit three links to any images at all; nothing ties the document to the uploader.

**Changes.**

1. `npm install multer cloudinary`.
2. Build `src/modules/uploads/` per `01_PROJECT_STRUCTURE.md` §4: `upload.routes.js`,
   `upload.controller.js`, `upload.service.js`, `multer.middleware.js`. Follow the standard layering.
3. `POST /api/v1/uploads/:folder` — authenticated, folder allow-listed (per `04_ROUTES.md`), MIME-type
   and size restricted (images only; identity documents should be capped well below the global
   `10kb` JSON limit's spirit — note `express.json({ limit: '10kb' })` in `app.js` does **not** apply to
   multipart, so set the limit explicitly in multer).
4. Actually wire `cloudinary.config.js` into the SDK — right now it's a dead object.
5. Change `uploadVerificationDocsSchema` to accept **only an internal upload reference** (a Cloudinary
   `public_id` returned by step 3), never a free-form URL. Resolve it server-side.
6. Store KYC documents in a **private/authenticated** Cloudinary folder with signed delivery URLs, not
   public ones. Identity documents must not be world-readable by anyone who guesses the URL.

> **Why not just validate the URL is a Cloudinary domain?** Because it doesn't prove *this user*
> uploaded it, doesn't prevent pointing at someone else's document, and leaves the platform with no
> immutable copy of what was approved. The upload has to go through the backend.

---

### 2. Rate-limit and lock out OTP verification

**The defect.** `POST /auth/verify-email` (`src/modules/auth/auth.routes.js:24`) and
`POST /auth/reset-password` (`:27`) carry **no rate limiter at all** — compare `:19-21` and `:26`,
where `authRateLimiter` is applied. There is also no per-account attempt counter anywhere in
`authService.verifyEmail` or `authService.resetPassword`.

A 6-digit OTP is 900,000 possibilities with a 10-minute TTL. The only guard is the global
100-req/15-min limiter, which is **per-IP** and (until `HARDENING_01` Step 5) misconfigured behind a
proxy anyway. Distributed IPs make this brute-forceable, and `resetPassword` is a full account
takeover.

**Changes.**

1. Attach `authRateLimiter` to both routes.
2. Add a per-account attempt counter: `otpAttempts` on the user document, incremented on every failed
   comparison in `verifyEmail`/`resetPassword`, reset on success or on new OTP issuance. Invalidate the
   OTP (clear `otpCode`/`otpExpiresAt`) after ~5 failures, forcing a fresh `resend-otp` cycle.
3. Keep the existing generic `'Invalid or expired OTP'` message — it correctly avoids distinguishing
   "wrong code" from "expired code". Don't regress that while adding the counter.

---

### 3. Fail loudly when Firebase isn't configured

**The defect.** `src/config/firebase.config.js:28` catches initialization failure and calls
`logger.warn`, then exports `firestore`/`auth`/`messaging` as `null`. `chat.service.js` detects the
`null` and silently falls back to module-level in-memory `Map`s (`mockConversations`, `mockMessages`
at `:8-9`).

In production this means: a malformed `FIREBASE_PRIVATE_KEY` — which passes the env schema, since
`secret()` only requires a non-empty string — degrades **all chat** to per-process memory. Messages
are lost on every restart, invisible across instances, and the `Map`s grow unbounded (a memory leak).
The only signal is one `warn` line at boot. `03_SKELETON_STATUS.md` §2a meanwhile marks all of this
"✅ Active".

**Changes.**

1. In `firebase.config.js`, throw (fail boot) rather than warn when `NODE_ENV === 'production'` and
   initialization fails or credentials are placeholders. A production process with no chat backend
   should not start.
2. Keep the in-memory fallback for `test` only — gate it on `NODE_ENV === 'test'` explicitly rather
   than on "did Firebase happen to initialize".
3. Add `firebase: 'connected' | 'unavailable'` to the `/api/v1/health` response (see `HARDENING_04`
   Step 5, which also adds the missing Redis check `04_ROUTES.md` already claims exists).

---

### 4. Don't 500 a successful registration when mail fails

**The defect.** `authService.register` (`src/modules/auth/auth.service.js:29`) creates the user at
`:34`, then sends the OTP mail at `:43`. `mailService.sendMail` throws a bare
`new Error('Failed to send email')` (`src/modules/mail/mail.service.js:29`) — not an `ApiError`, so the
central handler returns a **500**.

Net effect when Resend is degraded: the account **exists** in the database, unverified, but the user
sees a server error and reasonably assumes signup failed. Retrying registration hits the unique-email
index → `409 Duplicate value for email`. Their only escape is `resend-otp`, which is capped at 1/60s
and which they have no reason to know about. The account is effectively bricked.

**Changes.**

1. Wrap the `sendMail` call so a mail failure does not fail the request. Return `201` with the
   verification-pending message and log the failure at `error` level.
2. Surface a retry path in the response message ("if you don't receive a code, request a new one").
3. Longer term this belongs on a queue — `03_SKELETON_STATUS.md` §4 already lists "Mail sending via
   queue" as pending Phase 12. Note it as the follow-up; don't build BullMQ here.
4. Make `mailService.sendMail` throw an `ApiError` rather than a bare `Error`, so it can't accidentally
   surface as a 500 from any other caller (`forgotPassword` and `resendOtp` have the same exposure).

---

### 5. Add the audit trail for privileged actions

**The defect.** `src/modules/audit-log/` contains only a `.gitkeep`. `01_PROJECT_STRUCTURE.md` §4
specifies the full module (`audit-log.service.js`, `.repository.js`, `.model.js`, `.listener.js`) and
`04_ROUTES.md` lists `GET /admin/audit-logs`. None of it exists.

This matters concretely, not theoretically:

- **KYC approvals are unlogged.** `userService.approveVerification` writes `verification.reviewedBy`
  and `reviewedAt` onto the user document — which the next approval overwrites. There is no history of
  who approved whom, or of a rejection later reversed.
- **Admins can read any chat conversation with no record.** `chatService.getMessages`
  (`src/modules/chat/chat.service.js:128`) grants access on `userRole === ROLES.ADMIN` alone — no check
  that a dispute exists on that booking, no time limit, no log. `03_SKELETON_STATUS.md` §2a describes
  this as "participant and Admin **dispute** access control"; the dispute part isn't implemented.
- For a platform doing identity verification and handling money, "who did what" is a compliance
  baseline, not a nice-to-have.

**Changes.**

1. Build `src/modules/audit-log/` per the documented structure. Model fields: `actorId`, `actorRole`,
   `action`, `targetType`, `targetId`, `metadata`, `ip`, `createdAt`. Index on `actorId` and
   `{targetType, targetId}`.
2. Use `audit-log.listener.js` subscribing to the event bus, per architecture principle 4 — don't call
   the audit service inline from every controller.
3. Log at minimum: verification approve/reject, account suspend/reactivate, refund, dispute resolution,
   review hide/unhide, and admin chat access.
4. Add `GET /admin/audit-logs` (admin only, `QueryBuilder`-backed) per `04_ROUTES.md`.
5. Gate admin chat access on an open dispute for that booking, and log every access.

---

### 6. Fix session invalidation and multi-device login

**The defect.** Two related issues in `auth.service.js`:

- **`changePassword` (`:221`) does not clear `refreshTokenHash`**, while `resetPassword` (`:217`)
  does. So a user who changes their password because they suspect compromise **does not evict the
  attacker's session** — the attacker's refresh token stays valid for its full 30 days.
- **`issueTokensFor` (`:20-27`) stores a single `refreshTokenHash` per user**, overwriting on every
  login and every refresh. Logging in on a second device silently logs out the first. For a
  client-and-stylist mobile marketplace, single-session-per-account is the wrong default and will read
  as a bug to users.

Also `changePassword:226` calls `bcrypt.compare(currentPassword, user.passwordHash)` without checking
`passwordHash` exists. For a Google-only account (`passwordHash` is legitimately absent — see the
conditional `required` in `user.model.js:16`) bcrypt throws → **500 instead of a clear 400**. `login`
already handles this case correctly at `:99`; `changePassword` doesn't.

**Changes.**

1. Clear `refreshTokenHash` in `changePassword`, matching `resetPassword`.
2. Guard `changePassword` on a missing `passwordHash` with the same 400 message `login:100` uses.
3. Decide on multi-device support and implement accordingly — replacing the single hash with a
   `refreshTokens: [{ tokenHash, deviceId, createdAt, lastUsedAt }]` array is the straightforward
   version, with logout clearing one entry and password change clearing all. **Raise this as a decision
   before implementing**; it changes the user model and the logout contract.

> **Related, don't fix blindly:** `issueTokensFor` runs `bcrypt.hash(refreshToken, 12)` on every login
> *and every 15-minute refresh* — roughly 250ms of CPU per call, which is a real throughput ceiling.
> bcrypt also silently truncates input at 72 bytes, so only the JWT's first 72 characters are actually
> compared. This is **not** a cross-user auth bypass (the JWT signature is verified first, at `:171`),
> but hashing a high-entropy random token with a slow KDF is the wrong tool. SHA-256 is the correct
> primitive for a token that's already random. Fold this into the multi-device change if it happens.

---

### 7. Restrict Swagger in production

**The defect.** `src/app.js:61-62` mounts Swagger UI unconditionally, in every environment, with no
authentication. `04_ROUTES.md` explicitly specifies `GET /docs` as "🔓 (or 🛡️ **in prod**)" — the
production restriction was specified and never implemented. The full API surface, including every
admin route, is published to anyone who finds the deployment URL.

**Changes.**

1. Either skip the Swagger mount when `NODE_ENV === 'production'`, or put it behind
   `authMiddleware + restrictTo(ROLES.ADMIN)`. Pick one and record which in `04_ROUTES.md`.
2. Fix `src/config/swagger.config.js` while there: `servers` hardcodes
   `http://localhost:${env.PORT}` — wrong in every deployed environment. Drive it from an env var.
3. `apis: ['./src/modules/**/*.routes.js', './src/modules/**/*.js']` uses **CWD-relative** globs, so
   Swagger generation silently produces an empty spec if the process is started from any directory
   other than the repo root. Resolve from `import.meta.url` instead. The second glob also re-scans
   every `.js` file in `modules/` on boot, which is wasteful — the first pattern plus `*.swagger.js`
   is what's actually needed.

---

## Definition of Done

- [ ] `multer` and `cloudinary` are installed and `cloudinary.config.js` is actually imported and used.
- [ ] `POST /api/v1/uploads/:folder` accepts an image, rejects a non-image and an oversized file, and returns a reference resolvable server-side.
- [ ] `PATCH /users/me/verification-documents` **rejects** a raw external URL and accepts only an internal upload reference.
- [ ] A KYC document URL is not publicly retrievable without a signed/authenticated request.
- [ ] Six rapid wrong-OTP submissions to `/auth/verify-email` for one account → rate-limited, and the OTP is invalidated; a fresh `resend-otp` is required.
- [ ] Same verified for `/auth/reset-password`.
- [ ] Booting with `NODE_ENV=production` and a placeholder/malformed `FIREBASE_PRIVATE_KEY` fails at startup instead of silently using in-memory chat.
- [ ] `GET /api/v1/health` reports Firebase status (and Redis, per `HARDENING_04` Step 5).
- [ ] With the mail provider forced to fail, `POST /auth/register` returns `201`, the account exists, the failure is logged at `error`, and `resend-otp` recovers it.
- [ ] `audit_logs` documents are written for verification approve/reject, refund, and admin chat access; `GET /admin/audit-logs` returns them paginated.
- [ ] An admin reading a conversation with no open dispute on that booking is refused.
- [ ] After `PATCH /auth/change-password`, a refresh token issued before the change is rejected.
- [ ] `PATCH /auth/change-password` on a Google-only account returns `400` with a clear message, not `500`.
- [ ] Multi-device decision recorded in this file (or `01_PROJECT_STRUCTURE.md`) and implemented, or explicitly deferred with a reason.
- [ ] `GET /api/docs` in a production-mode process is either absent or admin-gated.
- [ ] Swagger spec generates correctly when the process is started from a directory other than the repo root.
- [ ] `npm run lint` and `npm test` exit 0.
