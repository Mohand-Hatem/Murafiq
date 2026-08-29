# Murafiq — Full API Routes Reference

> All routes are prefixed with `/api/v1`.
> Auth column: 🔓 Public, 🔐 Authenticated (any role), 👤 Client only, 💇 Stylist only, 🛡️ Admin only, 🔍 Admin + Operator.
> Status column: ✅ Built (live in codebase & exercised), 🔲 Planned (specified for upcoming roadmap phase).

---

## Auth (`/auth`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| POST | `/auth/register` | 🔓 | ✅ Built | Register new client or stylist |
| POST | `/auth/login` | 🔓 | ✅ Built | Login, sets access + refresh tokens |
| POST | `/auth/google` | 🔓 | ✅ Built | Google Sign-In via ID token |
| POST | `/auth/logout` | 🔐 | ✅ Built | Invalidate refresh token and session |
| POST | `/auth/refresh-token` | 🔓 (cookie/body) | ✅ Built | Issue new access token with rotation |
| POST | `/auth/verify-email` | 🔓 | ✅ Built | Verify email via 6-digit OTP |
| POST | `/auth/resend-otp` | 🔓 | ✅ Built | Resend verification OTP (rate-limited) |
| POST | `/auth/forgot-password` | 🔓 | ✅ Built | Request password reset OTP |
| POST | `/auth/reset-password` | 🔓 | ✅ Built | Reset password with OTP |
| PATCH | `/auth/change-password` | 🔐 | ✅ Built | Change password & invalidate other sessions |

---

## Users (`/users`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/users/me` | 🔐 | ✅ Built | Current user's full profile |
| PATCH | `/users/me` | 🔐 | ✅ Built | Update profile fields (name, phone, bio, etc.) |
| PATCH | `/users/me/verification-documents` | 🔐 | ✅ Built | Upload national ID front/back + selfie-with-ID |
| PATCH | `/users/me/profile-image` | 🔐 | ✅ Built | Upload/replace profile photo |
| DELETE | `/users/me` | 🔐 | ✅ Built | Soft delete own account |

---

## Stylists (`/stylists`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/stylists` | 🔓 | ✅ Built | Search stylists (filters, pagination, sort, $geoNear) |
| GET | `/stylists/:id` | 🔓 | ✅ Built | Public stylist profile |
| POST | `/stylists/profile` | 💇 | ✅ Built | Complete stylist onboarding profile |
| PATCH | `/stylists/profile` | 💇 | ✅ Built | Update stylist profile (rates, specialties, bio) |
| GET | `/stylists/:id/reviews` | 🔓 | ✅ Built | Public reviews for a stylist |

---

## Payouts (`/payouts`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/payouts/account` | 💇 | ✅ Built | Get stylist payout credentials |
| PATCH | `/payouts/account` | 💇 | ✅ Built | Update stylist payout credentials |
| GET | `/payouts/mine` | 💇 | ✅ Built | Own historical payout disbursements |
| GET | `/payouts/admin/pending-balances` | 🛡️ | ✅ Built | Summary of eligible unpaid balances per stylist |
| GET | `/payouts/admin` | 🛡️ | ✅ Built | Admin list all payouts |
| POST | `/payouts/admin/batch` | 🛡️ | ✅ Built | Generate batch payout disbursements |
| PATCH | `/payouts/admin/:id/mark-processing` | 🛡️ | ✅ Built | Move payout status to processing |
| PATCH | `/payouts/admin/:id/mark-paid` | 🛡️ | ✅ Built | Mark payout as paid with transfer reference |
| PATCH | `/payouts/admin/:id/mark-failed` | 🛡️ | ✅ Built | Mark payout as failed and revert booking locks |

---

## Requests (`/requests`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| POST | `/requests` | 👤 | ✅ Built | Create a direct (1:1) or open broadcast request |
| GET | `/requests/mine` | 👤 | ✅ Built | Client's own submitted requests |
| GET | `/requests/incoming` | 💇 | ✅ Built | Incoming direct requests targeted at this stylist |
| GET | `/requests/feed` | 💇 | ✅ Built | Stylist open broadcast request feed with geo/area filters |
| PATCH | `/requests/:id/cancel` | 👤 | ✅ Built | Cancel a pending request |
| PATCH | `/requests/:id/decline` | 💇 | ✅ Built | Stylist declines a pending request |

---

## Offers (`/offers`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| POST | `/offers/requests/:id` | 💇 | ✅ Built | Stylist sends an offer on a request (daily capped) |
| GET | `/offers/requests/:id` | 👤 | ✅ Built | Client's own request: full offer comparison, sorted cheapest first (sealed-bid applies to other stylists, not the client) |
| PATCH | `/offers/:id/accept` | 👤 | ✅ Built | Accept offer → atomic booking transaction |
| PATCH | `/offers/:id/reject` | 👤 | ✅ Built | Reject an offer |

---

## Bookings (`/bookings`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/bookings/mine` | 👤/💇 | ✅ Built | Own bookings (role-aware filtering) |
| GET | `/bookings/:id` | 🔐 | ✅ Built | Booking detail (participant or admin) |
| PATCH | `/bookings/:id/check-in` | 🔐 | ✅ Built | Mark arrival at session location |
| PATCH | `/bookings/:id/confirm-completion` | 🔐 | ✅ Built | Mutual session-completion confirmation |
| PATCH | `/bookings/:id/cancel` | 🔐 | ✅ Built | Cancel booking (timing-tiered refund) |
| POST | `/bookings/:id/dispute` | 🔐 | ✅ Built | File a dispute (within 48h of completion) |
| POST | `/bookings/:bookingId/review` | 🔐 | ✅ Built | Submit two-way session review |
| PATCH | `/bookings/:id/live-tracking` | 🔐 | 🔲 Planned | Toggle live location sharing (Phase 11) |

---

## Payments (`/payments`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| POST | `/payments/:bookingId/initialize` | 👤 | ✅ Built | Initialize payment transaction |
| POST | `/payments/callback` | 🔓 (webhook) | ✅ Built | Paymob / gateway HMAC callback webhook |
| GET | `/payments/:bookingId/status` | 🔐 | ✅ Built | Get payment status and breakdown |
| GET | `/payments/history` | 👤 | ✅ Built | Client's historical payments |
| POST | `/payments/:bookingId/refund` | 🛡️ | ✅ Built | Admin trigger refund on booking |

---

## Chat (`/chat`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/chat/:conversationId/messages` | 🔐 | ✅ Built | Paginated message history from Firestore |
| POST | `/chat/:conversationId/messages` | 🔐 | ✅ Built | REST send message fallback |
| POST | `/chat/token` | 🔐 | ✅ Built | Mint Firebase custom token for SDK auth |

---

## Notifications (`/notifications`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/notifications` | 🔐 | ✅ Built | Paginated notification feed |
| PATCH | `/notifications/:id/read` | 🔐 | ✅ Built | Mark a notification as read |
| PATCH | `/notifications/read-all` | 🔐 | ✅ Built | Mark all notifications as read |

---

## Reviews (`/reviews`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/reviews/mine` | 🔐 | ✅ Built | Caller's submitted and received reviews |

---

## Uploads (`/uploads`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| POST | `/uploads/:folder` | 🔐 | ✅ Built | Upload image to Cloudinary (folder allowlisted) |

---

## Admin (`/admin`)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/admin/verifications` | 🔍 | ✅ Built | List pending identity verifications |
| PATCH | `/admin/verifications/:userId/approve` | 🔍 | ✅ Built | Approve identity verification |
| PATCH | `/admin/verifications/:userId/reject` | 🔍 | ✅ Built | Reject identity verification with reason |
| GET | `/admin/bookings/disputed` | 🛡️ | ✅ Built | List all disputed bookings |
| PATCH | `/admin/bookings/:id/resolve-dispute` | 🛡️ | ✅ Built | Arbitrate dispute with refund percentage |
| PATCH | `/admin/reviews/:id/hide` | 🛡️ | ✅ Built | Toggle review visibility — body `{ isHidden: boolean }`; also handles unhide, no separate route |
| GET | `/admin/audit-logs` | 🛡️ | ✅ Built | Query platform audit log trail |
| GET | `/admin/users` | 🛡️ | ✅ Built | List/search all platform users |
| PATCH | `/admin/users/:id/suspend` | 🛡️ | ✅ Built | Suspend user account |
| PATCH | `/admin/users/:id/reactivate` | 🛡️ | ✅ Built | Reactivate user account |
| GET | `/admin/safety-reports` | 🛡️ | 🔲 Planned | List safety reports |
| PATCH | `/admin/safety-reports/:id/resolve` | 🛡️ | 🔲 Planned | Resolve safety report |
| GET | `/admin/dashboard/stats` | 🛡️ | ✅ Built | Platform dashboard statistics |
| GET | `/admin/queues` | 🛡️ | 🔲 Planned | Bull Board background queue UI (Phase 14 — Redis/BullMQ moved there, see `HARDENING_07`) |

---

## Safety (`/safety`) — 🔲 Planned (Phase 11)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| POST | `/safety/sos` | 🔐 | 🔲 Planned | Immediate emergency broadcast |
| POST | `/safety/report` | 🔐 | 🔲 Planned | Non-urgent safety report |

---

## Wardrobe (`/wardrobe`) — 🔲 Planned (Phase 14)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| POST | `/wardrobe` | 👤 | 🔲 Planned | Add closet photo with async AI embedding |
| GET | `/wardrobe/mine` | 👤 | 🔲 Planned | Client's wardrobe catalog with filters |
| GET | `/wardrobe/:id` | 👤 | 🔲 Planned | Wardrobe item detail |
| PATCH | `/wardrobe/:id` | 👤 | 🔲 Planned | Edit item category, color, style tags |
| DELETE | `/wardrobe/:id` | 👤 | 🔲 Planned | Delete wardrobe item and vector embedding |

---

## AI (`/ai`) — 🔲 Planned (Phase 15)

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| POST | `/ai/chat` | 🔐 | 🔲 Planned | Multi-turn conversational stylist assistant |

---

## System

| Method | Route | Auth | Status | Description |
|---|---|---|---|---|
| GET | `/health` | 🔓 | ✅ Built | Health check (Mongo + Firebase + Redis readiness) |
| GET | `/docs` | 🔓 (or 🛡️ in prod) | ✅ Built | Swagger UI OpenAPI documentation |
