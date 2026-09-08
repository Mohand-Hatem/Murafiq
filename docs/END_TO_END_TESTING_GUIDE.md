# Murafiq — Complete End-to-End Manual Testing Guide

> **This guide provides copy-pasteable requests, exact JSON request bodies, and verified verification steps for the complete Murafiq lifecycle.**
> Every route, method (`POST`, `PATCH`, `GET`, `DELETE`), header, and parameter matches the backend Zod validation schemas.

---

## 0. Testing Setup & Conventions

### Base URL
```
http://localhost:4000/api/v1
```

### Essential Headers
For all API testing tools (Postman, API Dog, Insomnia, cURL):
- `Content-Type: application/json`
- `X-Client-Type: mobile` *(Ensures tokens are returned in the JSON body rather than only in cookies)*
- `Authorization: Bearer <TOKEN>` *(For all authenticated endpoints)*

### Test State Variables (Save these as you proceed)
- `CLIENT_TOKEN` & `CLIENT_ID`
- `STYLIST_TOKEN` & `STYLIST_ID`
- `ADMIN_TOKEN` & `ADMIN_ID`
- `REQUEST_ID`
- `OFFER_ID`
- `BOOKING_ID`
- `PAYOUT_ID`

---

## 🔄 PHASE 1: Complete Happy Path Lifecycle

```
[Register/Login] ──► [Verify KYC] ──► [Post Request] ──► [Send Offer] ──► [Accept & Escrow Pay]
       │
       ▼
[Check-In] ──► [OTP Completion] ──► [Two-Way Reviews] ──► [Netting & Admin Batch Payout]
```

---

### Step 1: Register Client
- **Method:** `POST`
- **URL:** `/auth/register`
- **Headers:** `X-Client-Type: mobile`
- **Request Body:**
```json
{
  "name": "Sarah Client",
  "email": "sarah.client@example.com",
  "password": "Password123!",
  "role": "client",
  "phone": "+201012345678"
}
```
- **Expected Status:** `201 Created`
- **Action:** Check server console or database for the 6-digit email OTP (e.g., `123456`).

---

### Step 2: Verify Client Email
- **Method:** `POST`
- **URL:** `/auth/verify-email`
- **Headers:** `X-Client-Type: mobile`
- **Request Body:**
```json
{
  "email": "sarah.client@example.com",
  "otp": "123456"
}
```
- **Expected Status:** `200 OK`

---

### Step 3: Login Client
- **Method:** `POST`
- **URL:** `/auth/login`
- **Headers:** `X-Client-Type: mobile`
- **Request Body:**
```json
{
  "email": "sarah.client@example.com",
  "password": "Password123!"
}
```
- **Expected Status:** `200 OK`
- **Capture:** `data.accessToken` ➔ **`CLIENT_TOKEN`**, `data.user.id` ➔ **`CLIENT_ID`**

---

### Step 4: Register Stylist
- **Method:** `POST`
- **URL:** `/auth/register`
- **Headers:** `X-Client-Type: mobile`
- **Request Body:**
```json
{
  "name": "Ahmed Stylist",
  "email": "ahmed.stylist@example.com",
  "password": "Password123!",
  "role": "stylist",
  "phone": "+201087654321"
}
```
- **Expected Status:** `201 Created`

---

### Step 5: Verify Stylist Email
- **Method:** `POST`
- **URL:** `/auth/verify-email`
- **Headers:** `X-Client-Type: mobile`
- **Request Body:**
```json
{
  "email": "ahmed.stylist@example.com",
  "otp": "123456"
}
```
- **Expected Status:** `200 OK`

---

### Step 6: Login Stylist
- **Method:** `POST`
- **URL:** `/auth/login`
- **Headers:** `X-Client-Type: mobile`
- **Request Body:**
```json
{
  "email": "ahmed.stylist@example.com",
  "password": "Password123!"
}
```
- **Expected Status:** `200 OK`
- **Capture:** `data.accessToken` ➔ **`STYLIST_TOKEN`**, `data.user.id` ➔ **`STYLIST_ID`**

---

### Step 7: Stylist Uploads Verification Documents (KYC)
- **Method:** `PATCH`
- **URL:** `/users/me/verification-documents`
- **Headers:** `Authorization: Bearer <STYLIST_TOKEN>`
- **Request Body:**
```json
{
  "nationalIdFront": "https://res.cloudinary.com/murafiq/image/upload/id_front.jpg",
  "nationalIdBack": "https://res.cloudinary.com/murafiq/image/upload/id_back.jpg",
  "syndicateCard": "https://res.cloudinary.com/murafiq/image/upload/syndicate.jpg"
}
```
- **Expected Status:** `200 OK`

---

### Step 8: Login Admin
- **Method:** `POST`
- **URL:** `/auth/login`
- **Headers:** `X-Client-Type: mobile`
- **Request Body:**
```json
{
  "email": "admin@murafiq.com",
  "password": "AdminPassword123!"
}
```
- **Expected Status:** `200 OK`
- **Capture:** `data.accessToken` ➔ **`ADMIN_TOKEN`**

---

### Step 9: Admin Approves Stylist Verification
- **Method:** `PATCH`
- **URL:** `/admin/verifications/{{STYLIST_ID}}/approve`
- **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
- **Expected Status:** `200 OK`
- **Effect:** Stylist verification status becomes `verified`. Stylist can now send offers.

---

### Step 10: Stylist Creates Profile & Services
- **Method:** `POST`
- **URL:** `/stylists/profile`
- **Headers:** `Authorization: Bearer <STYLIST_TOKEN>`
- **Request Body:**
```json
{
  "bio": "Professional hair stylist and barber with 8 years experience across Cairo.",
  "services": [
    {
      "name": "Men Haircut & Styling",
      "category": "haircut",
      "basePrice": 250,
      "durationMinutes": 45
    },
    {
      "name": "Beard Grooming & Spa",
      "category": "grooming",
      "basePrice": 150,
      "durationMinutes": 30
    }
  ],
  "travelRangeKm": 25,
  "isAvailable": true
}
```
- **Expected Status:** `201 Created`

---

### Step 11: Client Creates Broadcast Service Request
- **Method:** `POST`
- **URL:** `/requests`
- **Headers:** `Authorization: Bearer <CLIENT_TOKEN>`
- **Request Body:**
```json
{
  "visibility": "broadcast",
  "title": "Haircut and Beard trim at home",
  "description": "Looking for a professional stylist for home grooming this Saturday.",
  "date": "2026-09-05T14:00:00.000Z",
  "time": "14:00",
  "meetingLocation": {
    "address": "15 Al-Ahram St, Heliopolis",
    "country": "Egypt",
    "governorate": "Cairo",
    "city": "Heliopolis",
    "area": "Korba",
    "lat": 30.0889,
    "lng": 31.3285
  },
  "budgetRange": {
    "min": 200,
    "max": 450
  }
}
```
- **Expected Status:** `201 Created`
- **Capture:** `data.request._id` (or `data._id`) ➔ **`REQUEST_ID`**

---

### Step 12: Stylist Browses Broadcast Feed
- **Method:** `GET`
- **URL:** `/requests/feed?governorate=Cairo`
- **Headers:** `Authorization: Bearer <STYLIST_TOKEN>`
- **Expected Status:** `200 OK`
- **Verify:** The created request is visible in the list.

---

### Step 13: Stylist Submits Binding Offer
- **Method:** `POST`
- **URL:** `/offers/requests/{{REQUEST_ID}}`
- **Headers:** `Authorization: Bearer <STYLIST_TOKEN>`
- **Request Body:**
```json
{
  "price": 350,
  "duration": 60,
  "message": "Hello Sarah, I have all professional equipment and sanitized tools. See you Saturday!"
}
```
- **Expected Status:** `201 Created`
- **Capture:** `data.offer._id` (or `data._id`) ➔ **`OFFER_ID`**
- **Test Bound:** Try sending a 2nd offer immediately with the same stylist ➔ Expect `400 Bad Request` ("Maximum of 1 offer per request reached for your account").

---

### Step 14: Client Views Sealed Bids
- **Method:** `GET`
- **URL:** `/offers/requests/{{REQUEST_ID}}`
- **Headers:** `Authorization: Bearer <CLIENT_TOKEN>`
- **Expected Status:** `200 OK`
- **Verify:** Client sees the offer with `price: 350`, `duration: 60`, and stylist details.

---

### Step 15: Client Accepts Offer (Creates Booking)
- **Method:** `PATCH`
- **URL:** `/offers/{{OFFER_ID}}/accept`
- **Headers:** `Authorization: Bearer <CLIENT_TOKEN>`
- **Expected Status:** `200 OK`
- **Capture:** `data.booking._id` (or `data._id`) ➔ **`BOOKING_ID`**
- **Effect:**
  - Booking is created with status `pending`.
  - Winning offer status becomes `accepted`.
  - Competing offers become `rejected`.

---

### Step 16: Client Initializes Payment Checkout
- **Method:** `POST`
- **URL:** `/payments/{{BOOKING_ID}}/initialize`
- **Headers:** `Authorization: Bearer <CLIENT_TOKEN>`
- **Request Body:**
```json
{
  "couponCode": "WELCOME10"
}
```
*(Leave body empty `{}` if no coupon is applied).*
- **Expected Status:** `200 OK`
- **Verify:** Returns payment iframe URL, transaction token, and calculated amount.

---

### Step 17: Paymob Gateway Webhook Callback (Simulate Payment Success)
- **Method:** `POST`
- **URL:** `/payments/callback`
- **Headers:** `Content-Type: application/json`
- **Request Body (Mock Gateway Webhook Payload):**
```json
{
  "type": "TRANSACTION",
  "obj": {
    "id": 987654321,
    "success": true,
    "pending": false,
    "amount_cents": 35000,
    "currency": "EGP",
    "order": {
      "merchant_order_id": "{{BOOKING_ID}}"
    }
  }
}
```
- **Expected Status:** `200 OK`
- **Effect:**
  - Booking status transitions to `confirmed`.
  - Escrow holds funds (`ESCROW_HOLD`).
  - Chat unlocks between client and stylist.

---

### Step 18: In-App Chat Messaging
- **Method:** `POST`
- **URL:** `/chat/{{BOOKING_ID}}/messages`
- **Headers:** `Authorization: Bearer <CLIENT_TOKEN>`
- **Request Body:**
```json
{
  "content": "Hi Ahmed, please ring the 3rd floor doorbell when you arrive.",
  "type": "text"
}
```
- **Expected Status:** `201 Created`

---

### Step 19: Client Check-In
- **Method:** `PATCH`
- **URL:** `/bookings/{{BOOKING_ID}}/check-in`
- **Headers:** `Authorization: Bearer <CLIENT_TOKEN>`
- **Request Body:**
```json
{
  "lat": 30.0889,
  "lng": 31.3285
}
```
- **Expected Status:** `200 OK`

---

### Step 20: Stylist Check-In
- **Method:** `PATCH`
- **URL:** `/bookings/{{BOOKING_ID}}/check-in`
- **Headers:** `Authorization: Bearer <STYLIST_TOKEN>`
- **Request Body:**
```json
{
  "lat": 30.0889,
  "lng": 31.3285
}
```
- **Expected Status:** `200 OK`
- **Effect:** When both parties check in, booking status becomes `in_progress`. Client receives the secret completion OTP.

---

### Step 21: Stylist Confirms Completion (Submits OTP)
- **Method:** `PATCH`
- **URL:** `/bookings/{{BOOKING_ID}}/confirm-completion`
- **Headers:** `Authorization: Bearer <STYLIST_TOKEN>`
- **Request Body:**
```json
{}
```
- **Expected Status:** `200 OK`
- **Effect:**
  - Booking status becomes `completed`.
  - Escrow releases funds to stylist's pending balance.
  - Reviews unlocked for both parties.

---

### Step 22: Client Reviews Stylist
- **Method:** `POST`
- **URL:** `/bookings/{{BOOKING_ID}}/review`
- **Headers:** `Authorization: Bearer <CLIENT_TOKEN>`
- **Request Body:**
```json
{
  "rating": 5,
  "comment": "Ahmed was punctual, clean, and did an exceptional haircut. Highly recommended!",
  "tags": ["punctual", "clean_tools", "great_styling"]
}
```
- **Expected Status:** `201 Created`

---

### Step 23: Stylist Reviews Client
- **Method:** `POST`
- **URL:** `/bookings/{{BOOKING_ID}}/review`
- **Headers:** `Authorization: Bearer <STYLIST_TOKEN>`
- **Request Body:**
```json
{
  "rating": 5,
  "comment": "Great client, welcoming and respectful."
}
```
- **Expected Status:** `201 Created`

---

### Step 24: Stylist Sets Payout Destination
- **Method:** `PATCH`
- **URL:** `/payouts/account`
- **Headers:** `Authorization: Bearer <STYLIST_TOKEN>`
- **Request Body:**
```json
{
  "method": "vodafone_cash",
  "accountNumber": "01087654321",
  "accountHolderName": "Ahmed Stylist"
}
```
- **Expected Status:** `200 OK`

---

### Step 25: Admin Creates Batch Payout Disbursement
- **Method:** `POST`
- **URL:** `/payouts/admin/batch`
- **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
- **Request Body:**
```json
{
  "stylistIds": ["{{STYLIST_ID}}"],
  "notes": "Weekly stylist earnings disbursement"
}
```
- **Expected Status:** `201 Created`
- **Capture:** `data.payouts[0]._id` ➔ **`PAYOUT_ID`**

---

### Step 26: Admin Marks Payout as Paid
- **Method:** `PATCH`
- **URL:** `/payouts/admin/{{PAYOUT_ID}}/mark-paid`
- **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
- **Request Body:**
```json
{
  "transferReference": "VF_TRX_99887766",
  "notes": "Transferred via Vodafone Cash corporate portal"
}
```
- **Expected Status:** `200 OK`
- **Effect:** Payout status becomes `paid`. Double-entry ledger settles liability to zero.

---

## ⚠️ PHASE 2: Exception Paths Lifecycle

---

### Scenario A: Booking Cancellation
1. **Get Cancellation Quote (Preview Refund and Penalty):**
   - `GET /bookings/{{BOOKING_ID}}/cancellation-quote`
   - Headers: `Authorization: Bearer <CLIENT_TOKEN>`
   - Status: `200 OK`
2. **Execute Cancellation:**
   - `PATCH /bookings/{{BOOKING_ID}}/cancel`
   - Headers: `Authorization: Bearer <CLIENT_TOKEN>`
   - Request Body:
   ```json
   {
     "reason": "Emergency travel conflict"
   }
   ```
   - Status: `200 OK`

---

### Scenario B: No-Show Reporting and Compensation
1. **File No-Show (After 30-minute grace period):**
   - `POST /bookings/{{BOOKING_ID}}/no-show`
   - Headers: `Authorization: Bearer <CLIENT_TOKEN>`
   - Request Body:
   ```json
   {
     "evidence": [
       "https://res.cloudinary.com/murafiq/image/upload/empty_doorstep.jpg"
     ]
   }
   ```
   - Status: `200 OK`
2. **Accused Stylist Responds within 2-Hour Window:**
   - `POST /bookings/{{BOOKING_ID}}/no-show/respond`
   - Headers: `Authorization: Bearer <STYLIST_TOKEN>`
   - Request Body:
   ```json
   {
     "contest": true,
     "message": "I was stuck in traffic on Ring Road, arrived at 14:35 and called client."
   }
   ```
   - Status: `200 OK`
3. **Admin Resolves Contested No-Show:**
   - `POST /admin/bookings/{{BOOKING_ID}}/resolve-no-show`
   - Headers: `Authorization: Bearer <ADMIN_TOKEN>`
   - Request Body:
   ```json
   {
     "upheld": true,
     "notes": "Stylist failed to arrive within the 30-min window. Full refund issued to client."
   }
   ```
   - Status: `200 OK`

---

### Scenario C: Dispute Filing and Evidence Arbitration
1. **Client Files Dispute:**
   - `POST /bookings/{{BOOKING_ID}}/dispute`
   - Headers: `Authorization: Bearer <CLIENT_TOKEN>`
   - Request Body:
   ```json
   {
     "reason": "Stylist did not perform the agreed beard spa package.",
     "type": "service_quality",
     "evidence": [
       {
         "text": "Haircut was completed in 15 mins, beard service was skipped entirely.",
         "images": ["https://res.cloudinary.com/murafiq/image/upload/dispute_photo.jpg"]
       }
     ]
   }
   ```
   - Status: `201 Created`
2. **Stylist Submits Rebuttal Evidence:**
   - `POST /bookings/{{BOOKING_ID}}/dispute/evidence`
   - Headers: `Authorization: Bearer <STYLIST_TOKEN>`
   - Request Body:
   ```json
   {
     "text": "Client requested to skip beard grooming because they had an urgent call.",
     "images": ["https://res.cloudinary.com/murafiq/image/upload/chat_screenshot.jpg"]
   }
   ```
   - Status: `200 OK`
3. **Admin Resolves Dispute with Partial Refund Settlement:**
   - `POST /admin/bookings/{{BOOKING_ID}}/resolve-dispute`
   - Headers: `Authorization: Bearer <ADMIN_TOKEN>`
   - Request Body:
   ```json
   {
     "outcome": "split",
     "refundPercentage": 40,
     "resolutionNotes": "Refunded 40% to client for unperformed beard service. 60% released to stylist for haircut."
   }
   ```
   - Status: `200 OK`

---

## 💎 PHASE 3: Subscriptions and Upgrades Lifecycle

---

> **Prerequisite:** the plan catalogue is not seeded at boot. Run `node scripts/seed-plans.js`
> once against the target database, or `/subscriptions/plans` comes back empty.
>
> **Prerequisite for a real charge:** set `PAYMENT_PROVIDER=paymob` with live `PAYMOB_*` keys, and
> point `API_URL` at a **publicly reachable** origin (an ngrok tunnel locally). Paymob delivers the
> webhook server-to-server; if it cannot reach `API_URL`, the order stays `pending` forever and the
> plan is never granted no matter what the browser shows.

### Step 1: Browse Available Plans
- **Method:** `GET`
- **URL:** `/subscriptions/plans?role=stylist`
- **Headers:** None (Public)
- **Expected Status:** `200 OK`
- **Verify:** 4 stylist plans. Each paid plan carries **both** `priceEgp` and `priceYearlyEgp`;
  the Free plan has `priceYearlyEgp: null`. There are no `*.yearly` plan codes — a yearly purchase
  is the same plan code with `billingCycle: "yearly"`.

---

### Step 2: Check Current Entitlements and Usage
- **Method:** `GET`
- **URL:** `/subscriptions/me/entitlements`
- **Headers:** `Authorization: Bearer <STYLIST_TOKEN>`
- **Expected Status:** `200 OK`
- **Verify:** Returns the Free tier's active capacity (`offers.active: 3`) and daily limit.

---

### Step 3: Confirm the free-grant path is closed
- **Method:** `POST`
- **URL:** `/subscriptions/subscribe`
- **Headers:** `Authorization: Bearer <STYLIST_TOKEN>`
- **Request Body:**
```json
{ "planCode": "stylist.pro" }
```
- **Expected Status:** `402 Payment Required`
- **Why:** This route collects no money. It previously granted any paid plan to any logged-in user
  and wrote matching ledger entries for revenue that was never collected. It now serves only free
  plans and scheduled downgrades. **A 2xx here is a live vulnerability.**

---

### Step 4: Start a Paymob checkout (the only way to buy)
- **Method:** `POST`
- **URL:** `/subscriptions/checkout`
- **Headers:** `Authorization: Bearer <STYLIST_TOKEN>`
- **Request Body:**
```json
{
  "planCode": "stylist.pro",
  "billingCycle": "monthly"
}
```
- **Expected Status:** `200 OK`
- **Verify:** `amountEgp` is `125` for monthly and `1500` for `"billingCycle": "yearly"` — the
  yearly figure must NOT equal the monthly one. Response carries `orderId`, `specialReference`
  (`subord_<id>`) and `paymentUrl`. A `SubscriptionOrder` now exists with `status: "pending"`.
- **Negative case:** `{"planCode": "stylist.free", "billingCycle": "yearly"}` → `400` (no yearly
  variant). `{"planCode": "client.pro"}` from a stylist token → `403`.

---

### Step 5: Pay
Open `paymentUrl` in a browser and complete the Paymob test card flow. Two things then happen
independently, and they race — this is expected:

| | Destination | Purpose |
|---|---|---|
| **Webhook** (authoritative) | `POST {API_URL}/api/v1/subscriptions/webhook` | HMAC-verified; marks the order paid and grants the plan |
| **Redirect** | `GET {CLIENT_URL}/subscriptions/status` | Browser only — a **frontend** page, not a backend route |

The redirect proves nothing. Only the webhook grants the plan.

---

### Step 6: Confirm the payment landed
- **Method:** `GET`
- **URL:** `/subscriptions/orders/<ORDER_ID>`
- **Headers:** `Authorization: Bearer <STYLIST_TOKEN>`
- **Expected Status:** `200 OK`
- **Verify:** `status` is `"paid"`. This is what the frontend polls after the redirect returns.
- **Negative case:** the same URL with another user's token → `403`. A malformed id → `400`.

---

### Step 7: Verify the plan is live
- **Method:** `GET`
- **URL:** `/subscriptions/me`
- **Headers:** `Authorization: Bearer <STYLIST_TOKEN>`
- **Expected Status:** `200 OK`
- **Verify:** `plan.code` is `stylist.pro`, and `subscription.currentPeriodEnd` is ~30 days out
  (~365 for a yearly purchase). Entitlements now show the Pro capacity.

---

### Step 8: Schedule a downgrade
- **Method:** `POST`
- **URL:** `/subscriptions/subscribe`
- **Headers:** `Authorization: Bearer <STYLIST_TOKEN>`
- **Request Body:**
```json
{ "planCode": "stylist.basic" }
```
- **Expected Status:** `200 OK` with `scheduled: true`
- **Why this is not a 402:** a downgrade grants nothing today. It records a choice the renewal
  sweep applies once the period already paid for runs out, so Pro stays live until `effectiveAt`.

---

### Step 9: Cancel Auto-Renewal
- **Method:** `POST`
- **URL:** `/subscriptions/cancel`
- **Headers:** `Authorization: Bearer <STYLIST_TOKEN>`
- **Expected Status:** `200 OK`
- **Effect:** Plan remains active until `currentPeriodEnd`, then the daily sweep reverts it to Free.

> **Note — there is no recurring billing.** `subscription-renewal.cron.js` is an expiry sweep: it
> downgrades lapsed plans to Free and promotes scheduled downgrades. Paymob recurring billing is not
> integrated, so a paid subscriber must run Steps 4–6 again each period.

---

## 🛡️ PHASE 4: Content Moderation and Account Blocking

---

### Step 1: Admin Adds Word to Blocklist
- **Method:** `POST`
- **URL:** `/admin/moderation/blocked-words`
- **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
- **Request Body:**
```json
{
  "word": "offplatformdeal",
  "language": "en",
  "category": "HARASSMENT",
  "severity": "HIGH"
}
```
- **Expected Status:** `201 Created`

---

### Step 2: Admin Bulk Adds Blocked Words
- **Method:** `POST`
- **URL:** `/admin/moderation/blocked-words/bulk`
- **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
- **Request Body:**
```json
{
  "words": [
    { "word": "شتيمة1", "language": "ar", "category": "INSULT", "severity": "CRITICAL" },
    { "word": "شتيمة2", "language": "ar", "category": "PROFANITY", "severity": "MEDIUM" }
  ]
}
```
- **Expected Status:** `201 Created`

---

### Step 3: Test Real-Time Scanner and Auto-Strike
- **Method:** `POST`
- **URL:** `/chat/{{BOOKING_ID}}/messages`
- **Headers:** `Authorization: Bearer <CLIENT_TOKEN>`
- **Request Body:**
```json
{
  "content": "Call me on 01012345678 or contact offplatformdeal to pay cash directly.",
  "type": "text"
}
```
- **Expected Status:** `400 Bad Request` or Blocked (Under ENFORCE mode)
- **Effect:** ModerationEvent created, Strike applied to account.

---

### Step 4: Admin Blocks User Account Permanently
- **Method:** `POST`
- **URL:** `/admin/users/{{STYLIST_ID}}/block`
- **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
- **Request Body:**
```json
{
  "reason": "Severe policy violation: off-platform payment solicitation"
}
```
- **Expected Status:** `200 OK`
- **Effect:**
  - `accountStatus` becomes `blocked`.
  - `tokenVersion` incremented.
  - All existing tokens for this user return `403 Forbidden` immediately.

---

### Step 5: Admin Unblocks User Account
- **Method:** `POST`
- **URL:** `/admin/users/{{STYLIST_ID}}/unblock`
- **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
- **Request Body:**
```json
{
  "notes": "Appeal accepted after written compliance confirmation."
}
```
- **Expected Status:** `200 OK`
- **Effect:** `accountStatus` restored to `active`.

---

## 📊 PHASE 5: Financial Ledger and Platform Integrity Audit

---

### Step 1: Admin Queries Double-Entry Journal Statements
- **Method:** `GET`
- **URL:** `/admin/ledger/statements?bookingId={{BOOKING_ID}}`
- **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
- **Expected Status:** `200 OK`
- **Verify:** Returns balanced debits and credits for:
  - `ESCROW_HOLD`
  - `COMMISSION_ACCRUED`
  - `ESCROW_RELEASE`
  - `PAYOUT_DISBURSED`

---

### Step 2: Admin Runs Real-Time Ledger Reconciliation Audit
- **Method:** `POST`
- **URL:** `/admin/ledger/reconcile`
- **Headers:** `Authorization: Bearer <ADMIN_TOKEN>`
- **Expected Status:** `200 OK`
- **Verify:** Returns `{ "isReconciled": true, "discrepancies": [] }`.

---

## 💳 PHASE 6: Subscriptions & Plan Billing Lifecycle (Paymob Checkout & Webhook)

---

### Step 1: List Available Plans
- **Method:** `GET`
- **URL:** `/subscriptions/plans?role=client`
- **Expected Status:** `200 OK`
- **Verify:** Returns active client plans (`client.free`, `client.basic`, `client.mid`, `client.pro`, `client.enterprise`).

---

### Step 2: Query Current Subscription & Quotas
- **Method:** `GET`
- **URL:** `/subscriptions/me`
- **Headers:** `Authorization: Bearer <CLIENT_TOKEN>`
- **Expected Status:** `200 OK`
- **Verify:** Returns default `client.free` subscription with daily usage and capacity meters.

---

### Step 3: Initiate Paid Plan Checkout (Paymob Unified Checkout)
- **Method:** `POST`
- **URL:** `/subscriptions/checkout`
- **Headers:** `Authorization: Bearer <CLIENT_TOKEN>`
- **Request Body:**
```json
{
  "planCode": "client.pro",
  "billingCycle": "monthly"
}
```
- **Expected Status:** `200 OK`
- **Action:** Save `orderId` and `specialReference` from response. Copy `paymentUrl` to complete payment on Paymob or simulate webhook in Step 4.

---

### Step 4: Paymob Webhook Payment Confirmation (Simulated / Live)
- **Method:** `POST`
- **URL:** `/subscriptions/webhook`
- **Request Body (Mock Mode):**
```json
{
  "secret": "dev_mock_webhook_secret",
  "special_reference": "{{SPECIAL_REFERENCE}}",
  "status": "paid",
  "transactionId": "paymob_sub_tx_101"
}
```
- **Expected Status:** `200 OK`
- **Effect:**
  - `SubscriptionOrder` status becomes `paid`.
  - User's subscription promoted to `client.pro`.
  - `currentPeriodEnd` set to 30 days in future.
  - Double-entry ledger records `SUBSCRIPTION_PAYMENT` (client DEBIT) and `PLATFORM_FEE` (platform CREDIT).

---

### Step 5: Verify Order Status
- **Method:** `GET`
- **URL:** `/subscriptions/orders/{{ORDER_ID}}`
- **Headers:** `Authorization: Bearer <CLIENT_TOKEN>`
- **Expected Status:** `200 OK`
- **Verify:** Returns `{ "status": "paid", "planCode": "client.pro", "paidAt": "..." }`.

---

### Step 6: Verify Upgraded Entitlements
- **Method:** `GET`
- **URL:** `/subscriptions/me`
- **Headers:** `Authorization: Bearer <CLIENT_TOKEN>`
- **Expected Status:** `200 OK`
- **Verify:**
  - `planCode`: `client.pro`
  - `status`: `active`
  - `requests.daily`: 4
  - `ai.messages.daily`: 80

---

### Step 7: Schedule Downgrade (Pro -> Basic)
- **Method:** `POST`
- **URL:** `/subscriptions/subscribe`
- **Headers:** `Authorization: Bearer <CLIENT_TOKEN>`
- **Request Body:**
```json
{
  "planCode": "client.basic",
  "billingCycle": "monthly"
}
```
- **Expected Status:** `200 OK`
- **Verify:** Returns `{ "scheduled": true, "effectiveAt": "..." }`. The user keeps Pro privileges until `currentPeriodEnd`.

---

### Step 8: Schedule Cancellation of Paid Subscription
- **Method:** `POST`
- **URL:** `/subscriptions/cancel`
- **Headers:** `Authorization: Bearer <CLIENT_TOKEN>`
- **Expected Status:** `200 OK`
- **Verify:** Returns `cancelAtPeriodEnd: true`. The plan stays active until period end, then reverts to Free.

---

*Manual End-to-End Testing Guide verified against Murafiq API specification.*

