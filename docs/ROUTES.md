# Murafiq — Full API Routes Reference

> **API Base URL:** All primary V1 routes are versioned and mounted under `/api/v1`.  
> **Interactive Swagger UI:** Available at `/api/docs` (default) and `/api/v1/docs`.  
> **Demo Trial Base URL:** Available at `/api/demo` (interactive docs at `/api/demo/docs`).  
>
> **Auth Badges:**
> - 🔓 Public (unauthenticated)
> - 🔐 Authenticated (any valid role: client, stylist, admin, operator)
> - 👤 Client only (`restrictTo('client')`)
> - 💇 Stylist only (`restrictTo('stylist')`)
> - 🛡️ Admin only (`restrictTo('admin')`)
> - 🔍 Admin + Operator (`restrictTo('admin', 'operator')`)
>
> **Status:**
> - ✅ Built (Active in codebase, tested, and validated via OpenAPI)
> - 🔲 Planned (Documented roadmap feature for upcoming phase)

---

## 1. Auth (`/auth`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| POST | `/auth/register` | 🔓 | ✅ Built | Register new client or stylist |
| POST | `/auth/login` | 🔓 | ✅ Built | Login, sets access + refresh tokens |
| POST | `/auth/google` | 🔓 | ✅ Built | Google Sign-In via verified server-side ID token |
| POST | `/auth/logout` | 🔐 | ✅ Built | Invalidate refresh token and active session |
| POST | `/auth/logout-all` | 🔐 | ✅ Built | Invalidate all active sessions for current user |
| GET | `/auth/sessions` | 🔐 | ✅ Built | List active sessions and device logins for current user |
| POST | `/auth/refresh-token` | 🔓 (cookie/body) | ✅ Built | Issue new access token with cryptographic refresh rotation |
| POST | `/auth/verify-email` | 🔓 | ✅ Built | Verify email address via 6-digit OTP |
| POST | `/auth/resend-otp` | 🔓 | ✅ Built | Resend verification OTP (rate-limited) |
| POST | `/auth/forgot-password` | 🔓 | ✅ Built | Request password reset OTP |
| POST | `/auth/reset-password` | 🔓 | ✅ Built | Reset password using OTP code |
| PATCH | `/auth/change-password` | 🔐 | ✅ Built | Change password & invalidate all other sessions |

---

## 2. Users (`/users`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/users/me` | 🔐 | ✅ Built | Current user's full profile and verification status |
| PATCH | `/users/me` | 🔐 | ✅ Built | Update profile fields (name, phone, gender, profileImage, location coordinates) |
| PATCH | `/users/me/verification-documents` | 🔐 | ✅ Built | Upload national ID front/back + selfie-with-ID (KYC) |
| PATCH | `/users/me/profile-image` | 🔐 | ✅ Built | Upload or replace user profile photo |
| DELETE | `/users/me` | 🔐 | ✅ Built | Soft delete own account (email and phone stay reserved) |
| GET | `/users/:id` | 🔐 | ✅ Built | Get public profile for a user (Client or Stylist, zero PII leakage) |

---

## 3. Locations (`/locations`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/locations/governorates` | 🔓 | ✅ Built | List all supported Egyptian governorates |
| GET | `/locations/governorates/:governorate/cities` | 🔓 | ✅ Built | List supported cities within a governorate |

---

## 4. Stylists (`/stylists`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/stylists` | 🔓 | ✅ Built | Search stylists (filters: gender, specialty, rating, pagination, sort, $geoNear) |
| GET | `/stylists/me/profile` | 💇 | ✅ Built | Current stylist's business profile |
| GET | `/stylists/me/payouts` | 💇 | ✅ Built | Current stylist's payout history and summary |
| GET | `/stylists/:id` | 🔓 | ✅ Built | Public stylist profile with ratings and portfolio |
| GET | `/stylists/:id/reviews` | 🔓 | ✅ Built | Public reviews written for a stylist |
| GET | `/stylists/:id/reliability` | 🔓 | ✅ Built | Public stylist reliability metrics and score |
| POST | `/stylists/profile` | 💇 | ✅ Built | Complete stylist onboarding business profile |
| PATCH | `/stylists/profile` | 💇 | ✅ Built | Update stylist profile (rates, specialties, bio, weekly availability) |

---

## 5. Requests (`/requests`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| POST | `/requests` | 👤 | ✅ Built | Create a direct (1:1) or open broadcast request |
| GET | `/requests/mine` | 👤 | ✅ Built | Client's own submitted requests |
| PATCH | `/requests/:id` | 👤 | ✅ Built | Edit an open request (while 0 offers exist) |
| PATCH | `/requests/:id/reactivate` | 👤 | ✅ Built | Reactivate paused request (Client owner, max 3 times) |
| PATCH | `/requests/:id/close` | 👤 | ✅ Built | Permanently close an open request |
| PATCH | `/requests/:id/cancel` | 👤 | ✅ Built | Cancel a pending request |
| GET | `/requests/feed` | 💇 | ✅ Built | Stylist open broadcast request feed with geo/area filters |
| GET | `/requests/incoming` | 💇 | ✅ Built | Incoming direct requests targeted at this stylist |
| PATCH | `/requests/:id/decline` | 💇 | ✅ Built | Stylist declines a targeted direct request |

---

## 6. Offers (`/offers`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| POST | `/offers/requests/:id` | 💇 | ✅ Built | Stylist sends an offer on a request (daily & active capped) |
| PATCH | `/offers/:id/withdraw` | 💇 | ✅ Built | Stylist withdraws a pending offer |
| GET | `/offers/requests/:id` | 👤 | ✅ Built | Client's own request: full offer comparison (cheapest first) |
| PATCH | `/offers/:id/accept` | 👤 | ✅ Built | Accept offer → atomic booking transaction & sibling offer rejection |
| PATCH | `/offers/:id/reject` | 👤 | ✅ Built | Reject an offer |

---

## 7. Bookings (`/bookings`)

> **Client vs. Stylist Segregation:** `GET /bookings/mine` is strictly Client-only (`restrictTo('client')`). Stylists must query `GET /bookings/stylist` (`restrictTo('stylist')`).

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/bookings/mine` | 👤 | ✅ Built | Client's own bookings (Client role only) |
| GET | `/bookings/stylist` | 💇 | ✅ Built | Stylist's own bookings (Stylist role only) |
| GET | `/bookings/:id` | 🔐 | ✅ Built | Booking detail (participant or admin) |
| GET | `/bookings/:id/cancellation-quote` | 🔐 | ✅ Built | Preview cancellation refund, fee, and penalty quote |
| GET | `/bookings/:id/dispute` | 🔐 | ✅ Built | Get dispute arbitration details for a booking |
| PATCH | `/bookings/:id/check-in` | 🔐 | ✅ Built | Mark arrival at session location (temporal window & payment verified) |
| PATCH | `/bookings/:id/confirm-completion` | 🔐 | ✅ Built | Mutual completion confirmation (both client and stylist confirm) |
| POST | `/bookings/:id/dispute` | 🔐 | ✅ Built | File a dispute (within 48h of completion) with optional evidence |
| POST | `/bookings/:id/dispute/evidence` | 🔐 | ✅ Built | Attach notes or photo evidence to open dispute |
| PATCH | `/bookings/:id/cancel` | 🔐 | ✅ Built | Cancel booking (timing-tiered 4-branch refund policy) |
| POST | `/bookings/:id/no-show` | 🔐 | ✅ Built | File a no-show dispute against counterparty |
| POST | `/bookings/:id/no-show/respond` | 🔐 | ✅ Built | Accused party responds to filed no-show report |
| POST | `/bookings/:bookingId/review` | 🔐 | ✅ Built | Submit two-way session review (Client → Stylist or Stylist → Client) |
| GET | `/bookings/:bookingId/reviews` | 🔐 | ✅ Built | Reviews written for a booking (both directions) |

---

## 8. Payments (`/payments`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| POST | `/payments/callback` | 🔓 (webhook) | ✅ Built | Paymob gateway HMAC-verified callback webhook |
| POST | `/payments/:bookingId/initialize` | 👤 | ✅ Built | Initialize payment session (optional couponCode supported) |
| GET | `/payments/:bookingId/status` | 🔐 | ✅ Built | Get payment status and platform fee breakdown |
| GET | `/payments/history` | 👤 | ✅ Built | Client's historical payments |
| POST | `/payments/:bookingId/refund` | 🛡️ | ✅ Built | Admin trigger manual refund on booking |

---

## 9. Payouts (`/payouts`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/payouts/account` | 💇 | ✅ Built | Get stylist payout bank/wallet credentials |
| PATCH | `/payouts/account` | 💇 | ✅ Built | Update stylist payout bank/wallet credentials |
| GET | `/payouts/mine` | 💇 | ✅ Built | Stylist's own historical payout disbursements |
| GET | `/payouts/admin/pending-balances` | 🛡️ | ✅ Built | Summary of eligible unpaid balances per stylist |
| GET | `/payouts/admin` | 🛡️ | ✅ Built | Admin list all payouts with status filtering |
| POST | `/payouts/admin/batch` | 🛡️ | ✅ Built | Generate batch payout disbursements |
| PATCH | `/payouts/admin/:id/mark-processing` | 🛡️ | ✅ Built | Move payout status to processing |
| PATCH | `/payouts/admin/:id/mark-paid` | 🛡️ | ✅ Built | Mark payout as paid with transfer reference |
| PATCH | `/payouts/admin/:id/mark-failed` | 🛡️ | ✅ Built | Mark payout as failed and revert booking locks |

---

## 10. Coupons (`/coupons`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/coupons/mine` | 👤 | ✅ Built | Client's available promotional coupon discounts |
| POST | `/coupons/validate` | 👤 | ✅ Built | Validate coupon code and discount against booking quote |
| POST | `/coupons` | 🛡️ | ✅ Built | Admin create promotional coupon with discount rules |

---

## 11. Chat (`/chat`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| POST | `/chat/token` | 🔐 | ✅ Built | Mint Firebase custom token with claims for client SDK auth |
| GET | `/chat/:conversationId/messages` | 🔐 | ✅ Built | Paginated message history from Firestore |
| POST | `/chat/:conversationId/messages` | 🔐 | ✅ Built | REST send message fallback |
| POST | `/chat/:conversationId/report` | 🔐 | ✅ Built | Report offensive or rule-breaking chat message |

---

## 12. Notifications (`/notifications`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/notifications` | 🔐 | ✅ Built | Paginated notification feed |
| GET | `/notifications/unread-count` | 🔐 | ✅ Built | Get unread notification count |
| PATCH | `/notifications/read-all` | 🔐 | ✅ Built | Mark all notifications as read |
| PATCH | `/notifications/:id/read` | 🔐 | ✅ Built | Mark a single notification as read |
| POST | `/notifications/device-token` | 🔐 | ✅ Built | Register FCM device push token |
| DELETE | `/notifications/device-token` | 🔐 | ✅ Built | Unregister FCM device push token |

---

## 13. Reviews (`/reviews`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/reviews/mine` | 🔐 | ✅ Built | Caller's submitted and received reviews |
| GET | `/reviews/booking/:bookingId` | 🔐 | ✅ Built | Get review details for a completed booking |
| GET | `/reviews/stylist/:id` | 🔓 | ✅ Built | Public reviews for a stylist |
| GET | `/reviews/client/:id` | 🔓 | ✅ Built | Public reviews for a client |

---

## 14. Uploads (`/uploads`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| POST | `/uploads/:folder` | 🔐 | ✅ Built | Upload image to Cloudinary (folder allowlisted & role-authorized; in-memory Sharp compression) |

---

## 15. Subscriptions (`/subscriptions`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/subscriptions/plans` | 🔓 | ✅ Built | List available subscription plans with pricing & entitlements |
| POST | `/subscriptions/webhook` | 🔓 (webhook) | ✅ Built | Paymob HMAC-verified webhook for subscription activation |
| GET | `/subscriptions/me` | 🔐 | ✅ Built | Current user's subscription, period dates, and usage |
| GET | `/subscriptions/me/entitlements` | 🔐 | ✅ Built | Current user's active feature and quota entitlements |
| POST | `/subscriptions/checkout` | 🔐 | ✅ Built | Initiate Paymob checkout intention for paid plan |
| POST | `/subscriptions/subscribe` | 🔐 | ✅ Built | Free-plan switch or scheduled downgrade (402 on paid plans) |
| POST | `/subscriptions/cancel` | 🔐 | ✅ Built | Schedule cancellation of paid plan at period end |
| GET | `/subscriptions/orders/:orderId` | 🔐 | ✅ Built | Query order payment status (pending, paid, failed) |

---

## 16. Wardrobe (`/wardrobe`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| POST | `/wardrobe` | 👤 | ✅ Built | Add closet photo with `{ uploadRef }` and async AI classification & embedding |
| POST | `/wardrobe/from-chat` | 👤 | ✅ Built | Save outfit or garment directly from AI stylist conversation |
| GET | `/wardrobe/mine` | 👤 | ✅ Built | Client's wardrobe catalog with filters (`category`, `formality`, `genderPresentation`, `isArchived`, etc.) |
| GET | `/wardrobe/categories` | 👤 | ✅ Built | List wardrobe categories and item counts |
| GET | `/wardrobe/:id` | 👤 | ✅ Built | Wardrobe item detail |
| PATCH | `/wardrobe/:id` | 👤 | ✅ Built | Edit item category, color, subcategory, fit, formality, tags, archive status |
| DELETE | `/wardrobe/:id` | 👤 | ✅ Built | Delete wardrobe item and Upstash vector embedding |

---

## 17. AI Personal Stylist & Virtual Try-On (`/ai`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| POST | `/ai/stylist` | 👤 | ✅ Built | Multi-turn conversational stylist assistant with wardrobe retrieval and outfit generation |
| POST | `/ai/shape-model` | 👤 | ✅ Built | Upload/create client shape model for virtual try-on |
| GET | `/ai/shape-model` | 👤 | ✅ Built | Get client's current shape model |
| DELETE | `/ai/shape-model` | 👤 | ✅ Built | Delete client's shape model |
| POST | `/ai/try-on` | 👤 | ✅ Built | Submit virtual try-on generation job for wardrobe garments |
| GET | `/ai/try-on/:id` | 👤 | ✅ Built | Get virtual try-on job status and generated image |
| GET | `/ai/try-on` | 👤 | ✅ Built | List client's virtual try-on generation history |
| DELETE | `/ai/try-on/:id` | 👤 | ✅ Built | Delete virtual try-on generation result |

---

## 18. Admin (`/admin`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/admin/verifications` | 🔍 | ✅ Built | List pending identity verifications (returns signed Cloudinary URLs) |
| PATCH | `/admin/verifications/:userId/approve` | 🔍 | ✅ Built | Approve identity verification |
| PATCH | `/admin/verifications/:userId/reject` | 🔍 | ✅ Built | Reject identity verification with reason |
| GET | `/admin/users` | 🛡️ | ✅ Built | List/search all platform users |
| PATCH | `/admin/users/:id/suspend` | 🛡️ | ✅ Built | Suspend user account |
| PATCH | `/admin/users/:id/reactivate` | 🛡️ | ✅ Built | Reactivate user account |
| PATCH | `/admin/users/:id/restrict` | 🛡️ | ✅ Built | Mute user from sending chat messages |
| PATCH | `/admin/users/:id/unrestrict` | 🛡️ | ✅ Built | Remove user chat mute restriction |
| PATCH | `/admin/users/:id/revoke-sessions` | 🛡️ | ✅ Built | Force-revoke all active sessions and increment tokenVersion |
| POST | `/admin/users/:id/block` | 🛡️ | ✅ Built | Block user permanently (POST method) |
| PATCH | `/admin/users/:id/block` | 🛡️ | ✅ Built | Block user permanently (PATCH method) |
| POST | `/admin/users/:id/unblock` | 🛡️ | ✅ Built | Unblock user (POST method) |
| PATCH | `/admin/users/:id/unblock` | 🛡️ | ✅ Built | Unblock user (PATCH method) |
| GET | `/admin/users/:userId/subscription` | 🛡️ | ✅ Built | Read a user's subscription, entitlements and usage |
| POST | `/admin/users/:userId/subscription` | 🛡️ | ✅ Built | **Manual plan grant / downgrade / revoke — no Paymob, no Payment, no ledger entry.** |
| GET | `/admin/users/:userId/subscription/history` | 🛡️ | ✅ Built | Append-only plan-transition history for a user |
| GET | `/admin/bookings/disputed` | 🛡️ | ✅ Built | List all disputed bookings |
| PATCH | `/admin/bookings/:id/resolve-dispute` | 🛡️ | ✅ Built | Arbitrate dispute with refund percentage |
| PATCH | `/admin/bookings/:id/resolve-no-show` | 🛡️ | ✅ Built | Arbitrate filed no-show incident |
| PATCH | `/admin/reviews/:id/hide` | 🛡️ | ✅ Built | Toggle review visibility — body `{ isHidden: boolean }` |
| GET | `/admin/ledger/statements` | 🛡️ | ✅ Built | Query double-entry ledger transactions and statements |
| GET | `/admin/ledger/reconciliation` | 🛡️ | ✅ Built | Run ledger mathematical reconciliation check |
| GET | `/admin/audit-logs` | 🛡️ | ✅ Built | Query platform audit log trail |
| GET | `/admin/dashboard/stats` | 🛡️ | ✅ Built | Platform dashboard overview metrics |

---

## 19. Admin Content & Contact Moderation (`/admin/moderation`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/admin/moderation/events` | 🔍 | ✅ Built | List flagged moderation review queue events |
| POST | `/admin/moderation/events/:id/confirm` | 🔍 | ✅ Built | Confirm moderation violation and apply account strike |
| POST | `/admin/moderation/events/:id/overturn` | 🔍 | ✅ Built | Overturn false-positive moderation flag |
| GET | `/admin/moderation/blocked-domains` | 🛡️ | ✅ Built | List off-platform contact blocked domains |
| POST | `/admin/moderation/blocked-domains` | 🛡️ | ✅ Built | Add off-platform contact blocked domain |
| DELETE | `/admin/moderation/blocked-domains/:id` | 🛡️ | ✅ Built | Remove off-platform contact blocked domain |
| GET | `/admin/moderation/blocked-words` | 🛡️ | ✅ Built | List content moderation blocked words |
| POST | `/admin/moderation/blocked-words` | 🛡️ | ✅ Built | Add single blocked word |
| POST | `/admin/moderation/blocked-words/bulk` | 🛡️ | ✅ Built | Bulk import blocked words |
| DELETE | `/admin/moderation/blocked-words/:id` | 🛡️ | ✅ Built | Delete blocked word |
| PATCH | `/admin/moderation/violations/:id/forgive` | 🛡️ | ✅ Built | Forgive historical strike violation |

---

## 20. System & Infrastructure

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/health` | 🔓 | ✅ Built | Root & V1 health check probe (readiness & dependency status) |
| GET | `/api/docs` | 🔓 | ✅ Built | Swagger UI interactive OpenAPI documentation (alias `/api/v1/docs`) |
| GET | `/admin/queues` | 🛡️ | 🔲 Planned | Bull Board background queue monitoring UI |

---

## 21. Demo Trial API (`/api/demo`)

Murafiq exposes a dedicated demo environment mounted at `/api/demo` designed for trial runs and evaluator testing without real payments or external financial settlement.

- **Total Live Demo Endpoints:** 87 routes (90 documented operations in Demo OpenAPI spec).
- **Execution Mode:** All requests are tagged with `bookingMode: 'demo'`.
- **Payment & Settlement Semantics:** Cash-on-Delivery (COD) booking workflows; bypasses Paymob gateway checkout and stylist escrow payout disbursements.
- **Mounted Shared Modules:** `/auth`, `/users`, `/locations`, `/stylists`, `/requests`, `/offers`, `/bookings`, `/chat`, `/notifications`, `/reviews`, `/uploads`, `/wardrobe`, `/ai`, plus `/health`.
- **Subscriptions in Demo:** Exposes read-only plan catalog and user entitlement inspection (`GET /subscriptions/plans`, `GET /subscriptions/me`, `GET /subscriptions/me/entitlements`). Mutating checkout routes are omitted.
- **Omitted Commercial Routes:** `/payments`, `/payouts`, `/coupons`, and `/admin` are completely unmounted and return `404 Not Found`.

---

## 22. Cancelled / Historical Initiatives (Preserved for Audit Trail)

Under **Product Decision P1** (System Simplification, 2026-09), the dead safety scaffolding was cancelled and purged from runtime code to eliminate dead architecture and focus on the core marketplace escrow loop:
- `POST /safety/sos` — Defunct / Cancelled by Decision P1
- `POST /safety/report` — Defunct / Cancelled by Decision P1
- `GET /admin/safety-reports` — Defunct / Cancelled by Decision P1
- `PATCH /admin/safety-reports/:id/resolve` — Defunct / Cancelled by Decision P1
- `PATCH /bookings/:id/live-tracking` — Defunct / Cancelled by Decision P1
