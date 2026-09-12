# Phase 8 — Reviews & Ratings

## Goal
**Two-way** reviews per completed booking — client rates stylist, and stylist rates client — keeping the stylist's aggregate `rating`/`totalReviews` (fields already reserved on `stylist_profiles` in Phase 3) and the client's aggregate `clientRating`/`clientTotalReviews` (`User` model, `PHASE_02_USERS_VERIFICATION.md`) in sync automatically. Two-way is deliberate: a client with a history of no-shows/cancellations should be visible to a stylist deciding whether to accept a request (Mostaql/Upwork-style mutual trust), not just the reverse.

## Depends on
Phase 5 (`SessionCompleted` event).

---

## Steps

### 1. `review.model.js`
```js
const reviewSchema = new Schema({
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
  raterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },     // who wrote it
  revieweeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },  // who it's about
  direction: { type: String, enum: ['client_to_stylist', 'stylist_to_client'], required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: String,
  isHidden: { type: Boolean, default: false }, // admin moderation, see step 5
}, { timestamps: true });

reviewSchema.index({ bookingId: 1, direction: 1 }, { unique: true }); // one review per direction per booking — the actual enforcement mechanism, don't rely on service-layer checks alone
```

### 2. Endpoints
- `POST /bookings/:bookingId/review` — either participant of the booking, once it's `status: 'completed'`; direction is inferred from the caller's role relative to the booking (`clientId` calling → `client_to_stylist`, `stylistId` calling → `stylist_to_client`), never sent by the client as a raw field. Blocked if that direction's review already exists for this booking (catch the duplicate-key error on `{bookingId, direction}` and return a clean `409`) — the other direction is independently still open.
- `GET /stylists/:id/reviews` — public, paginated (QueryBuilder), `direction: 'client_to_stylist'` only, excludes `isHidden: true`.
- `GET /reviews/mine` — the caller's own submitted reviews (either direction, whichever role they were acting as).

### 3. Rating aggregation — event-driven, one listener per direction
On `EVENTS.REVIEW_SUBMITTED` (the real constant — this file previously said `REVIEW_CREATED`, which was never defined in `events.constant.js`), recalculate the relevant party's rolling average (don't just increment/average incrementally with float drift — recompute from source periodically, or use a safe running-average formula), filtered by `direction` and excluding `isHidden`:
```js
eventBus.on(EVENTS.REVIEW_SUBMITTED, async ({ revieweeId, direction }) => {
  if (direction === 'client_to_stylist') {
    const stats = await Review.aggregate([
      { $match: { revieweeId, direction, isHidden: false } },
      { $group: { _id: '$revieweeId', avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    await StylistProfile.updateOne(
      { userId: revieweeId },
      { rating: stats[0]?.avgRating || 0, totalReviews: stats[0]?.count || 0 }
    );
  } else {
    const stats = await Review.aggregate([
      { $match: { revieweeId, direction, isHidden: false } },
      { $group: { _id: '$revieweeId', avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    await User.updateOne(
      { _id: revieweeId },
      { clientRating: stats[0]?.avgRating || 0, clientTotalReviews: stats[0]?.count || 0 }
    );
  }
});
```
This closes the `// TODO: Phase 8` left in `stylist-search.service.js` from Phase 3 (for the `client_to_stylist` half). Re-run the same aggregation when an admin hides/unhides a review (step 5), since `isHidden` changes what counts.

### 4. Completed-booking counters
On `SessionCompleted` (Phase 5's event), increment **both**:
- `StylistProfile.completedSessions` — the stylist's count of completed sessions.
- `User.completedBookings` (on the **client** user document) — the client-side equivalent added in Phase 2.

Trigger both off `SessionCompleted`, not `ReviewCreated`, since a completed session doesn't require a review to count as completed.

> **Note on the reviews design:** The intent behind "each user has a history of feedback from the other party" is fully satisfied here by the `Review` collection, which is queryable per user (`raterId` or `revieweeId`) and supports pagination, moderation/hiding, and aggregation. The rolling averages (`clientRating`/`clientTotalReviews` on `User`, `rating`/`totalReviews` on `StylistProfile`) make ratings instantly readable without scanning every review document on every profile load.

### 5. Admin moderation
`PATCH /admin/reviews/:id/hide` (`PHASE_10_AUDIT_ADMIN.md`) sets `isHidden: true` on an abusive/fake review and re-runs the aggregation in step 3 for that review's `revieweeId`/`direction` so the hidden review stops counting toward the rating average immediately, not just from the public listing.

---

## Definition of Done

- [x] Reviewing an incomplete booking → rejected with clear error (400 Bad Request).
- [x] A client and stylist can each leave one review on the same completed booking — both succeed independently.
- [x] Attempting a second review in the *same* direction on the same booking → `409 Conflict`, no duplicate document created; the other direction remains open.
- [x] Stylist's `rating`/`totalReviews` update correctly and immediately after a `client_to_stylist` review is created; a client's `clientRating`/`clientTotalReviews` update correctly after a `stylist_to_client` review.
- [x] `completedSessions` increments on session completion independent of whether either review was ever left.
- [x] Public review listing never exposes the reviewer's sensitive fields (only name/avatar via a mapper), and never includes `isHidden: true` reviews.
- [x] Hiding a review via `PATCH /admin/reviews/:id/hide` immediately drops it from the public listing and recalculates the affected rating average.
- [x] Every new route in this phase has an @swagger JSDoc block covering summary, request body, and response codes; /api/docs renders it without errors.
