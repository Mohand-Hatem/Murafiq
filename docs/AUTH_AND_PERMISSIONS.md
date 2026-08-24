# Murafiq — Authentication & Permissions Reference

This document outlines the authentication mechanisms, token lifecycles, session security, and the Role-Based Access Control (RBAC) matrix for Murafiq.

---

## 1. Platform Roles

1. **`client`** — Standard consumer who creates requests, accepts offers, pays for bookings, and rates stylists.
2. **`stylist`** — Service provider who completes onboarding, sends offers, attends sessions, and receives payout earnings.
3. **`operator`** — Limited operational agent with access **strictly restricted to identity verification reviews** (`GET /api/v1/admin/verifications`, `PATCH /api/v1/admin/verifications/:userId/approve`, `PATCH /api/v1/admin/verifications/:userId/reject`).
4. **`admin`** — Full platform superuser with access to dispute arbitration, payout disbursements, review moderation, user account suspensions, and audit logs.

---

## 2. Token Architecture & Lifecycle

### Dual Token Scheme (Access + Refresh)
- **Access Token:** Short-lived JWT (15 minutes). Sent via `Authorization: Bearer <token>` (mobile/API clients) or verified from `req.cookies.accessToken` (web).
- **Refresh Token:** Long-lived JWT (30 days). Stored in `httpOnly`, `SameSite: Strict`, `Secure` cookie, or passed in JSON request body during `/auth/refresh-token`.

### Token Payload
```json
{
  "id": "60f719b8f1a2c81234567890",
  "role": "stylist",
  "iat": 1724500000,
  "exp": 1724500900
}
```

### Refresh Token Rotation & Session Revocation
1. When `/auth/refresh-token` is invoked, a new access token is generated.
2. **Session Invalidation on Password Change:** Changing a user's password updates `User.passwordChangedAt`. `auth.middleware.js` inspects `jwtPayload.iat < user.passwordChangedAt` and immediately rejects tokens minted prior to the password reset with `401 Unauthorized`.
3. **Logout:** Clears auth cookies and invalidates client session state.

---

## 3. Account Verification & Brute-Force Protection

- **Hashed OTP:** 6-digit verification codes are hashed using SHA-256 before storage in MongoDB.
- **Lockout Protection:** `otp.attempts` is incremented on every failed submission. If 5 incorrect attempts occur, the account is temporarily locked out for 15 minutes.
- **Identity Verification Tiers:**
  - `unverified`: Default upon registration. Daily client request limit is 2/day.
  - `pending`: KYC documents uploaded, awaiting admin/operator review.
  - `verified`: Identity approved. Daily client request limit unlocks to 5/day. Stylist can send offers and receive bookings.
  - `rejected`: Identity rejected with mandatory administrative reason.

---

## 4. Route × Role Access Matrix

| Route Group | Path Prefix | Public (🔓) | Client (👤) | Stylist (💇) | Operator (🔍) | Admin (🛡️) |
|---|---|---|---|---|---|---|
| **Auth** | `/auth/*` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Users Profile** | `/users/me` | ❌ | ✅ | ✅ | ✅ | ✅ |
| **Stylist Search** | `GET /stylists` | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Stylist Onboarding** | `POST/PATCH /stylists/profile` | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Stylist Payout Account** | `/payouts/account` | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Stylist Payouts List** | `GET /payouts/mine` | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Client Requests** | `/requests` | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Stylist Offers** | `/offers` | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Bookings Actions** | `/bookings/*` | ❌ | ✅ | ✅ | ❌ | ✅ (view) |
| **Dispute Filing** | `POST /bookings/:id/dispute` | ❌ | ✅ | ✅ | ❌ | ✅ |
| **Chat & Custom Token** | `/chat/*` | ❌ | ✅ | ✅ | ❌ | ✅ |
| **Notifications** | `/notifications/*` | ❌ | ✅ | ✅ | ✅ | ✅ |
| **KYC Verification Queue** | `/admin/verifications/*` | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Dispute Arbitration** | `PATCH /admin/bookings/:id/resolve-dispute` | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Payout Batches & Status** | `/payouts/admin/*` | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Review Moderation** | `PATCH /admin/reviews/:id/hide` | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Audit Logs Query** | `GET /admin/audit-logs` | ❌ | ❌ | ❌ | ❌ | ✅ |
| **API Documentation** | `GET /docs` | ✅ (dev) / 🛡️ (prod) | ✅ (dev) | ✅ (dev) | ✅ (dev) | ✅ |
