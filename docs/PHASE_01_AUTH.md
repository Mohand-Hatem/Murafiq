# Phase 1 — Authentication

## Goal
Register, login, logout, refresh token, email verification via OTP, resend OTP, forgot/reset password, change password. JWT access + refresh tokens delivered as HTTP-only cookies for the web client, or in the JSON response body for the native mobile client (dual delivery — see step 5). This phase creates the **base `User` model** (full profile fields come in Phase 2, but the model must exist here since auth needs it).

## Depends on
Phase 0 (config, ApiResponse, ApiError, catchAsync, event bus).

---

## Steps

### 1. Base `User` model (`src/modules/users/user.model.js`)
Create now with the fields auth needs; Phase 2 extends it with profile fields.
```js
// Role → default Arabic display name mapping
const ROLE_AR_DEFAULTS = {
  client:   'مستخدم',
  stylist:  'مصمم',
const userSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, unique: true, required: true, lowercase: true },
  phone: { type: String, unique: true, sparse: true }, // Optional at registration, updated via profile
  passwordHash: { type: String, required: function () { return !this.googleId; }, select: false }, // not required for a Google-only account
  googleId: { type: String, unique: true, sparse: true }, // set on Google sign-up, or attached later if a Google sign-in auto-links to an existing local account — see step 11
  role: { type: String, enum: ['client', 'stylist', 'admin', 'operator'], default: 'client' },
  // 'operator' accounts are admin/seed-created only — never via /auth/register or /auth/google
  // (same restriction as 'admin'). Self-registration is limited to 'client'/'stylist' only.
  isEmailVerified: { type: Boolean, default: false },
  otpCode: { type: String, select: false },
  otpExpiresAt: { type: Date, select: false },
  refreshTokenHash: { type: String, select: false },
  accountStatus: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active' },
  isDeleted: { type: Boolean, default: false },
  deletedAt: Date, // set alongside isDeleted at soft-delete time (Phase 2 §6) — lets admin tooling see when/that an account was removed
}, { timestamps: true });
```

> **Single role per account (dual-role not supported):** `role` is one fixed value, set at registration. Unlike Mostaql (where one account can act as both requester and provider), Murafiq does not support converting or adding a second role to an existing account in this version — a user who wants to be both a client and a stylist needs two separate accounts (two emails). This is a deliberate scope decision, not an oversight; revisit as a future enhancement (e.g. an `additionalRoles` array + a role-switcher in the client) if real demand shows up.

> **Name Rules:**
> - `name` — required at registration. This is the canonical display name in the API.
> - `phone` — optional at registration, can be added or updated via `PATCH /users/profile`.
> - The Zod registration schema (`auth.validator.js`) requires `name`, `email`, `password`, `confirmpassword`, and optional `role`.
> - `confirmpassword` must match `password`.

### 2. Password hashing
`bcrypt.hash(password, 12)` on register/reset/change. Never store plain text. Compare with `bcrypt.compare`.

### 3. OTP generation & storage
`common/utils/generateOtp.js` → 6-digit numeric code. Store `otpCode` (hashed, same as password) + `otpExpiresAt` (now + 10 min) on the user document. **Do not** use Redis for OTP storage yet unless Phase 12's Redis setup is already done — storing on the user doc is acceptable and simpler for now; migrate to Redis-backed OTP later if needed (note this as a possible future optimization, not a blocker).

### 4. Auth endpoints (`auth.controller.js` / `auth.service.js`)

| Action | Logic |
|---|---|
| Register | validate → hash password → create user (unverified) → generate OTP → queue OTP email → return user (no tokens yet, must verify first) |
| Verify Email | check OTP + expiry → set `isEmailVerified: true` → clear OTP fields |
| Resend OTP | rate-limited (e.g. 1 per 60s) → regenerate OTP → queue email |
| Login | find by email → check `accountStatus`, `isEmailVerified` → compare password → issue access + refresh tokens (delivered per client type — see step 5). If the account has no `passwordHash` (Google-only), fail with a clear "use Google Sign-In" message instead of crashing on the compare. |
| Google Sign-In | verify Google ID token → find by `googleId`, else by `email` (auto-link), else create a new verified account → issue access + refresh tokens the same way as Login — see step 11 |
| Logout | clear refresh token cookie (web) / no-op on client storage (mobile) + always clear `refreshTokenHash` in DB |
| Refresh Token | validate refresh token (from cookie or body/header, per client type) against `refreshTokenHash` → issue new access token (rotate refresh token too) |
| Forgot Password | generate OTP (6-digit) → store hashed + `otpExpiresAt` on user doc → queue email with the OTP code |
| Reset Password | validate token → hash new password → invalidate all existing refresh tokens |
| Change Password | requires current password match → hash new password |

### 5. Token generation & dual-mode delivery (`common/utils/generateTokens.js`)
```js
const generateAccessToken = (userId, role) =>
  jwt.sign({ sub: userId, role }, env.JWT_ACCESS_SECRET, { expiresIn: '15m' });

const generateRefreshToken = (userId) =>
  jwt.sign({ sub: userId }, env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
```

**Delivery depends on the calling client** — a native mobile app is planned alongside the web frontend, and cookies don't work well for native clients. Every endpoint that issues tokens (`login`, `refresh`) branches on a client hint header, e.g. `X-Client-Type: web | mobile` (default `web` if absent):

| Client type | Delivery |
|---|---|
| `web` (default) | Set both tokens as `httpOnly, secure (in prod), sameSite: 'strict'` cookies. Response body does **not** include the raw tokens. |
| `mobile` | Do **not** set cookies. Return `{ accessToken, refreshToken }` in the JSON response body; the mobile client stores them itself (e.g. secure device storage) and sends the access token back as `Authorization: Bearer <token>`. |

Store a **hash** of the refresh token in the DB (never the raw token) regardless of delivery mode, so a DB leak doesn't expose usable tokens. `POST /auth/refresh` mirrors the same branching — reads the refresh token from either the cookie or the request body/header depending on client type, and re-issues via the same rule.

### 6. Auth middleware (`common/middlewares/auth.middleware.js`)
Reads the access token from **either** the cookie **or** an `Authorization: Bearer` header (check cookie first, fall back to header — supports both web and mobile with one middleware), verifies it, attaches `req.user = { id, role }`. Throws `ApiError(401, ...)` on failure.

### 7. RBAC middleware (`common/middlewares/rbac.middleware.js`)
```js
const restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) return next(new ApiError(403, 'Forbidden'));
  next();
};
```

### 8. Validators (Zod, `auth.validator.js`)
Schemas for each endpoint's body (register, login, verifyOtp, resetPassword, changePassword, google). Wired through `validate.middleware.js` from Phase 0. Genuinely reused field atoms (`emailField`, `passwordField`, `otpField`) live in `common/validators/shared.validator.js` and get imported here rather than redefined — each module still owns its actual request schemas, only the shared primitives are centralized.

### 9. Rate limiting on sensitive routes
Stricter limiter (e.g. 5 requests / 15 min) specifically on `/login`, `/register`, `/forgot-password`, `/resend-otp` to prevent brute force / OTP spam — separate from the global rate limiter.

### 10. Mail dependency (temporary, minimal)
Auth needs to *send* an OTP email. Phase 9 builds the full `mail` module with templates and providers. For this phase, create a **minimal** `mail.service.js` with a single `sendMail({ to, subject, html })` function using [Resend](https://resend.com) directly (`env.RESEND_API_KEY`, no provider abstraction yet — that gets added in Phase 9 without changing this call signature).

### 11. Google Sign-In (`POST /auth/google`)
No Passport.js, no Express sessions, no server-driven redirect — this backend is fully stateless (JWT in cookie or Bearer), and Passport's session/redirect model doesn't map cleanly onto a client serving both a web SPA and a native mobile app. Instead:

- **Client-side** (outside this repo): the web frontend uses Google Identity Services (GIS) JS, the mobile app uses the native Google Sign-In SDK. Either way, the *client* performs the Google interaction and ends up holding a signed Google **ID token** — the backend never sees a redirect or an authorization code.
- **Backend**: `POST /auth/google` with `{ idToken, role? }` in the body.
  1. Verify the token server-side with [`google-auth-library`](https://www.npmjs.com/package/google-auth-library) (`new OAuth2Client(env.GOOGLE_CLIENT_ID).verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID })`). No client secret needed — verifying an already-issued ID token isn't an authorization-code exchange. Reject (`401`) on a bad/expired token or if the payload's `email_verified` is false.
  2. Look up by `googleId` (returning Google user) → issue tokens.
  3. Else look up by `email`. If a local password account already exists with that email → **auto-link**: attach `googleId` to it, set `isEmailVerified: true` (Google's verification supersedes any pending local OTP step), then issue tokens. Safe because Google only returns emails it has itself verified.
  4. Else → create a new `User` (`nameEn` from Google's `name` claim, `email`, `googleId`, `role` defaulting to `client` same as normal register, `isEmailVerified: true`, no `passwordHash`) and issue tokens. No OTP step for this path — Google already verified the email.
  5. Also re-check `accountStatus !== 'suspended'` for existing accounts, exactly like password login — Google Sign-In must not be a way to bypass a suspension.
  6. Token issuance and dual-mode (cookie/Bearer) delivery reuse the exact same path as password login — no parallel logic.
- Env: `GOOGLE_CLIENT_ID` (added to `env.config.js`'s schema, same dev-default-then-required-in-prod pattern as every other credential).

---

## Definition of Done

- [ ] Register → OTP email received → verify → login succeeds only after verification.
- [ ] Login with `X-Client-Type: web` (or no header) sets both access and refresh cookies and does not leak tokens in the response body; protected route works with the cookie access token.
- [ ] Login with `X-Client-Type: mobile` returns `{ accessToken, refreshToken }` in the response body and does not set cookies; protected route works with `Authorization: Bearer <accessToken>`.
- [ ] `authMiddleware` accepts either source (cookie or Bearer header) transparently.
- [ ] Access token expires (test with short TTL) → refresh endpoint issues a new one, honoring the same client-type branching.
- [ ] Logout clears cookies and invalidates the stored refresh token hash.
- [ ] Forgot/reset password flow uses OTP (same mechanism as email verification); old refresh tokens stop working after reset.
- [ ] Password reset OTP is hashed in the DB identically to the email verification OTP — never stored as plaintext.
- [ ] **Error message strategy** (no user enumeration on login):
  - Wrong password or email not found → `401 "Invalid credentials"` (same generic message — do not reveal which was wrong).
  - Unverified email → `403 "Account not verified. Please check your email."` (safe to be specific).
  - Suspended account → `403 "Account suspended. Contact support."` (safe to be specific).
- [ ] Rate limiter blocks after N attempts on `/login`.
- [ ] `restrictTo('admin')` correctly blocks a client/stylist token on an admin-only test route.
- [ ] `nameEn` is required at registration; omitting it returns a validation error.
- [ ] `nameAr` defaults correctly to `مستخدم` / `مصمم` / `ادمن` based on role when not provided at registration.
- [ ] User can supply a custom `nameAr` at registration and it is stored as-is (not overwritten by the default).
- [ ] Unit tests for `auth.service.js` covering register/login/OTP/reset happy paths + at least 3 failure paths.
- [ ] `POST /auth/google` with a valid token creates a new verified account on first sign-in, logs an existing Google user straight in on repeat sign-in, and auto-links + verifies an existing local-password account that shares the same email.
- [ ] A suspended account cannot bypass suspension via `POST /auth/google`.
- [ ] Password login on a Google-only account (`passwordHash` unset) fails with a clear message, not a crash.
- [ ] An invalid/expired Google ID token returns `401`, not a 500.
