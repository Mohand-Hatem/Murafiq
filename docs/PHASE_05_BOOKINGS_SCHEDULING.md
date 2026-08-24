# Phase 5 — Bookings & Scheduling (Transactions)

## Goal
The core transactional heart of the system: turn an accepted offer into a Booking, block the stylist's schedule, prevent double-booking, and lay the fields needed later for payment release, session check-in, and cancellation.

## Depends on
Phase 4 (Offer/Request models and accept flow).

---

## Steps

### 1. `booking.model.js`
```js
const bookingSchema = new Schema({
  requestId: { type: Schema.Types.ObjectId, ref: 'Request', required: true },
  offerId: { type: Schema.Types.ObjectId, ref: 'Offer', required: true },
  clientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  scheduledDate: { type: Date, required: true },
  // ⚠️ Time stored as integer minutes-since-midnight (e.g. 10:00 → 600, 13:30 → 810)
  // NEVER store as String — lexicographic comparison breaks overlap detection.
  scheduledStartMinute: { type: Number, required: true }, // derived from request.time
  scheduledEndMinute:   { type: Number, required: true }, // scheduledStartMinute + offer.duration
  meetingLocation: { address: String, lat: Number, lng: Number },
  price: Number,
  duration: Number, // minutes
  status: {
    type: String,
    enum: ['confirmed', 'in-progress', 'completed', 'cancelled', 'disputed'],
    default: 'confirmed',
  },
  // Session verification (see Phase 11 for safety-related fields too)
  checkInAt: Date,
  checkInLocation: { lat: Number, lng: Number },
  clientConfirmedAt: Date,
  stylistConfirmedAt: Date,
  // Safety (Phase 11)
  liveTrackingEnabled: { type: Boolean, default: false },
  // Cancellation
  cancelledBy: { type: String, enum: ['client', 'stylist', 'admin'] },
  cancellationReason: String,
  cancelledAt: Date,
}, { timestamps: true });

// Compound index for double-booking guard queries
bookingSchema.index({ stylistId: 1, scheduledDate: 1, scheduledStartMinute: 1, scheduledEndMinute: 1 });
```

> ⚠️ **Time Storage Convention:** All start/end time values throughout this module are stored as **integer minutes since midnight**. Use the helper `timeToMinutes(str)` from `common/utils/timeUtils.js`:
> ```js
> // common/utils/timeUtils.js
> const timeToMinutes = (timeStr) => {
>   const [h, m] = timeStr.split(':').map(Number);
>   return h * 60 + m;
> };
> const minutesToTime = (mins) =>
>   `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
> module.exports = { timeToMinutes, minutesToTime };
> ```
> The `Request` model stores `time` as a `String` (user input "10:00"). Convert it to minutes when creating the booking/schedule block — never store the raw string in booking/schedule fields.

### 2. `schedule.model.js` (blocked slots)
```js
const scheduleBlockSchema = new Schema({
  stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
  date: { type: Date, required: true },
  // Integer minute-offsets — same convention as booking.model.js
  startMinute: { type: Number, required: true }, // e.g. 600 = 10:00
  endMinute:   { type: Number, required: true }, // e.g. 780 = 13:00
}, { timestamps: true });

scheduleBlockSchema.index({ stylistId: 1, date: 1 });
```

### 3. The transaction — `booking.service.js#createBookingFromOffer()`
Called from `offer.service.js#acceptOffer()` (Phase 4), inside one Mongoose session:

```js
async function createBookingFromOffer(offerId, session) {
  const offer = await Offer.findById(offerId).session(session);
  const request = await Request.findById(offer.requestId).session(session);

  // 1. Double-booking guard — check for an overlapping block BEFORE creating
  const startMinute = timeToMinutes(request.time);         // e.g. "10:00" → 600
  const endMinute   = startMinute + offer.duration;         // e.g. 600 + 120 = 720

  const overlap = await ScheduleBlock.findOne({
    stylistId: offer.stylistId,
    date: request.date,
    startMinute: { $lt: endMinute },   // existing block starts before our end
    endMinute:   { $gt: startMinute }, // existing block ends after our start
  }).session(session);
  if (overlap) throw new ApiError(409, 'This time slot was just taken');

  // 2. Create booking
  const [booking] = await Booking.create([{
    requestId: request._id, offerId: offer._id,
    clientId: request.clientId, stylistId: offer.stylistId,
    scheduledDate: request.date,
    scheduledStartMinute: startMinute,  // integer minutes (computed above)
    scheduledEndMinute:   endMinute,    // integer minutes (computed above)
    meetingLocation: request.meetingLocation,
    price: offer.price, duration: offer.duration,
  }], { session });

  // 3. Update request + offer status
  request.status = 'accepted'; await request.save({ session });
  offer.status = 'accepted'; await offer.save({ session });

  // 4. Block the schedule
  await ScheduleBlock.create([{
    stylistId: offer.stylistId, bookingId: booking._id,
    date: request.date,
    startMinute,   // already computed above
    endMinute,     // already computed above
  }], { session });

  // 5. Create a Pending payment record (Phase 6 model — created here, not paid yet)
  await Payment.create([{
    bookingId: booking._id, clientId: request.clientId,
    amount: offer.price, status: 'pending',
  }], { session });

  // 6. Create the conversation shell (Phase 7 — opens once payment succeeds, per business rule; created now, "locked" until PaymentSucceeded)
  await Conversation.create([{
    bookingId: booking._id, participants: [request.clientId, offer.stylistId], isOpen: false,
  }], { session });

  return booking;
}
```

The **top-level transaction wrapper** (in `offer.service.js`):
```js
async function acceptOffer(offerId, clientId) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    // ownership + expiry checks...
    const booking = await bookingService.createBookingFromOffer(offerId, session);
    await session.commitTransaction();
    eventBus.emit(EVENTS.OFFER_ACCEPTED, { offerId, bookingId: booking._id });
    eventBus.emit(EVENTS.BOOKING_CREATED, { bookingId: booking._id });
    return booking;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}
```

### 4. Session completion (mutual confirmation)
- `PATCH /bookings/:id/check-in` — either party marks arrival (`checkInAt`, `checkInLocation`).
- `PATCH /bookings/:id/confirm-completion` — sets `clientConfirmedAt` or `stylistConfirmedAt` depending on caller's role.
- Service logic: when **both** confirmation fields are set → `status = 'completed'` → emit `SessionCompleted` (Phase 11's payout-eligibility aggregation is the actual money-side consumer — see step 4a; Phase 8 listens to unlock reviews).
- If only one side confirms after a grace period (e.g. 24h) with no matching confirmation, or either party explicitly disputes the session (step 4a) → `status = 'disputed'`, surfaced to admin (Phase 10).

### 4a. Filing a dispute (the entry point — resolution already exists in Phase 10, this was the missing half)
- `POST /bookings/:id/dispute` — client or stylist, booking must be `in-progress` (checked in) or the `scheduledDate`/time has already passed; body: `{ reason, type }` where `type` is a free-form category (e.g. `'no_show'`, `'quality'`, `'other'`) used for admin triage, not a hard enum yet. Sets `Booking.status = 'disputed'`, emits `SessionDisputed`.
- **No-show reporting reuses this same endpoint** (`type: 'no_show'`) rather than a separate mechanism — there's no reliable automatic no-show detection (both parties could be present without ever tapping check-in due to a connectivity issue), so it's always reported by a party and confirmed by admin, same as any other dispute. See `PHASE_06_PAYMENTS.md` step 7/9 and `PHASE_10_AUDIT_ADMIN.md` step 3 for how admin resolution then drives the refund outcome.
- A booking already `disputed` cannot be disputed again (idempotent — return the existing dispute state, `409` on a duplicate filing attempt).

### 5. Cancellation
- `PATCH /bookings/:id/cancel` — validates who's cancelling and when, applies the cancellation policy:

| Who cancels | Timing | Refund to client | Platform keeps |
|---|---|---|---|
| Client | ≥24h before `scheduledDate`/time | 100% (`CANCELLATION_FULL_REFUND_HOURS = 24`) | 0% |
| Client | <24h before | 75% (`CANCELLATION_PARTIAL_REFUND_PERCENTAGE = 75`) | 25% |
| Client | no-show (reported via `POST /bookings/:id/dispute`, step 4a, and confirmed by admin) | 0% — stylist still gets their `stylistPayoutAmount` for the reserved slot | 100% (or distributed per admin resolution) |
| Stylist | any time / no-show | 100% automatic refund to client, regardless of timing | 0% |

  Both threshold values live as named constants in `common/constants/statuses.constant.js` (`CANCELLATION_FULL_REFUND_HOURS`, `CANCELLATION_PARTIAL_REFUND_PERCENTAGE`) — never hardcoded in the service, so they're one place to change. A client-initiated cancel is a direct `PATCH /bookings/:id/cancel` call; a no-show goes through the dispute flow (step 4a) instead, since it needs admin confirmation before the 0%-refund-to-client outcome is applied.
- On cancellation: release the `ScheduleBlock`, update `Booking.status`, set fields on `Payment` for refund (actual refund execution happens in Phase 6's payment service, per the table above), and emit `BookingCancelled` — the same event Phase 10's dispute-resolution "cancelled" outcome emits, so Phase 7's notification listener and the Firestore conversation-lock listener (`PHASE_07_CHAT_NOTIFICATIONS.md` step 5a) handle both paths identically.

---

## Definition of Done

- [x] Accepting an offer atomically creates: Booking, updates Request+Offer, creates ScheduleBlock, creates a `pending` Payment, creates a closed Conversation — all or nothing (kill the process mid-transaction in a test and confirm nothing partial persists).
- [x] Two overlapping accept attempts on the same slot — the second one fails with `409`, not a silent double-booking.
- [x] Mutual check-in/confirmation flow correctly transitions to `completed` only when both sides confirm.
- [x] Cancellation before/after the 24h threshold produces the correct 100%/75% refund flag on the Payment record; a stylist-initiated cancellation always produces a 100% refund flag regardless of timing.
- [x] `POST /bookings/:id/dispute` sets `status: 'disputed'` and emits `SessionDisputed`; a second dispute attempt on the same booking is rejected, not silently duplicated.
- [x] `SessionCompleted`, `SessionDisputed`, and `BookingCreated` events fire with correct payloads (assert via test listener).
- [x] Integration test simulating full request→offer→accept→check-in→mutual-confirm→completed flow.
- [x] Every new route in this phase has an @swagger JSDoc block covering summary, request body, and response codes; /api/docs renders it without errors.
