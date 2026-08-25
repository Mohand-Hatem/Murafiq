# Murafiq — Open Broadcast Requests (Hybrid Direct + Broadcast Marketplace)

> **STATUS: DESIGN — NOT STARTED.** No code changes made. This document extends the already-built
> Phase 4 (Requests & Offers) rather than replacing it — direct requests keep working exactly as
> they do today; broadcast is additive.
>
> Every schema, service, and pattern referenced below was read directly from the current codebase
> (not assumed) — file paths and line-level behavior are cited so this stays implementable against
> what's actually there, not a stale mental model of it.

---

## 1. Strategic & Business Critique

### Benefits

- **Liquidity for the cold-start problem.** A first-time client has no way to pick "the right"
  stylist today — direct request requires already knowing who to target. Broadcast lets demand
  exist before a specific supply relationship does, which is what actually grows a two-sided
  marketplace past its first hundred users.
- **Price discovery.** Competing offers on the same job give clients a real market price instead of
  one stylist's number in a vacuum — directly useful in a category (styling/beauty) where pricing
  is opaque and trust-dependent.
- **Capacity smoothing.** Idle verified stylists can pick up broadcast work without depending on
  being anyone's first choice. This is a retention lever for supply, not just a demand feature.

### Tradeoffs & anti-patterns to design against, not just note

| Risk | Why it happens | Design response (see §2–3) |
|---|---|---|
| **Notification spam** | Naive "notify every stylist in the city" on every broadcast post | Bounded, city/governorate-first fanout (§2.3), capped and ranked — not a raw radius sweep |
| **Offer hoarding** | A stylist submits many low-effort offers hoping volume wins | Enforce **one offer per stylist per request** at the DB level (new unique index, §2.1) — currently structurally impossible under 1:1 direct requests, so this rule doesn't exist yet and must be added |
| **Race-to-the-bottom pricing** | Visible competing prices anchor everyone downward | **Decided: sealed-bid.** Clients see the full price comparison across all offers — that's what drives conversion, never hide it from them. Stylists never see competing offers' prices on the same request, only (optionally) a count. This isn't a UX nicety — commission is 15% of price, so a bidding war costs the platform revenue directly, not just stylist margin. See §2.3 for the visibility-scoping implementation. |
| **Decision paralysis** | Too many similar offers, no easy comparison | Out of scope for the backend design here — a frontend/UX concern once the API returns offers sortable by price/rating |
| **Broadcast as a cap-limit bypass** | Client posts broadcast requests to route around the daily request cap | Don't create a separate cap bucket — count broadcast + direct together against the existing per-client daily cap (§2.2) |
| **Zombie broadcast requests** | Client never accepts anything, offers pile up | Already-existing 48h request expiry (`request.service.js:73`) and 24h offer expiry both apply unchanged — no new expiry logic needed |

---

## 2. Impact Analysis on Existing Modules

### 2.1 Data Models & Schemas

**`Request` model** (`src/modules/requests/request.model.js`)

```js
stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true },  // current
```

Change to conditionally required, mirroring the exact pattern already used for
`User.passwordHash` in `user.model.js:16` (`required: function() { return !this.googleId; }`):

```js
visibility: {
  type: String,
  enum: ['direct', 'broadcast'],
  required: true,
  default: 'direct',
},
stylistId: {
  type: Schema.Types.ObjectId,
  ref: 'User',
  required: function () {
    return this.visibility === 'direct';
  },
},
```

**Why an explicit `visibility` enum instead of inferring from `stylistId == null`:** every existing
model in this codebase (`status`, `specialty`, `payoutStatus`, `direction` on reviews) uses an
explicit enum for branching state, never a null-check on an unrelated field. Inferring type from
nullability means every future query (`findMine`, `findIncoming`, cap counting, the feed) needs a
`stylistId: null` vs `stylistId: {$ne: null}` branch instead of one indexed field — worse for query
planning and worse for anyone reading the code six months from now.

No new location field is needed — `meetingLocation.{country,governorate,city,area,location}` already
exists on `Request` (`request.model.js:12-22`) and is exactly the shape
`stylist-search.service.js`'s `$geoNear` pipeline already targets. Reuse it directly for the feed.

New indexes:

```js
requestSchema.index({ 'meetingLocation.location': '2dsphere' }); // required for $geoNear on Request
requestSchema.index(
  { visibility: 1, status: 1, 'meetingLocation.governorate': 1, createdAt: -1 }
); // non-geo feed fallback: browse-by-governorate when the client has no lat/lng
```

**`Offer` model** (`src/modules/offers/offer.model.js`) — one required addition, independent of
broadcast:

```js
offerSchema.index({ requestId: 1, stylistId: 1 }, { unique: true });
```

**This gap exists today and broadcast makes it dangerous.** Currently `offer.service.js:57-64` only
enforces "one *active* offer per stylist **per client**, across all that client's requests"
(`findActiveForClient`) — it has never enforced "one offer per stylist **per request**", because
under 1:1 direct requests only one stylist could ever offer on a given request anyway, so the gap
was invisible. Under broadcast, many stylists can offer on the same request, and without this index
a stylist can spam-submit unlimited offers on one job (the offer-hoarding anti-pattern from §1).

**`Booking` model** (`src/modules/bookings/booking.model.js`) — one required addition:

```js
bookingSchema.index({ requestId: 1 }, { unique: true });
```

Mirrors the existing `bookingSchema.index({ offerId: 1 }, { unique: true })` at line 73 — that index
guarantees one offer can't become two bookings; this one guarantees one **request** (which may now
have many competing offers) can't become two bookings. Same defense-in-depth philosophy the codebase
already applies to `ScheduleBlock` (`schedule.model.js:16`, unique on
`{stylistId, date, startMinute}`) — the application-level check in §2.4 is the primary guard, the
unique index is the guarantee that holds even if the application logic has a bug.

### 2.2 Daily Caps & Anti-Abuse

**Client request cap — no change.** `countDailyClientRequests` (`request.repository.js:64`) counts
by `clientId` and `createdAt` range only, not `stylistId`. Leaving it as-is means broadcast and
direct requests draw from the **same** daily pool (`DEFAULT_CAPS.CLIENT_DAILY_REQUESTS_VERIFIED: 5`,
`.._UNVERIFIED: 2` — `defaults.constant.js`). This is a deliberate choice: a separate broadcast-only
cap would let a client bypass the existing cap by switching modes, defeating its purpose.

**Stylist offer cap — decided: direct responses are uncapped, `STYLIST_DAILY_OFFERS` applies only to
broadcast offers.** The daily cap exists to throttle spam — a stylist proactively blasting out
low-effort offers. That risk is real for broadcast (a stylist chooses how many open jobs to bid on)
but **structurally impossible** for direct requests: a stylist cannot generate more direct requests
aimed at themselves, the client controls that entirely. Capping direct-offer responses prevents no
abuse pattern and only risks turning away real, client-initiated demand from a popular stylist on a
busy day — pure downside, no anti-abuse benefit. So the cap should target exactly the behavior that's
actually spammable and leave the rest alone.

Implementation: `offer.service.js#createOffer` already fetches the full `Request` document
(`reqDoc`, via `requestRepository.findById`) before the cap check runs — the visibility is already
in memory, no new field or extra query needed. Gate the existing check on it:

```js
// offer.service.js#createOffer — was an unconditional cap check, now scoped to broadcast only
if (reqDoc.visibility === 'broadcast') {
  const { startOfDay, endOfDay } = getBusinessDayRange();
  const dailyCount = await offerRepository.countDailyStylistOffers(
    stylistUser._id || stylistUser.id,
    startOfDay,
    endOfDay
  );
  const maxDailyOffers = DEFAULT_CAPS.STYLIST_DAILY_OFFERS;
  if (dailyCount >= maxDailyOffers) {
    throw new ApiError(403, `Daily broadcast offer limit reached (${maxDailyOffers}/day). Try again tomorrow.`);
  }
}
// direct: no cap check at all — falls straight through to offer creation
```

**`countDailyStylistOffers` itself must also change** — it currently counts *all* of a stylist's
offers regardless of the parent request's visibility (`offer.repository.js:36-41`,
`Offer.countDocuments({ stylistId, createdAt: {...} })`). Gating only the *check* on broadcast
without fixing the *count* is a bug: a stylist who sent 5 uncapped direct offers today would still
have those 5 eat into their 10/day broadcast budget, defeating the whole point of splitting them.

Cleanest fix: denormalize `requestVisibility` onto `Offer` at creation time — the same pattern
`StylistProfile` already uses to denormalize `User`'s location fields "for fast search"
(`stylist-profile.model.js:39`, comment: "Denormalized read-copy... for fast search"). Avoids a
`$lookup` join on a hot path (every offer creation checks this).

```js
// offer.model.js — add alongside the existing fields
requestVisibility: { type: String, enum: ['direct', 'broadcast'], required: true },
```
```js
// offer.repository.js#countDailyStylistOffers — add the filter
export const countDailyStylistOffers = async (stylistId, startOfDay, endOfDay) => {
  return Offer.countDocuments({
    stylistId,
    requestVisibility: 'broadcast', // direct offers never consume the broadcast budget
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  });
};
```
Set `requestVisibility: reqDoc.visibility` in `offer.service.js#createOffer`'s `offerRepository.create()`
call (§3, Step A) — `reqDoc` is already in memory at that point, no extra query.

**New anti-abuse rule, broadcast-specific:** the `{requestId, stylistId}` unique index from §2.1 is
the actual enforcement — no additional service-layer cap logic needed, the database rejects the
duplicate.

### 2.3 Notifications & Discovery

**The constraint that shapes this:** never query or notify "every stylist in the database." The
existing `stylist-search.service.js` already solved exactly this problem for the inverse direction
(client searching for stylists) with a bounded `$geoNear` + area-match + `$facet` pipeline
(`stylist-search.service.js:87-100`, capped via `limit`, default `Math.min(100, ...)` matching
`QueryBuilder`'s own cap discipline). Reuse it, don't reinvent it.

**Recommendation: pull-first, bounded-push second — not push-only.**

1. **Pull (primary, ship first):** `GET /requests/feed` — stylists actively browse open broadcast
   requests near them, filtered the same way `GET /stylists` filters clients' searches today. Zero
   fanout cost, zero risk of over-notifying, and it's close to a copy-paste of the existing pipeline
   (§3, Step B). This alone is a complete, safe v1.
2. **Bounded push (additive):** the event bus already has exactly the right hook —
   `eventBus.emit(EVENTS.REQUEST_CREATED, { requestId })` already fires on every request creation
   (`request.service.js:83`), and `notification.listener.js` already listens for it to notify the
   targeted stylist on **direct** requests. Extend that listener for `visibility === 'broadcast'`.

**Fanout targeting — decided: city/governorate first, radius as a fallback, not a fixed KM default.**
A fixed radius doesn't mean the same thing everywhere in this market — 10km in Greater Cairo could
sweep in an unmanageable number of stylists; the same 10km in a smaller governorate could return
almost nobody. It also ignores that in-person styling cares about practical travel within a city, not
straight-line distance. Match on the request's `meetingLocation.governorate`/`city` (fields already
captured on every request) as the primary targeting unit; fall back to `$geoNear` only when the
city-level match returns too few results, or for a request near a governorate boundary.

**Ranking, not just proximity — cap at ~30–50 but rank first.** Don't take the nearest N blindly.
Rank candidates by proximity + rating + recent activity before capping, so the notification budget
goes to the best, most-responsive stylists first — the client gets good offers faster, and it's a
quiet retention lever that rewards good stylist behavior.

```js
// notification.listener.js — EVENTS.REQUEST_CREATED handler, broadcast branch
const nearbyStylists = await stylistRepository.findVerifiedInArea({
  governorate: request.meetingLocation.governorate,
  city: request.meetingLocation.city,
  fallbackCoordinates: request.meetingLocation.location.coordinates, // used only if the area match is thin
  fallbackRadiusKm: 10,
  rankBy: ['rating', 'isOnline'], // best/currently-active first, not just nearest
  limit: 50,
});
```

**Sealed-bid visibility (§1) — this is where it's actually enforced.** The feed (`GET /requests/feed`,
§3 Step B) and this notification payload both expose the *request*, never other stylists' *offers*.
There is no "view all offers on request X" endpoint for stylists — only for the request's own
client. No new access-control mechanism needed for the stylist side, just discipline about which
endpoint returns which fields — the existing per-role DTO pattern (`toPublicOfferDto` etc.) already
scopes what's returned per caller.

> **Corrected 2026-08-25:** this section originally described the client-facing comparison endpoint
> as already "implied by existing... patterns" without actually specifying it as a build step — that
> was a mistake in this doc, not an implementation gap. It shipped nowhere until caught in
> post-build verification. The real endpoint is now built and documented:
> **`GET /offers/requests/:id`** (client-only, ownership-scoped — see `offer.service.js#getOffersForRequest`,
> `04_ROUTES.md`), returning every offer on the caller's own request sorted price-ascending. If you're
> reading this doc to implement a similar feature elsewhere, the lesson is: don't assert an endpoint
> is "implied" — give it its own Step A–E line item like every other route in this document.

**Why not push-only:** unbounded fanout is the direct cause of the spam anti-pattern in §1 — a
broadcast request in a dense city could otherwise "notify everyone," which degrades into noise
stylists learn to ignore, defeating the feature. Pull has no such failure mode because the stylist
controls when and how much they look.

### 2.4 Lifecycle & Race Conditions

**The failure mode to prevent:** two stylists' offers on the same broadcast request both get
accepted concurrently, producing two Bookings for one job.

The codebase already has a proven two-layer pattern for exactly this class of problem — visible in
`createBookingFromOffer` (`booking.service.js`): a unique index catches the race
(`err.code === 11000` handling at lines ~38-42 and ~63-67 in that function), used as the **actual**
concurrency guard, with an earlier read-then-check only as a fast-path optimization. Apply the same
two layers here:

**Layer 1 — atomic compare-and-swap on the Request, inside the existing transaction:**

```js
// Inside createBookingFromOffer, before creating the Booking — works for BOTH direct and broadcast,
// since for direct requests there's only ever one competing offer so this is a no-op fast path.
const lockedRequest = await Request.findOneAndUpdate(
  { _id: requestDoc._id, status: { $in: ['pending', 'offered'] } },
  { $set: { status: 'accepted' } },
  { new: true, session }
);
if (!lockedRequest) {
  // Someone else's offer on this request already won the race.
  throw new ApiError(409, 'This request has already been accepted via another offer.');
}
```

This is the primary guard: the `findOneAndUpdate` with a status filter is atomic at the MongoDB
document level — exactly one concurrent caller can observe `status: 'pending'`/`'offered'` and win
the update; every other concurrent caller observes the now-changed status and gets `null` back.

**Layer 2 — the unique index from §2.1 as defense-in-depth:** even if the CAS above were somehow
bypassed by a bug, the second concurrent `bookingRepository.create()` call hits the
`{requestId: 1}` unique index and throws `err.code === 11000` — already handled by the existing
`try/catch` around `bookingRepository.create()` in `createBookingFromOffer`, just needs the same
11000-check added for this index alongside the existing one for `offerId`.

**Closing sibling offers — same transaction, after the Booking is created:**

```js
await Offer.updateMany(
  { requestId: requestDoc._id, _id: { $ne: offer._id }, status: 'pending' },
  { $set: { status: 'rejected' } },
  { session }
);
```

For direct requests this `updateMany` matches zero documents (there's only ever one offer) — safe,
cheap, no branching needed. Emit `EVENTS.OFFER_REJECTED` for each closed offer so the losing
stylists get notified their competing offer didn't win, reusing the existing
`notification.listener.js` handler for that event rather than adding a new one.

---

## 3. Step-by-Step Implementation Plan

Each step is independently shippable and backward-compatible — direct requests keep working
identically at every step until Step D changes the acceptance transaction.

### Step A — Validator & Schema Updates

`src/modules/requests/request.model.js`:
```js
visibility: { type: String, enum: ['direct', 'broadcast'], required: true, default: 'direct' },
stylistId: {
  type: Schema.Types.ObjectId,
  ref: 'User',
  required: function () { return this.visibility === 'direct'; },
},
```
Add the two new indexes from §2.1.

`src/modules/offers/offer.model.js`: add `offerSchema.index({ requestId: 1, stylistId: 1 }, { unique: true })`,
plus the `requestVisibility` field from §2.2 (`{ type: String, enum: ['direct', 'broadcast'], required: true }`)
— required for the direct-uncapped/broadcast-capped offer split to count correctly.

`src/modules/bookings/booking.model.js`: add `bookingSchema.index({ requestId: 1 }, { unique: true })`.

**Migration — required before deploying the schema changes, not optional.** Both new fields are
`required: true` on collections that already have live rows. Mongoose only applies schema defaults
on document *creation*, never retroactively — every existing `Request` and `Offer` document has
`visibility`/`requestVisibility` as `undefined` until backfilled. Left unfixed, this fails silently,
not loudly: `undefined !== 'direct'` and `undefined !== 'broadcast'` are both true, so the
conditional-required `stylistId` check and the broadcast-only cap check both just skip past existing
rows without erroring — a very easy corruption to miss in testing (new documents work fine; only old
ones are wrong) and hard to trace back once it's live.

Run before the new indexes are created:
```js
// One-time backfill — every request/offer that exists today predates this feature and was
// necessarily direct (the only mode that existed), so backfilling to 'direct' is unconditionally
// correct, not a guess.
await Request.updateMany({ visibility: { $exists: false } }, { $set: { visibility: 'direct' } });
await Offer.updateMany({ requestVisibility: { $exists: false } }, { $set: { requestVisibility: 'direct' } });
```
Then create the new unique indexes (`{requestId, stylistId}` on `Offer`, `{requestId}` on `Booking`)
and confirm they build without an `E11000` duplicate-key error — expected to be clean since only one
offer/booking per request was structurally possible under the old 1:1 model, but verify it rather
than assume it, especially against a production data copy before touching production itself.

`src/modules/requests/request.validator.js` — `createRequestSchema` currently has
`stylistId: z.string().trim().min(1, 'stylistId is required')` unconditionally
(`request.validator.js:6`). Make it a discriminated union so the two request types are validated
distinctly rather than bolting optional-everything onto one schema:

```js
export const createRequestSchema = {
  body: z.discriminatedUnion('visibility', [
    z.object({
      visibility: z.literal('direct'),
      stylistId: z.string().trim().min(1, 'stylistId is required for a direct request'),
      title: z.string().trim().min(1, 'title is required'),
      // ...remaining shared fields, identical to today's schema
    }).strict(),
    z.object({
      visibility: z.literal('broadcast'),
      title: z.string().trim().min(1, 'title is required'),
      // ...same shared fields, no stylistId
    }).strict(),
  ]),
};
```
`z.discriminatedUnion` gives a precise error ("stylistId required for direct") instead of a vague
optional-field miss, and it's the same library already in use (Zod) — no new dependency.

### Step B — Repository & Query Modifications (feed query)

New `src/modules/requests/request-feed.service.js`, structured as a near-mirror of
`stylist-search.service.js` (same file, same conventions — `escapeRegex`, `$facet`, `ALLOWED_SORT_FIELDS`):

```js
import Request from './request.model.js';
import { toPublicRequestDto } from './request.dto.js';
import { escapeRegex } from '../../common/query-builder/QueryBuilder.js';
import ApiError from '../../common/utils/ApiError.js';

const ALLOWED_SORT_FIELDS = ['createdAt', 'distance', 'expiresAt'];

export const getBroadcastFeed = async (stylistUser, queryParams = {}) => {
  const page = Math.max(1, parseInt(queryParams.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(queryParams.limit, 10) || 10));
  const skip = (page - 1) * limit;

  const matchQuery = { visibility: 'broadcast', status: 'pending' };

  if (queryParams.governorate) {
    matchQuery['meetingLocation.governorate'] =
      new RegExp(`^${escapeRegex(queryParams.governorate)}$`, 'i');
  }
  if (queryParams.city) {
    matchQuery['meetingLocation.city'] = new RegExp(`^${escapeRegex(queryParams.city)}$`, 'i');
  }

  const pipeline = [];

  const hasGeoParams =
    queryParams.lat !== undefined && queryParams.lng !== undefined &&
    !isNaN(parseFloat(queryParams.lat)) && !isNaN(parseFloat(queryParams.lng));

  if (hasGeoParams) {
    const lat = parseFloat(queryParams.lat);
    const lng = parseFloat(queryParams.lng);
    const radiusKm = parseFloat(queryParams.radiusKm) || 10; // same default as stylist search
    pipeline.push({
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distance',
        maxDistance: radiusKm * 1000,
        spherical: true,
        query: matchQuery, // geoNear must fold the match into its own `query`, per stylist-search precedent
      },
    });
  } else {
    pipeline.push({ $match: matchQuery });
  }

  // A stylist should never see a request they've already offered on in their own feed —
  // exclude via a $lookup against Offer, not a client-side filter.
  pipeline.push(
    {
      $lookup: {
        from: 'offers',
        let: { reqId: '$_id' },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ['$requestId', '$$reqId'] },
            { $eq: ['$stylistId', stylistUser._id || stylistUser.id] },
          ] } } },
        ],
        as: 'myOffer',
      },
    },
    { $match: { myOffer: { $size: 0 } } }
  );

  let sortStage = { createdAt: -1 };
  if (hasGeoParams && (!queryParams.sort || queryParams.sort === 'distance')) {
    sortStage = { distance: 1 };
  } else if (queryParams.sort) {
    const [field, order] = queryParams.sort.split(':');
    if (!ALLOWED_SORT_FIELDS.includes(field)) {
      throw new ApiError(400, `Invalid sort field '${field}'. Allowed: ${ALLOWED_SORT_FIELDS.join(', ')}`);
    }
    sortStage = { [field]: order === 'desc' ? -1 : 1 };
  }

  pipeline.push({
    $facet: {
      items: [{ $sort: sortStage }, { $skip: skip }, { $limit: limit }],
      totalCount: [{ $count: 'total' }],
    },
  });

  const [result] = await Request.aggregate(pipeline);
  const items = result?.items || [];
  const total = result?.totalCount?.[0]?.total || 0;

  return {
    items: items.map(toPublicRequestDto),
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
};

export default { getBroadcastFeed };
```

Route: `GET /requests/feed` — stylist-only (`restrictTo(ROLES.STYLIST)`), verified-only (same guard
already applied in `offer.service.js:15` before allowing an offer).

### Step C — Service Layer & Event Bus Notifications

`request.service.js#createRequest` — drop the unconditional target-stylist lookup
(`request.service.js:20-33`) into a branch:

```js
if (requestData.visibility === 'direct') {
  const targetStylist = await userRepository.findById(requestData.stylistId);
  if (!targetStylist || targetStylist.role !== ROLES.STYLIST) {
    throw new ApiError(404, 'Target stylist not found');
  }
  if (targetStylist.verification?.status !== 'verified') {
    throw new ApiError(400, 'Target stylist is not identity-verified');
  }
  const stylistProfile = await stylistRepository.findByUserId(requestData.stylistId);
  if (!stylistProfile) {
    throw new ApiError(400, 'Target stylist has not completed onboarding');
  }
}
// broadcast: no target-stylist validation — anyone verified & in range can see it via the feed
```

The daily-cap check (`request.service.js:35-53`) is untouched — runs identically for both visibility
types, per §2.2.

`notification.listener.js` — extend the existing `EVENTS.REQUEST_CREATED` handler:
```js
eventBus.on(EVENTS.REQUEST_CREATED, async ({ requestId }) => {
  const request = await requestRepository.findById(requestId);
  if (request.visibility === 'direct') {
    // existing single-stylist notify path, unchanged
  } else {
    const nearbyStylists = await stylistRepository.findVerifiedInArea({
      governorate: request.meetingLocation.governorate,
      city: request.meetingLocation.city,
      fallbackCoordinates: request.meetingLocation.location.coordinates,
      fallbackRadiusKm: 10,
      rankBy: ['rating', 'isOnline'],
      limit: 50,
    }); // city/governorate-first, ranked, capped — see §2.3
    await Promise.all(nearbyStylists.map((s) =>
      notificationService.send(s.userId, {
        type: 'request',
        title: 'New Open Request Near You',
        body: `A client posted "${request.title}" in ${request.meetingLocation.city}.`,
        relatedEntityId: request._id,
      })
    ));
  }
});
```
`findVerifiedInArea` is a small new repository function on `stylist.repository.js`: `$match` on
`governorate`/`city` first; if that returns fewer than `limit` results, extend with a `$geoNear`
fallback using `fallbackCoordinates`/`fallbackRadiusKm`; sort by `rankBy` before applying `limit`.
The read-side counterpart to the aggregation already in `stylist-search.service.js`, returning
`userId`s only rather than full DTOs.

### Step D — Offer Acceptance & Locking Transaction

Modify `createBookingFromOffer` (`booking.service.js`) — insert the CAS lock from §2.4 immediately
after the existing `offer.status !== 'pending'` check, and the sibling-offer close from §2.4
immediately after the Booking is successfully created, both inside the same `session`. No change to
the function's external signature or its callers (`offer.service.js#acceptOffer` already wraps this
in a transaction — nothing there needs to change).

Add the `err.code === 11000` branch for the new `{requestId: 1}` unique index alongside the existing
one for `{offerId: 1}` in the same `try/catch` that already exists around `bookingRepository.create()`.

### Step E — Integration Tests & Swagger Documentation

New/updated test files, following existing naming and structure:

- `tests/integration/requests-broadcast.test.js` — create broadcast request (no `stylistId`) →
  succeeds; create direct request without `stylistId` → `400` (discriminated union rejects it).
- `tests/unit/offer.duplicate-guard.test.js` — same stylist submitting a second offer on the same
  request → `409` via the new unique index, not a silent duplicate.
- `tests/unit/booking.broadcast-race.test.js` — **the concurrency test that matters most.** Fire two
  concurrent `acceptOffer` calls for two different offers on the same broadcast request (mocking
  `mongodb-memory-server`'s replica set, already wired for transactions per `HARDENING_02` Step 9) —
  assert exactly one `Booking` is created, the losing offer ends up `status: 'rejected'`, and the
  loser gets a `409` or the sibling-close event, not a silently-successful second booking.
- `tests/integration/requests-feed.test.js` — seed 3 broadcast requests at different distances from
  a stylist's location; assert the feed returns them sorted by distance and respects `radiusKm`;
  assert a request the stylist already offered on is excluded (the `$lookup`/`$size: 0` filter).

Swagger: new `@swagger` block for `GET /requests/feed` in `request.swagger.js`, and update the
existing `POST /requests` block to document the `visibility` discriminator and its two body shapes.

---

## Decisions Made (previously open, now resolved — recorded here for traceability)

1. **Price visibility — sealed-bid.** Clients see the full price comparison across all offers on
   their request; stylists never see competing offers' prices on the same request (§1, §2.3).
   Protects the 15% commission from a bidding-war race to the bottom without hiding the comparison
   clients actually want.
2. **Fanout targeting — city/governorate first, not a fixed KM radius.** `$geoNear` radius is a
   fallback for thin results or boundary cases only; the primary match is on the request's own
   `governorate`/`city` fields. Ranked by `rating` + `isOnline` before applying the `limit: 50` cap
   (§2.3). The exact `limit` value is still a starting point, not researched against this market's
   real stylist density — worth revisiting after a few weeks of broadcast volume, but the *mechanism*
   (area-first, ranked, capped) is decided, not just the number.
3. **`STYLIST_DAILY_OFFERS` split — direct responses uncapped, cap applies to broadcast only.**
   A stylist cannot generate more direct requests aimed at themselves, so capping direct responses
   throttles no abuse pattern and only turns away real demand on a busy day. The cap is retargeted to
   the behavior that's actually spammable (§2.2), including the `requestVisibility` denormalization
   on `Offer` needed to count correctly.

## Still Genuinely Open

- **Exact `limit`/ranking-weight tuning** for the fanout cap (§2.3) — the mechanism above is decided,
  the specific numbers aren't validated against real usage yet.
- **Whether to expose an offer *count* to stylists on the feed** ("3 stylists have already quoted") —
  optional signal that doesn't leak prices; not required for v1, a product call on how much
  competitive pressure to surface.
