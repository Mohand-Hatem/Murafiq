# Phase 6 — Payments & Escrow (Provider Pattern: Mock & Paymob Test/Sandbox)

## Goal
Build the full payment and escrow domain (model, statuses, commission split, refund flow) against a **provider interface**, with a working `mock` provider and a `paymob` provider supporting Paymob's current Intention API in **Test/Sandbox** mode before production go-live (see `03_SKELETON_STATUS.md`).

## Depends on
Phase 5 (a `pending` Payment record is created during booking creation).

---

## 1. Money Representation & Precision Convention

> 💡 **Money Convention:**
> - All monetary amounts across database models, services, DTOs, and API responses are represented as **standard EGP decimal values with 2 decimal places** (e.g. `250.00`, `999.99`, `1500.00`).
> - We do **NOT** store integer piastres in the database or DTOs.
> - **Floating-Point Precision Safety:** To avoid floating-point drift in JS arithmetic, all monetary calculations (commission splits, percentages, refunds) use standard 2-decimal precision rounding helper:
>   ```js
>   const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;
>   ```
> - **Paymob Boundary:** Paymob expects amounts in smallest currency units (cents/piastres, e.g. `250.00 EGP → 25000 piastres`). The conversion (`Math.round(amount * 100)`) is handled strictly inside the `PaymobProvider` at the external network boundary, completely isolated from internal models, services, and API responses.

---

## 2. Data Model (`src/modules/payments/payment.model.js`)

```js
const paymentSchema = new Schema({
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
  clientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  currency: { type: String, default: 'EGP' },
  amount: { type: Number, required: true, min: 0 },              // Decimal EGP (e.g. 250.00)
  platformFeePercentage: { type: Number, default: 15 },          // Configurable (default 15%)
  platformFeeAmount: { type: Number, required: true },          // Decimal EGP (e.g. 37.50)
  stylistPayoutAmount: { type: Number, required: true },        // Decimal EGP (e.g. 212.50)
  status: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'cancelled', 'refunded'],
    default: 'pending',
  },
  refundAmount: { type: Number, default: 0 },                   // Decimal EGP (e.g. 250.00)
  refundReason: String,
  provider: { type: String, enum: ['mock', 'paymob'], default: 'mock' },
  providerTransactionId: String,
  providerIntentionId: String,
  paidAt: Date,
}, { timestamps: true });
```

---

## 3. Financial Calculation Rules

### A. Commission Calculation
Computed at payment-initialization / creation time:
```js
// amount is in decimal EGP (e.g. 1000.00)
const platformFeeAmount = round2(amount * (platformFeePercentage / 100));
const stylistPayoutAmount = round2(amount - platformFeeAmount);

// Invariant: platformFeeAmount + stylistPayoutAmount === amount exactly
```
*Example:*
- Session Amount = `1000.00 EGP`
- Platform Fee (15%) = `150.00 EGP`
- Stylist Payout = `850.00 EGP`
- `150.00 + 850.00 === 1000.00`

### B. Cancellation Refund Policy

| Who Cancels | Timing | Client Refund | Platform Keeps | Stylist Payout |
|---|---|---|---|---|
| **Client** | **≥ 24 hours** before session | **100%** (`refundAmount = amount`) | **0%** (`0.00 EGP`) | `0.00 EGP` |
| **Client** | **< 24 hours** before session | **75%** (`round2(amount * 0.75)`) | **25%** (`round2(amount * 0.25)`) | `0.00 EGP` |
| **Stylist** | **Any time** / no-show | **100%** (`refundAmount = amount`) | **0%** (`0.00 EGP`) | `0.00 EGP` |

*Example (Session Price = 1000.00 EGP):*
1. Client cancels 30 hours before session:
   - Client Refund = `1000.00 EGP`
   - Platform keeps = `0.00 EGP`
2. Client cancels 10 hours before session:
   - Client Refund = `750.00 EGP`
   - Platform keeps = `250.00 EGP`
3. Stylist cancels 2 hours before session:
   - Client Refund = `1000.00 EGP`
   - Platform keeps = `0.00 EGP`

---

## 4. Provider Architecture

```text
Payment Service
      │
      ▼
PaymentProviderInterface
      │
      ├── MockProvider      (Active: unit/integration testing & local dev)
      │
      └── PaymobProvider    (Active: Test/Sandbox integration & Production)
```

### Provider Interface (`providers/payment-provider.interface.js`)
```js
class PaymentProviderInterface {
  async initialize({ amount, bookingId, customer }) { throw new Error('Not implemented'); }
  async verify(transactionId) { throw new Error('Not implemented'); }
  async refund(transactionId, amount) { throw new Error('Not implemented'); }
  async handleCallback(payload) { throw new Error('Not implemented'); }
}
```

### Mock Provider (`providers/mock.provider.js`)
- Returns a simulated checkout URL: `https://mock-checkout.local/pay/${bookingId}`.
- Always succeeds in dev/test flows.

### Paymob Provider (`providers/paymob.provider.js`) — Current Intention API
- **Endpoint:** `POST https://accept.paymob.com/v1/intention/`
- **Auth:** `Authorization: Token ${env.PAYMOB_SECRET_KEY}`
- **Amount conversion:** Converts decimal EGP to piastres (`Math.round(amount * 100)`) strictly in the request payload.
- **HMAC verification:** Validates incoming webhook payload with HMAC-SHA512 using `env.PAYMOB_HMAC_SECRET`.
- **Refund API:** `POST https://accept.paymob.com/api/acceptance/void_refund/refund`.

---

## 5. Endpoints

- `POST /api/v1/payments/:bookingId/initialize` — Client only; booking must belong to client and Payment must be `pending`. Returns checkout URL / `client_secret`.
- `POST /api/v1/payments/callback` — Webhook endpoint called by Paymob / Mock provider; verifies HMAC signature, marks Payment as `paid`, and emits `PaymentSucceeded`.
- `GET /api/v1/payments/:bookingId/status` — Client, Stylist, or Admin; returns current payment status.
- `GET /api/v1/payments/history` — Client only; paginated list of own payments.
- `POST /api/v1/payments/:bookingId/refund` — Admin-triggered or automatic via qualifying cancellation.

---

## 6. Business Rules & Escrow Gate

1. **Booking Confirmation & Escrow Holding:**
   - Accepting an offer creates a `confirmed` booking and a `pending` Payment.
   - The funds are held in Escrow once `Payment.status === 'paid'`.
2. **Session Check-In Gate:**
   - Attempting to check in (`bookingService.checkIn`) to a booking whose Payment is not `paid` is **blocked with 400**.
3. **Chat Gate:**
   - The chat conversation stays locked until `PaymentSucceeded` is emitted.

---

## 7. Domain Events

- `EVENTS.PAYMENT_SUCCEEDED` — payload: `{ paymentId, bookingId, clientId, amount }`
- `EVENTS.PAYMENT_FAILED` — payload: `{ paymentId, bookingId, clientId, reason }`
- `EVENTS.PAYMENT_REFUNDED` — payload: `{ paymentId, bookingId, clientId, refundAmount, reason }`

---

## Definition of Done

- [x] Initializing a payment on someone else's booking → `403`.
- [x] Mock provider: full initialize → callback → `status: paid` flow works end-to-end.
- [x] `platformFeeAmount` + `stylistPayoutAmount` always sum to `amount` exactly (verified via unit test with decimal values).
- [x] All amounts in the DB and API responses are decimal EGP values (e.g. `250.00`, `750.00`).
- [x] Cancellation refund policy strictly follows the 100% (≥24h) / 75% (<24h) / 100% (stylist) breakdown.
- [x] Attempting to check in to a booking with an unpaid Payment is blocked (`400`).
- [x] Paymob Intention API initialization and HMAC webhook signature verification are covered with unit tests.
- [x] `PaymentSucceeded` event fires with correct payload.
- [x] Every new route in this phase has an `@swagger` JSDoc block; `/api/docs` renders without errors.
- [x] Automated tests pass with 100% green status.
