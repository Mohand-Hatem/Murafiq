# Phase 2 — User Profiles & Identity Verification

## Goal
Extend the `User` model with full profile data, add profile completion endpoints, and build the National ID identity verification flow (upload → pending → admin approves/rejects).

## Depends on
Phase 1 (base User model + auth middleware).

---

## Steps

### 1. Extend `user.model.js`
Add to the schema created in Phase 1:
```js
profileImage: { type: String, default: DEFAULT_PROFILE_IMAGE_URL }, // shared by client + stylist — see common/constants/defaults.constant.js
country: String,
governorate: String,
city: String,
area: String,
location: {
  type: { type: String, enum: ['Point'], default: 'Point' },
  coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
},
verification: {
  // 'unverified' = user has not yet uploaded any documents (skipped or not started).
  // 'pending'    = documents uploaded, awaiting admin/operator review.
  // 'verified'   = approved by admin or operator.
  // 'rejected'   = rejected with a reason; user may re-upload.
  // A client with status !== 'verified' cannot create requests.
  // A stylist with status !== 'verified' cannot send offers.
  status: { type: String, enum: ['unverified', 'pending', 'verified', 'rejected'], default: 'unverified' },
  documents: [{
    // Required document set differs by role (enforced in the service layer, not the schema):
    //   client  → national_id_front, national_id_back, selfie_with_id  (3 docs)
    //   stylist → the same 3 + police_clearance_certificate            (4 docs)
    type: { type: String, enum: ['national_id_front', 'national_id_back', 'selfie_with_id', 'police_clearance_certificate'] },
    url: String,
    uploadedAt: { type: Date, default: Date.now },
  }],
  rejectionReason: String,
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' }, // admin or operator who actioned this
  reviewedAt: Date,
},
isOnline: { type: Boolean, default: false },
// Aggregate rating as a client — mirrors StylistProfile.rating/totalReviews (Phase 3), but lives on
// User since only stylists have a StylistProfile; every account can be reviewed as a client (Phase 8).
clientRating: { type: Number, default: 0 },
clientTotalReviews: { type: Number, default: 0 },
// Total completed bookings as a client — mirrors StylistProfile.completedSessions (Phase 3).
// Incremented by the reviews module when a SessionCompleted event fires (Phase 8).
completedBookings: { type: Number, default: 0 },
```
Add a `2dsphere` index on `location`:
```js
userSchema.index({ location: '2dsphere' });
```

> **Why an array instead of fixed fields?** `verification.documents` holds three entries today (`national_id_front`, `national_id_back`, `selfie_with_id`), but stays open to adding another document type later (e.g. proof of address) with no schema migration — just a new enum value. Both clients and stylists use this same structure; identity verification lives on `User`, not on the stylist profile.

> **Default profile photo:** `profileImage` defaults to `DEFAULT_PROFILE_IMAGE_URL`, a constant defined in `common/constants/defaults.constant.js` pointing at a single placeholder image pre-uploaded to Cloudinary (e.g. `murafiq/defaults/avatar`). Every new user — client or stylist — has a real, displayable photo from the moment they register, with no null-check needed on the frontend. `PATCH /users/me/profile-image` (Phase 9, once uploads are wired) replaces it with the user's real Cloudinary upload; nothing else about the field changes.

### 2. Profile endpoints (`user.controller.js` / `user.service.js`)
- `GET /users/me` — current user's full profile.
- `PATCH /users/me` — update name/phone/location/addresses (not email/role/verification — those have separate controlled flows).
- `PATCH /users/me/verification-documents` — upload verification documents in one call (uses `uploads` module from Phase 9 — for now, accept the Cloudinary URLs as strings; wire actual upload middleware in Phase 9 without changing this contract). Appends each as a `{ type, url }` entry to `verification.documents` and sets `verification.status: 'pending'`. Required document set differs by role: clients must upload `national_id_front`, `national_id_back`, `selfie_with_id` (3 docs); stylists must also upload `police_clearance_certificate` (4 docs total). Enforce this in the service layer, not the schema. Users who have never called this endpoint remain at `verification.status: 'unverified'` — this is the "skipped" state, distinguishable from `pending` (uploaded, awaiting review).
- `PATCH /users/me/profile-image` — upload/replace the profile photo (same Phase 9 uploads contract — accept a Cloudinary URL for now, real Multer/Cloudinary middleware wired in Phase 9). Sets `profileImage` to the new URL. If the user later wants to remove their photo, this endpoint (or a `DELETE /users/me/profile-image`) resets `profileImage` back to `DEFAULT_PROFILE_IMAGE_URL` rather than storing `null`.

### 2a. Location capture (Google Maps contract)
Google Maps integration is a **frontend** concern — the backend never calls Google's APIs. Contract:
- Frontend renders a Google Maps/Places picker and sends `{ lat, lng, formattedAddress }` (plus optionally discrete `country/governorate/city/area` if the frontend's Places response can split them) in the body of `PATCH /users/me`.
- Backend validates `lat` ∈ [-90, 90] and `lng` ∈ [-180, 180], then builds `location: { type: 'Point', coordinates: [lng, lat] }` — note the `[lng, lat]` order GeoJSON requires, the reverse of how Google returns them.
- No server-side reverse-geocoding call and no `GOOGLE_MAPS_API_KEY` needed for this flow — if `country/governorate/city/area` aren't sent by the frontend, they simply stay unset and can be filled in later via `PATCH /users/me`.
- Same contract applies to `Request.meetingLocation` in Phase 4 — `{ address, lat, lng }` sent as-is from the frontend's map picker.
- Whenever `PATCH /users/me` changes `location`/`country`/`governorate`/`city`/`area`, emit `UserLocationUpdated({ userId, location, country, governorate, city, area })` on the event bus (define in `common/constants/events.constant.js` here, even though nothing listens until Phase 3). Phase 3's stylist module listens on it to keep the denormalized location copy on `StylistProfile` in sync — see `PHASE_03_STYLISTS_SEARCH.md` step 1a. For a client, the event fires but has no listener side-effect (no `StylistProfile` exists).

### 3. Admin/operator verification endpoints
These live in `admin.controller.js` (module folder exists now, full admin module completes in Phase 10 — build just these routes here since verification is a Phase 2 business rule):
- `GET /admin/verifications?status=pending` — uses `QueryBuilder` (filters on `verification.status`). Accepts `status` values: `unverified`, `pending`, `verified`, `rejected`.
- `PATCH /admin/verifications/:userId/approve` — sets `verification.status = 'verified'`, `verification.reviewedBy = req.user.id`, `verification.reviewedAt = now`.
- `PATCH /admin/verifications/:userId/reject` (with `rejectionReason`) — sets `verification.status = 'rejected'`, `verification.rejectionReason`, `verification.reviewedBy`, `verification.reviewedAt`.

> **Access control:** these three routes are gated with `restrictTo('admin', 'operator')` — they are the **only** routes an `operator` can access. An operator cannot suspend users, resolve disputes, manage payouts, or take any other admin action. All other `/admin/*` routes remain `restrictTo('admin')` only. The `operator` role exists solely to offload identity-verification review from admins without granting any broader platform management capability.

### 4. Business rule enforcement
- Only users with `verification.status: 'verified'` can: create requests (clients), send offers (stylists). Users who skipped verification remain at `'unverified'` and are blocked just as firmly as those with `'pending'` or `'rejected'` status. Enforce this check inside the **service layer** of `requests`/`offers` in Phase 4 — note it here so it isn't forgotten.
- The `'unverified'` default state is intentional and visible to admin/operator dashboards so they can distinguish "never submitted" from "submitted but awaiting review".
- Wrap the admin approve/reject action in a MongoDB transaction only if it triggers multiple writes (e.g. verification + notification + audit log in one go); a single-document update alone doesn't need one.

### 5. Domain event
Emit `UserVerified` (and `UserVerificationRejected`) on the event bus after admin action — Phase 10's audit-log listener and Phase 7's notification listener will pick these up later. Define the event now in `common/constants/events.constant.js` even though nothing listens yet.

### 6. Soft delete
`DELETE /users/me` sets `isDeleted: true, accountStatus: 'deleted', deletedAt: now` — never a real Mongo delete. Add a global Mongoose query middleware (`pre('find')`, `pre('findOne')`) that excludes `isDeleted: true` documents by default.

> **`email`/`phone` stay permanently reserved after soft delete** — a deliberate safety-first default, not an oversight. Since `email`/`phone` are `unique` on the live index and soft-deleted documents are never physically removed, a deleted user's identifiers can never be reused to re-register, which prevents a suspended/banned user from evading enforcement by deleting and recreating an account under the same email. There is currently no re-registration or account-reactivation flow — if that's needed later, it should be an explicit admin action (e.g. a hard-delete or an anonymize-and-free-identifiers endpoint), not an automatic one.

---

## Definition of Done

- [ ] A brand-new user (before any upload) has `profileImage` set to `DEFAULT_PROFILE_IMAGE_URL`, never `null`/empty.
- [ ] `PATCH /users/me/profile-image` replaces it with the uploaded Cloudinary URL; removing the photo resets it to the default, not `null`.
- [ ] A verified test user can complete their full profile via `PATCH /users/me`.
- [ ] A new user has `verification.status: 'unverified'` by default (never `null` or `'pending'`) until they upload documents.
- [ ] Uploading documents sets `verification.status` to `'pending'`; each document entry visible in the admin/operator listing.
- [ ] Client uploading documents must supply exactly the 3 required types; stylist must supply the 3 + `police_clearance_certificate` (service rejects an incomplete set with a clear validation error).
- [ ] Admin and operator can both approve/reject verifications (`GET /admin/verifications`, `PATCH .../approve`, `PATCH .../reject`). Approve/reject stamps `reviewedBy`/`reviewedAt` (and `rejectionReason` on reject), emits `UserVerified`/`UserVerificationRejected`.
- [ ] An operator token on any `/admin/*` route *other than* the three verification routes gets `403`.
- [ ] A client token on any `/admin/*` route gets `403`.
- [ ] 2dsphere index confirmed via `db.users.getIndexes()`.
- [ ] `PATCH /users/me` with a valid `{ lat, lng }` correctly stores `location.coordinates` as `[lng, lat]`; out-of-range values are rejected.
- [ ] `PATCH /users/me` changing location emits `UserLocationUpdated` on the event bus (check via a test event listener) — even before Phase 3 has anything listening.
- [ ] Soft-deleted users never appear in normal `find()` queries anywhere in the app.
- [ ] Unit + integration tests for profile update, verification approve/reject, and soft delete.
- [ ] Every new route in this phase has an @swagger JSDoc block covering summary, request body, and response codes; /api/docs renders it without errors.
