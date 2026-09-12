# Phase 3 — Stylist Profiles & Search

## Goal
A separate `stylist_profiles` collection (linked to `users`) holding stylist-only data, plus a full search endpoint with pagination, filters, sorting, text search, field selection, and geo-nearby lookup.

## Depends on
Phase 2 (verified users, location on User model).

---

## Steps

### 1. `stylist-profile.model.js`
```js
const stylistProfileSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  // Specialty the stylist offers. 2 confirmed values — a 3rd may be added later; do not invent a placeholder.
  specialty: { type: String, enum: ['stylist', 'personal_shopper'] },
  bio: String,                        // Self-description (who the stylist is as a person/professional)
  serviceDescription: String,         // Description of what the stylist's service actually involves
  experienceYears: Number,
  languages: [String],
  services: [String],
  // Currency is EGP (Egyptian Pound). Minimum enforced at both schema and Zod-validator level; the platform does not permit hourly rates below 100 EGP.
  hourlyPrice: { type: Number, min: 100, required: true },
  portfolio: [String], // Cloudinary URLs
  workingAreas: [String],
  weeklyAvailability: [{
    day: { type: String, enum: ['sat','sun','mon','tue','wed','thu','fri'] },
    startTime: String, // "10:00"
    endTime: String,   // "18:00"
  }],
  rating: { type: Number, default: 0 },
  totalReviews: { type: Number, default: 0 },
  completedSessions: { type: Number, default: 0 },
  gender: { type: String, enum: ['male', 'female'] },

  // Denormalized copy of location fields from User — NOT user-editable directly here,
  // kept in sync by the write path in step 1a. Exists purely so search (step 3) can
  // filter/geo-query stylist_profiles directly without a $lookup join on every request.
  country: String,
  governorate: String,
  city: String,
  area: String,
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
  },
  locationSet: { type: Boolean, default: false }, // true once synced from a real (non-default) User.location — see step 1a and step 3/4
}, { timestamps: true });

stylistProfileSchema.index({ location: '2dsphere' });
```

### 1a. Keeping the denormalized location in sync
`User.location/country/governorate/city/area` (Phase 2) stays the single source of truth — the copy on `stylist_profiles` is a read-optimization only, never edited directly by the client. Two write paths keep it current:
- **On profile create/update** (`POST /stylists/profile`, `PATCH /stylists/profile`): `stylist.service.js` reads the current values off `req.user`'s `User` document and copies them onto the `StylistProfile` being saved. Set `locationSet: true` only if `User.location.coordinates` is not the default `[0, 0]` — a stylist who completes their profile before ever setting a real address still gets a `StylistProfile`, just with `locationSet: false`.
- **On a later address change**: `PATCH /users/me` (Phase 2) already updates `User.location`/`country`/`city`. When it does, `user.service.js` emits a new domain event `UserLocationUpdated({ userId, location, country, governorate, city, area })` (define in `events.constant.js`). The `stylists` module registers a listener that, if that `userId` has a `StylistProfile`, updates its denormalized copy (and flips `locationSet: true`, since a real `PATCH /users/me` location update is never the `[0,0]` default) — a no-op for clients, since they have no `StylistProfile` to update.

### 2. Stylist profile endpoints
- `POST /stylists/profile` — create/complete stylist profile (role must be `stylist`).
- `PATCH /stylists/profile` — update own profile.
- `GET /stylists/:id` — public profile view via a **public mapper** (see §2a below).

Both `POST /stylists/profile` and `PATCH /stylists/profile` must validate `hourlyPrice` in `stylist.validator.js` using Zod: `z.number().min(100, 'Hourly rate must be at least 100 EGP')`.

### 2a. Public stylist mapper (privacy rule)
Clients must never see a stylist's email, phone, or any auth-sensitive field. All `GET /stylists` and `GET /stylists/:id` responses go through `stylist.dto.js#toPublicStylist()`, which exposes only:
- `id`, `nameEn`, `nameAr`, `profileImage`
- `specialty`, `bio`, `serviceDescription`
- `rating`, `totalReviews`, `completedSessions`
- `hourlyPrice`, `weeklyAvailability`, `workingAreas`, `languages`
- `country`, `governorate`, `city`, `area` (location label, not raw coordinates)
- `experienceYears`, `gender`, `portfolio`

Never include: `email`, `phone`, `passwordHash`, `otpCode`, `otpExpiresAt`, `refreshTokenHash`, `googleId`, `accountStatus`, `isDeleted`, `verification.documents` URLs, or any other sensitive User field. The populate call to `User` must use an explicit `.select()` projection — do not rely on `select: false` being sufficient (a careless future `.populate('userId')` without a projection would leak everything).

### 3. Search endpoint (`stylist-search.service.js`)
`GET /stylists` — built on top of Phase 0's `QueryBuilder`, extended with:
- Standard filters: `country, governorate, city, area, gender, specialty, verified, minRating, minPrice, maxPrice, minExperience, services`. All filter directly against `stylist_profiles` — including `country/governorate/city/area`, thanks to the denormalized copy from step 1a — no join needed. *(Note on `minPrice`: `minPrice` filter values below 100 EGP in query params are technically legal but return the same result set as `minPrice=100`, since no stylist can have a rate < 100 EGP — note this in the endpoint's Swagger description).*
- **Specialty filter** (`?specialty=stylist` or `?specialty=personal_shopper`) — exact enum match, not a substring search.
- **Text search** (`?search=<term>`) — case-insensitive substring match across `['nameEn', 'nameAr', 'bio', 'serviceDescription']`. Pass these four fields to `QueryBuilder.search()` in `stylist-search.service.js`. This lets a client find a stylist by name or by keywords in their description.
- Availability filter: `?availableOn=mon&availableFrom=10:00&availableTo=14:00` — matches against `weeklyAvailability`.
- Geo "nearby" mode: `?lat=..&lng=..&radiusKm=..` uses `$geoNear` against `StylistProfile.location` directly (the denormalized copy from step 1a) — no `User` join required. **Excludes any profile with `locationSet: false`** — otherwise a newly verified stylist who hasn't set a real address yet has `[0,0]` coordinates and would surface as spuriously "nearby" to Null Island for every geo search regardless of the requester's actual location.
- Only return stylists where the linked user has `verification.status: 'verified'` and `accountStatus: 'active'` (this part **does** need the `User` join/lookup, since verification/account status isn't denormalized — only location fields are).

> **⚠️ v1 Availability Filter Limitation:** The `?availableOn` / `?availableFrom` / `?availableTo` filters match only against `weeklyAvailability` (the stylist's general working-hours preference). They do **not** cross-check `ScheduleBlock` records (real confirmed bookings) — that collection doesn't exist yet in this phase.
>
> This means a stylist who works Saturdays but is fully booked this specific Saturday will still appear in availability search results. This is a **known, accepted v1 limitation** — document it in the API response (e.g. a `availabilityNote` field) or at minimum in the Swagger description for this endpoint. Post Phase 5, the search can optionally be enhanced to also exclude stylists with overlapping confirmed `ScheduleBlock`s. Treat that as a future improvement, not a Phase 3 blocker.

### 4. Aggregation pipeline sketch
```js
StylistProfile.aggregate([
  { $geoNear: { near: { type: 'Point', coordinates: [lng, lat] }, distanceField: 'distance', maxDistance: radiusKm * 1000, spherical: true, query: { locationSet: true } } },
  { $match: { specialty, country, governorate, city, area, ...otherDenormalizedFilters } }, // straight StylistProfile fields, no join
  { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
  { $unwind: '$user' },
  { $match: { 'user.verification.status': 'verified', 'user.accountStatus': 'active' } }, // the one thing that still needs the User join
  { $sort: sortStage },
  { $skip: (page - 1) * limit },
  { $limit: limit },
]);
```
`$geoNear` must be the **first** stage in the pipeline — plan filters accordingly. Filter on denormalized fields *before* the `$lookup` (cheaper — narrows the set before the join).

### 5. Rating/review counters
`rating` and `totalReviews` are **not** written directly by this module — they get updated by the `reviews` module (Phase 8) via a domain event listener (`ReviewCreated` → recalculate average). Stub the listener registration here with a `// TODO: Phase 8` comment so the field exists and is query-able even before reviews exist.

---

## Definition of Done

- [x] Creating a stylist profile requires `role: 'stylist'` — a client gets `403`.
- [x] Creating/updating a stylist profile with `hourlyPrice < 100` returns `400` with a clear error message (`Hourly rate must be at least 100 EGP`), not a raw Mongoose validation error.
- [x] Creating/updating a stylist profile correctly copies `location`/`country`/`governorate`/`city`/`area` from the linked `User` document.
- [x] Updating `PATCH /users/me`'s location for a user with an existing `StylistProfile` re-syncs the denormalized copy (via `UserLocationUpdated`); doing the same for a plain client emits the event but updates nothing (no `StylistProfile` exists).
- [x] `2dsphere` index on `stylist_profiles.location` confirmed via `db.stylist_profiles.getIndexes()`.
- [x] `GET /stylists` and `GET /stylists/:id` responses never include `email`, `phone`, or any auth-sensitive field — verified via the public mapper in `stylist.dto.js`.
- [x] `GET /stylists` supports pagination, at least 5 filters (including `specialty`), sort, and text search simultaneously in one request.
- [x] `GET /stylists?lat=..&lng=..&radiusKm=5` returns only stylists within range, sorted by distance.
- [x] A verified stylist with `locationSet: false` (never set a real address) never appears in geo "nearby" search results, even at a tiny `radiusKm` around `[0,0]`.
- [x] Unverified stylists never appear in search results.
- [x] Field selection (`?fields=name,hourlyPrice,rating`) returns a trimmed payload.
- [x] Integration test covering combined filter + geo + pagination in one query.
- [x] Every new route in this phase has an @swagger JSDoc block covering summary, request body, and response codes; /api/docs renders it without errors.
