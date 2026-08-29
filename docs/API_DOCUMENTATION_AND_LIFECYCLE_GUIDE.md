# Murafiq API & Complete Lifecycle Guide

Welcome to the comprehensive API documentation and lifecycle reference for **Murafiq** (مرافق) — the premier platform connecting clients with mobile and home hair stylists and barbers across Egypt.

This document breaks down:
1. **Core Architectural & Security Foundations**
2. **The 9 Complete Business Cycles (Step-by-Step User Journeys)**
3. **Exhaustive Endpoint Catalog (Every Single API Route Explained)**

---

## 1. Core Architectural & Security Foundations

- **Base URL:** `/api/v1`
- **Authentication:**
  - Standard JWT access token with 15-minute validity passed via `Authorization: Bearer <token>` header or `accessToken` cookie.
  - Refresh tokens stored in HttpOnly cookies with cryptographic rotation.
  - **Immediate Token Revocation (`tokenVersion`):** When a user is suspended, blocked, or has their password/sessions revoked, their `tokenVersion` in database and in-memory cache is incremented. Any token issued before that bump stops working immediately.
- **Account Statuses:**
  - `active`: Normal access to platform features.
  - `restricted`: Chat privileges restricted (automated strike 2).
  - `suspended`: Account temporarily locked out (automated strike 3).
  - `blocked`: Account permanently banned by admin for safety/fraud.
  - `deleted`: Soft-deleted user account.
- **Role-Based Access Control (RBAC):**
  - `client`: Customer looking for styling services.
  - `stylist`: Professional beauty and grooming service provider.
  - `operator`: First-line support (identity verifications, moderation event reviews).
  - `admin`: Full platform control (payouts, financial ledger, disputes, blocking, configuration).
- **Financial Architecture:**
  - Double-entry ledger journal guaranteeing mathematical balance (\(\sum \text{debits} = \sum \text{credits}\)).
  - Client funds are held in platform **Escrow** until service completion verified via a 6-digit OTP.
  - Stylist payouts are netted against any historical debt before disbursement.
  - Platform absorbs promotional discounts (stylist always receives their agreed quote minus platform commission).

---

## 2. The Complete End-to-End Business Cycles

```
   +-------------------+       +-------------------+       +-------------------+
   |   1. Onboarding   | ----> | 2. Request / Feed | ----> |  3. Offer Bidding |
   |  Register & Verify|       |  Direct/Broadcast |       |   1 Offer / Req   |
   +-------------------+       +-------------------+       +-------------------+
                                                                     |
                                                                     v
   +-------------------+       +-------------------+       +-------------------+
   | 6. Review & Payout| <---- | 5. Check-in & OTP | <---- | 4. Escrow Payment |
   | Reliability & Cash|       | Service Completion|       | Paymob / Webhook  |
   +-------------------+       +-------------------+       +-------------------+
```

### Cycle 1: Onboarding & Identity Verification Flow
1. **Registration:** User signs up (`POST /api/v1/auth/register`) with name, email, password, and role (`client` or `stylist`).
2. **Email Verification:** A 6-digit OTP is sent via email (`POST /api/v1/auth/verify-email`).
3. **Stylist Verification:** Stylists upload National ID front/back + Syndicate ID (`PATCH /api/v1/users/me/verification-documents`).
4. **Admin/Operator Review:** Admin or Operator reviews and approves (`PATCH /api/v1/admin/verifications/:id/approve`) or rejects with reason (`PATCH .../reject`). Only `verified` stylists can send offers and receive bookings.

### Cycle 2: Request & Discovery Flow
1. **Search Stylists:** Clients search stylists by location, governorate, city, rating, and service category (`GET /api/v1/stylists`).
2. **Create Direct Request:** Client sends a booking request targeted to a specific stylist (`POST /api/v1/requests` with `visibility: 'direct'`).
3. **Create Broadcast Request:** Client posts a general request visible to all verified stylists in the governorate/city (`POST /api/v1/requests` with `visibility: 'broadcast'`).
4. **Broadcast Feed:** Stylists browse available requests matching their location and category (`GET /api/v1/requests/feed`).

### Cycle 3: Bidding & Offer Lifecycle Flow
1. **Send Offer:** Stylist submits a binding price quote and estimated duration (`POST /api/v1/offers/requests/:requestId`).
   - *Rule:* Max 1 active offer per stylist per request.
   - *Rule:* Bounded by subscription tier daily quota and active capacity.
2. **Sealed-Bid Comparison:** Client reviews all incoming offers for their request without stylists seeing each other's quotes (`GET /api/v1/offers/requests/:requestId`).
3. **Offer Acceptance:** Client accepts their preferred offer (`PATCH /api/v1/offers/:id/accept`).
   - Sibling pending offers are automatically marked `REJECTED`.
   - A `PENDING` booking record is created in the database.

### Cycle 4: Booking, Escrow Payment & Confirmation Flow
1. **Initialize Payment:** Client initiates checkout (`POST /api/v1/payments/:bookingId/initialize`) optionally applying a coupon code.
2. **Gateway Checkout:** The server returns a Paymob payment gateway URL / token.
3. **Webhook Callback:** Paymob calls `POST /api/v1/payments/callback` on successful charge.
4. **Escrow Lock:**
   - Platform locks funds in Escrow.
   - Booking transitions to `CONFIRMED`.
   - Double-entry ledger records `ESCROW_HOLD` and `COMMISSION_ACCRUED`.

### Cycle 5: In-Person Service, Check-In & OTP Completion Flow
1. **Check-In:** When arriving at the appointment location, both client and stylist check in (`PATCH /api/v1/bookings/:id/check-in`).
2. **In-Progress:** Once checked in, booking becomes `IN_PROGRESS`.
3. **OTP Security:** A secret 6-digit completion OTP is generated and given to the client.
4. **Completion:** The stylist performs the service, obtains the OTP from the client, and submits it (`PATCH /api/v1/bookings/:id/confirm-completion`).
   - OTP match triggers release of Escrow funds into the stylist's available payout balance.
   - Booking transitions to `COMPLETED`.

### Cycle 6: Reviews, Reliability Scoring & Stylist Payout Flow
1. **Mutual Reviews:** Client reviews stylist and stylist reviews client (`POST /api/v1/bookings/:bookingId/review`).
2. **Reliability Metric:** System updates the stylist's reliability rating, completion rate, and average response time (`GET /api/v1/stylists/:id/reliability`).
3. **Bank/Wallet Setup:** Stylist sets their payout destination (`PATCH /api/v1/payouts/account` - Vodafone Cash, InstaPay, or Bank Account).
4. **Batch Disbursement:** Admin initiates scheduled payouts (`POST /api/v1/payouts/admin/batch`) with automated debt netting.

### Cycle 7: Exception Paths (Cancellation, No-Show, Disputes)
- **Cancellation:**
  - > 24 hours before appointment: Client receives 100% refund (`PATCH /api/v1/bookings/:id/cancel`).
  - < 24 hours before appointment: 25% cancellation penalty applied.
- **No-Show:**
  - If a party fails to arrive within 30 min of scheduled time, the other party files a report (`POST /api/v1/bookings/:id/no-show`).
  - 2-hour response window for the accused party (`POST .../respond`).
  - If upheld: Offender penalized, innocent party refunded and issued a compensation coupon.
- **Disputes:**
  - Client or stylist files a formal dispute (`POST /api/v1/bookings/:id/dispute`) and uploads photo/text evidence (`POST .../evidence`).
  - Admin reviews and issues an arbitration ruling (`POST /api/v1/admin/bookings/:id/resolve-dispute`).

### Cycle 8: Subscriptions & Quota Entitlements
- Stylists choose between `Free`, `Basic`, `Pro`, and `Enterprise` plans (`GET /api/v1/subscriptions/plans`).
- Higher tiers unlock more daily bids, higher concurrent active offers, reduced platform commission, and priority broadcast feed placement.

### Cycle 9: Content Safety & Moderation
- Real-time scanning on chat, request descriptions, and offer notes against off-platform phone numbers, payment evasion terms, external URLs, and blocked words.
- 3-strike escalation: Strike 1 = Warning, Strike 2 = 7-day Chat Restriction, Strike 3 = Automated Suspension.
- Admin review queue for flagged content and manual ban/block overrides.

---

## 3. Exhaustive Endpoint Catalog

---

### 🟢 3.1 Authentication & Session Management (`/api/v1/auth`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | /auth/register | Public | Register new user account (client or stylist) with email, password, and profile info. |
| POST | /auth/login | Public | Authenticate with email/password; returns JWT access token + sets refresh cookie. |
| POST | /auth/google | Public | Social login / registration with verified Google ID token. |
| POST | /auth/refresh-token | Public | Exchange HttpOnly refresh cookie for a new 15-minute access token. |
| POST | /auth/verify-email | Public | Submit 6-digit email OTP to verify account. |
| POST | /auth/resend-otp | Public | Request a fresh OTP (rate limited to 1 per 60s). |
| POST | /auth/forgot-password | Public | Request password reset OTP via email. |
| POST | /auth/reset-password | Public | Submit OTP and set new password. |
| PATCH | /auth/change-password | Authenticated | Change password using current password; revokes all existing sessions. |
| POST | /auth/logout | Authenticated | Invalidate current session and clear refresh token cookie. |
| POST | /auth/logout-all | Authenticated | Bump 	okenVersion to immediately kill all active sessions across all devices. |
| GET | /auth/sessions | Authenticated | List all active device sessions for current user. |

---

### 👤 3.2 User & Profile Management (/api/v1/users)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | /users/me | Authenticated | Get full private profile of logged-in user. |
| PATCH | /users/me | Authenticated | Update personal profile (name, phone, address, coordinates). |
| PATCH | /users/me/profile-image | Authenticated | Update user avatar image URL. |
| PATCH | /users/me/verification-documents | Stylist | Upload National ID & syndicate documents for operator review. |
| DELETE | /users/me | Authenticated | Soft-delete user account and revoke all sessions. |
| GET | /users/:id | Public | Get zero-PII public profile of any user (shows name, avatar, rating, completed jobs). |

---

### 📍 3.3 Location & Geo Directory (/api/v1/locations)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | /locations/governorates | Public | List all 27 supported Egyptian governorates. |
| GET | /locations/governorates/:gov/cities | Public | List all cities/districts within a governorate. |

---

### 💈 3.4 Stylist Profiles & Discovery (/api/v1/stylists)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | /stylists | Public | Search verified stylists by location (lat/lng radius), category, gender, and rating. |
| GET | /stylists/:id | Public | View stylist's public bio, portfolio photos, services, and price list. |
| GET | /stylists/:id/reviews | Public | Paginated list of client reviews and ratings for a stylist. |
| GET | /stylists/:id/reliability | Public | View stylist's completion rate, response rate, on-time score, and trust badge. |
| GET | /stylists/me/profile | Stylist | View logged-in stylist's own complete profile and settings. |
| POST | /stylists/profile | Stylist | Initialize stylist professional profile (bio, services offered, travel range). |
| PATCH | /stylists/profile | Stylist | Update stylist bio, services, portfolio photos, and availability schedule. |
| GET | /stylists/me/payouts | Stylist | View stylist payout summary and earnings breakdown. |

---

### 📝 3.5 Requests & Broadcast Feed (/api/v1/requests)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | /requests | Client | Create a service request (direct targeted to one stylist, or roadcast to feed). |
| GET | /requests/mine | Client | List all service requests created by the authenticated client. |
| PATCH | /requests/:id | Client | Edit an open request (service type, date/time, address, description). |
| PATCH | /requests/:id/reactivate | Client | Reopen an expired/paused request to receive new offers. |
| PATCH | /requests/:id/close | Client | Manually close an open request without accepting an offer. |
| PATCH | /requests/:id/cancel | Client | Cancel an open request. |
| GET | /requests/feed | Stylist | Browse broadcast request feed filtered by distance, category, and date. |
| GET | /requests/incoming | Stylist | View direct requests sent specifically to this stylist. |
| PATCH | /requests/:id/decline | Stylist | Decline an incoming direct request. |

---

### 🏷️ 3.6 Offers & Sealed Bidding (/api/v1/offers)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | /offers/requests/:id | Stylist | Place a binding price & duration quote on a request (max 1 per request). |
| PATCH | /offers/:id/withdraw | Stylist | Withdraw a pending offer before client accepts it (refunds daily quota). |
| GET | /offers/requests/:id | Client | View and compare all sealed bids placed on the client's request. |
| PATCH | /offers/:id/accept | Client | Accept an offer; auto-creates booking in PENDING and rejects competing bids. |
| PATCH | /offers/:id/reject | Client | Explicitly reject an individual offer. |

---

### 📅 3.7 Bookings, Scheduling & OTP Completion (/api/v1/bookings)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | /bookings/mine | Client | View all client bookings (upcoming, completed, cancelled). |
| GET | /bookings/stylist | Stylist | View stylist appointment calendar and booking schedule. |
| GET | /bookings/:id | Authenticated | Get full booking details, service address, status, and participants. |
| GET | /bookings/:id/cancellation-quote | Authenticated | Calculate exact refund and penalty breakdown before cancelling. |
| PATCH | /bookings/:id/check-in | Authenticated | Check in upon arrival at appointment location. |
| PATCH | /bookings/:id/confirm-completion | Stylist | Submit client's 6-digit OTP to complete job and unlock Escrow funds. |
| PATCH | /bookings/:id/cancel | Authenticated | Cancel confirmed booking per platform cancellation policy. |
| POST | /bookings/:id/no-show | Authenticated | File a no-show report after 30-min grace window expires. |
| POST | /bookings/:id/no-show/respond | Authenticated | Accused party submits explanation within 2-hour window. |
| POST | /bookings/:id/dispute | Authenticated | Escalate unresolved issues to platform arbitration. |
| POST | /bookings/:id/dispute/evidence | Authenticated | Upload photo/text evidence supporting a dispute. |
| GET | /bookings/:id/dispute | Authenticated | View dispute status, evidence timeline, and admin resolution. |
| POST | /bookings/:bookingId/review | Authenticated | Submit 1-5 star rating, tags, and feedback after job completion. |
| GET | /bookings/:bookingId/reviews | Authenticated | View reviews submitted for this specific booking. |

---

### 💳 3.8 Payments & Gateway Escrow (/api/v1/payments)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | /payments/:bookingId/initialize | Client | Generate Paymob checkout session (supports card, mobile wallets, kiosk). |
| POST | /payments/callback | Public | Webhook endpoint receiving cryptographic payment verification from Paymob. |
| GET | /payments/:bookingId/status | Authenticated | Check whether payment is pending, escrowed, or completed. |
| GET | /payments/history | Client | View client receipts, transaction IDs, and invoices. |
| POST | /payments/:bookingId/refund | Admin | Manually trigger payment refund to client. |

---

### 🎟️ 3.9 Coupons & Platform Discounts (/api/v1/coupons)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | /coupons/mine | Authenticated | View all coupons issued to the user with expiry dates and discount %. |
| POST | /coupons/validate | Authenticated | Validate coupon against a booking price without consuming it. |
| POST | /coupons | Admin | Issue promotional coupon to a single client or bulk array (up to 1,000 EGP cap). |

---

### ⭐ 3.10 Reviews & Feedback (/api/v1/reviews)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | /reviews/mine | Authenticated | List all reviews written by or received by the current user. |
| GET | /reviews/booking/:bookingId | Authenticated | View reviews associated with a booking. |
| GET | /reviews/stylist/:id | Public | View public client reviews for a stylist. |
| GET | /reviews/client/:id | Public | View public stylist reviews for a client. |

---

### 💬 3.11 In-App Chat & Content Safety (/api/v1/chat)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | /chat/token | Authenticated | Mint secure Firebase / WebSocket authentication token for real-time messaging. |
| GET | /chat/:conversationId/messages | Authenticated | Fetch paginated chat history for an active booking/request conversation. |
| POST | /chat/:conversationId/messages | Authenticated | Send message (automatically passed through real-time safety scanner). |
| POST | /chat/:conversationId/report | Authenticated | Report an abusive message for operator/admin review. |

---

### 🔔 3.12 Push Notifications (/api/v1/notifications)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | /notifications | Authenticated | Fetch in-app notification history. |
| GET | /notifications/unread-count | Authenticated | Get unread badge counter. |
| PATCH | /notifications/:id/read | Authenticated | Mark a single notification as read. |
| PATCH | /notifications/read-all | Authenticated | Mark all notifications as read. |
| POST | /notifications/device-token | Authenticated | Register FCM device token for mobile push alerts. |
| DELETE | /notifications/device-token | Authenticated | Remove device token on logout. |

---

### 📁 3.13 Media Uploads (/api/v1/uploads)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | /uploads/:folder | Authenticated | Upload image to Cloudinary (vatars, portfolio, erification, evidence). |

---

### 💎 3.14 Subscriptions & Entitlements (/api/v1/subscriptions)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | /subscriptions/plans | Public | List available subscription tiers (Free, Basic, Pro, Enterprise) and features. |
| GET | /subscriptions/me | Stylist | View active plan, renewal date, and billing status. |
| GET | /subscriptions/me/entitlements | Stylist | View remaining daily bids, active offer capacity, and commission rate. |
| POST | /subscriptions/subscribe | Stylist | Upgrade or switch subscription tier. |
| POST | /subscriptions/cancel | Stylist | Cancel subscription (reverts to Free plan at end of billing cycle). |

---

### 💰 3.15 Stylist Payouts & Netting (/api/v1/payouts)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | /payouts/account | Stylist | Get configured payout destination details. |
| PATCH | /payouts/account | Stylist | Set or update Vodafone Cash / InstaPay / Bank Account details. |
| GET | /payouts/mine | Stylist | View personal payout transaction history and statuses. |
| GET | /payouts/admin/pending-balances | Admin | List all stylists with available balances awaiting payout. |
| GET | /payouts/admin | Admin | List all historical payout batches and disbursements. |
| POST | /payouts/admin/batch | Admin | Create automated batch payout disbursement with debt netting. |
| PATCH | /payouts/admin/:id/mark-processing | Admin | Mark payout item as in-transit with bank. |
| PATCH | /payouts/admin/:id/mark-paid | Admin | Confirm successful funds transfer. |
| PATCH | /payouts/admin/:id/mark-failed | Admin | Record failed bank transfer and refund balance to stylist account. |

---

### 🛡️ 3.16 Admin Operations & Financial Ledger (/api/v1/admin)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | /admin/dashboard/stats | Admin | View platform KPIs (GMV, net revenue, active bookings, user growth). |
| GET | /admin/verifications | Admin/Operator | Queue of pending stylist identity verifications. |
| PATCH | /admin/verifications/:id/approve | Admin/Operator | Approve stylist identity documents. |
| PATCH | /admin/verifications/:id/reject | Admin/Operator | Reject stylist identity with explanation. |
| GET | /admin/users | Admin | Search and filter all registered platform users. |
| PATCH | /admin/users/:id/suspend | Admin | Suspend user account with reason (kills sessions). |
| PATCH | /admin/users/:id/reactivate | Admin | Reactivate suspended user account. |
| POST / PATCH | /admin/users/:id/block | Admin | Permanently block user for fraud/safety (revokes tokens immediately). |
| POST / PATCH | /admin/users/:id/unblock | Admin | Lift permanent block upon review. |
| PATCH | /admin/users/:id/restrict | Admin | Apply timed chat restriction (7-30 days). |
| PATCH | /admin/users/:id/unrestrict | Admin | Remove chat restriction immediately. |
| PATCH | /admin/users/:id/revoke-sessions| Admin | Invalidate all access and refresh tokens for a user. |
| GET | /admin/bookings/disputed | Admin | Queue of active booking disputes. |
| POST | /admin/bookings/:id/resolve-dispute | Admin | Issue binding arbitration ruling (refund client / payout stylist / split). |
| POST | /admin/bookings/:id/resolve-no-show | Admin | Overrule or uphold no-show resolution. |
| PATCH | /admin/reviews/:id/hide | Admin | Hide abusive or policy-violating review from public profile. |
| GET | /admin/ledger/statements | Admin | Query financial double-entry journal entries by account, booking, or type. |
| POST | /admin/ledger/reconcile | Admin | Run real-time financial integrity check validating zero discrepancy. |

---

### 🚨 3.17 Safety, Content Moderation & Blocked Lexicon (/api/v1/admin/moderation)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | /admin/moderation/events | Admin/Operator | Flagged content events queue for human review. |
| POST | /admin/moderation/events/:id/confirm | Admin/Operator | Confirm flagged violation and apply strike. |
| POST | /admin/moderation/events/:id/overturn | Admin/Operator | Overturn false-positive flag. |
| GET | /admin/moderation/blocked-domains | Admin | List all forbidden external URL domains. |
| POST | /admin/moderation/blocked-domains | Admin | Add domain to denylist. |
| DELETE | /admin/moderation/blocked-domains/:id | Admin | Remove domain from denylist. |
| GET | /admin/moderation/blocked-words | Admin | Paginated list of blocked profanity, insults, and harassment words. |
| POST | /admin/moderation/blocked-words | Admin | Add single word to blocklist with category and severity. |
| POST | /admin/moderation/blocked-words/bulk | Admin | Bulk add up to 100 words to dictionary. |
| DELETE | /admin/moderation/blocked-words/:id | Admin | Delete word from blocklist. |
| PATCH | /admin/moderation/violations/:id/forgive | Admin | Forgive strike and resolve restriction. |

---

### 🩺 3.18 Health Check (/api/v1/health)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | /health | Public | Returns database, Firebase, and server operational status. |

---

*Document compiled and verified against Murafiq API v1.0.0 specifications.*
