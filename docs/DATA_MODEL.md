# Murafiq — Data Model & Index Catalog

This document details all Mongoose schemas, relationships, and index definitions in the Murafiq backend.

---

## Collections & Schemas

### 1. `User` (`users`)
Central identity document for all platform roles (`client`, `stylist`, `admin`, `operator`).

| Field | Type | Description |
|---|---|---|
| `name` | String | User's full display name |
| `email` | String | Unique email (lowercase, indexed) |
| `phone` | String | Unique phone number (indexed) |
| `password` | String | Bcrypt hash (12 rounds) |
| `role` | String | `client` \| `stylist` \| `admin` \| `operator` |
| `isEmailVerified` | Boolean | Email confirmation status |
| `accountStatus` | String | `active` \| `suspended` \| `deleted` |
| `profileImage` | String | Cloudinary URL |
| `passwordChangedAt` | Date | Timestamp for session invalidation |
| `otp` | Object | `{ code: String, expiresAt: Date, attempts: Number, lastAttemptAt: Date }` |
| `verification` | Object | `{ status, documents: [{ type, url, publicId }], reviewedBy, reviewedAt, rejectionReason }` |
| `location` | Object | GeoJSON Point `{ type: 'Point', coordinates: [lng, lat] }` |

**Indexes:**
- `{ email: 1 }` (unique) — Fast authentication lookup.
- `{ phone: 1 }` (unique) — Fast phone authentication and uniqueness check.
- `{ role: 1 }` — Role filtering.
- `{ 'verification.status': 1 }` — Admin verification queue filtering.

---

### 2. `StylistProfile` (`stylistprofiles`)
Professional stylist details, rates, availability schedule, and performance stats.

| Field | Type | Description |
|---|---|---|
| `userId` | ObjectId (User) | 1-to-1 reference to `User` |
| `bio` | String | Stylist biography and background |
| `specialties` | [String] | Styling specialties |
| `hourlyRate` | Number | Hourly rate in EGP |
| `experienceYears` | Number | Years in fashion / styling |
| `portfolio` | [String] | Portfolio image URLs |
| `rating` | Number | Aggregate rating (1.0 to 5.0) |
| `totalReviews` | Number | Total review count |
| `completedSessions` | Number | Successfully completed session counter |
| `cancelledSessions` | Number | Stylist-initiated cancellation counter |
| `payoutAccount` | Object | `{ method, accountHolderName, bankName, accountNumber, walletPhone }` |
| `location` | Object | Denormalized GeoJSON Point `[lng, lat]` |

**Indexes:**
- `{ userId: 1 }` (unique) — Fast profile lookup by user ID.
- `{ location: '2dsphere' }` — Geospatial search (`$geoNear`).
- `{ rating: -1, completedSessions: -1 }` — Compound sorting for top-rated stylist search.
- `{ hourlyRate: 1 }` — Price range filtering.

---

### 3. `Request` (`requests`)
Client-initiated styling requests targeted at specific stylists.

| Field | Type | Description |
|---|---|---|
| `clientId` | ObjectId (User) | Client requesting session |
| `stylistId` | ObjectId (User) | Target stylist |
| `title` | String | Session title/summary |
| `description` | String | Details and requirements |
| `date` | Date | Requested session date |
| `time` | String | Requested start time (`"HH:MM"`) |
| `meetingLocation` | Object | Address and GeoJSON Point |
| `status` | String | `pending` \| `accepted` \| `declined` \| `cancelled` \| `expired` |
| `expiresAt` | Date | Expiration threshold (48 hours from creation) |

**Indexes:**
- `{ clientId: 1, createdAt: -1 }` — Client request history.
- `{ stylistId: 1, status: 1 }` — Incoming requests for stylists.
- `{ status: 1, expiresAt: 1 }` — Expiration queries.

---

### 4. `Offer` (`offers`)
Stylist-created proposals on client requests.

| Field | Type | Description |
|---|---|---|
| `requestId` | ObjectId (Request) | Associated request |
| `stylistId` | ObjectId (User) | Stylist offering service |
| `clientId` | ObjectId (User) | Client receiving offer |
| `price` | Number | Proposed price in EGP |
| `duration` | Number | Proposed session duration in minutes |
| `message` | String | Cover note |
| `status` | String | `pending` \| `accepted` \| `rejected` \| `expired` |
| `expiresAt` | Date | Expiration threshold (24 hours from creation) |

**Indexes:**
- `{ requestId: 1 }` — Offers per request.
- `{ stylistId: 1, status: 1 }` — Stylist offer tracking.
- `{ stylistId: 1, clientId: 1, status: 1 }` — One active offer per client rule.

---

### 5. `Booking` (`bookings`)
Confirmed shopping session agreement with calendar schedule blocks.

| Field | Type | Description |
|---|---|---|
| `requestId` | ObjectId (Request) | Source request |
| `offerId` | ObjectId (Offer) | Accepted offer (unique) |
| `clientId` | ObjectId (User) | Participating client |
| `stylistId` | ObjectId (User) | Participating stylist |
| `scheduledDate` | Date | Session calendar date |
| `scheduledStartMinute` | Number | Start time in minutes from midnight |
| `scheduledEndMinute` | Number | End time in minutes from midnight |
| `price` | Number | Agreed session total in EGP |
| `duration` | Number | Duration in minutes |
| `status` | String | `confirmed` \| `in-progress` \| `completed` \| `cancelled` \| `disputed` |
| `checkInAt` | Date | Stylist check-in timestamp |
| `clientConfirmedAt` | Date | Client completion confirmation |
| `stylistConfirmedAt` | Date | Stylist completion confirmation |
| `payoutStatus` | String | `unpaid` \| `processing` \| `paid` |
| `payoutId` | ObjectId (Payout) | Associated payout record |
| `disputeDetails` | Object | `{ raisedBy, reason, type, raisedAt, evidence }` |
| `disputeResolution` | Object | `{ outcome, refundPercentage, resolutionNotes, resolvedBy, resolvedAt }` |

**Indexes:**
- `{ offerId: 1 }` (unique) — Duplicate-booking prevention.
- `{ stylistId: 1, scheduledDate: 1, scheduledStartMinute: 1, scheduledEndMinute: 1 }` — Overlap checking.
- `{ clientId: 1, createdAt: -1 }` — Client booking list.
- `{ status: 1 }` — Admin booking query & disputed list.

---

### 6. `ScheduleBlock` (`scheduleblocks`)
Atomic time-slot reservations preventing stylist double-bookings.

| Field | Type | Description |
|---|---|---|
| `stylistId` | ObjectId (User) | Blocked stylist |
| `bookingId` | ObjectId (Booking) | Associated booking |
| `date` | Date | Calendar date |
| `startMinute` | Number | Start minute (0–1439) |
| `endMinute` | Number | End minute (0–1439) |

**Indexes:**
- `{ stylistId: 1, date: 1, startMinute: 1, endMinute: 1 }` (unique) — Absolute double-booking prevention.

---

### 7. `Payment` (`payments`)
Financial ledger entry capturing customer billing, platform commission, and refund state.

| Field | Type | Description |
|---|---|---|
| `bookingId` | ObjectId (Booking) | 1-to-1 booking reference (unique) |
| `clientId` | ObjectId (User) | Paying client |
| `amount` | Number | Gross transaction amount in EGP |
| `currency` | String | Default `'EGP'` |
| `platformFeePercentage` | Number | Platform fee rate (15%) |
| `platformFeeAmount` | Number | Platform earnings in EGP |
| `stylistPayoutAmount` | Number | Net stylist earnings in EGP (85% adjusted for refunds) |
| `status` | String | `pending` \| `paid` \| `failed` \| `refunded` \| `partially_refunded` |
| `provider` | String | `'paymob'` \| `'mock'` |
| `providerTransactionId` | String | Payment gateway transaction ID |
| `refundAmount` | Number | Cumulative refunded amount in EGP |
| `refundReason` | String | Reason for refund |
| `refundedAt` | Date | Refund timestamp |

**Indexes:**
- `{ bookingId: 1 }` (unique) — 1-to-1 booking-to-payment constraint.
- `{ clientId: 1, createdAt: -1 }` — Client payment history.
- `{ status: 1 }` — Payout ledger aggregation query.

---

### 8. `Payout` (`payouts`)
Disbursement records tracking platform payments to stylists.

| Field | Type | Description |
|---|---|---|
| `stylistId` | ObjectId (User) | Stylist receiving disbursement |
| `bookingIds` | [ObjectId] | Bookings included in this payout batch |
| `amount` | Number | Total disbursement amount in EGP |
| `status` | String | `pending` \| `processing` \| `paid` \| `failed` |
| `method` | String | `bank_transfer` \| `vodafone_cash` \| `instapay` |
| `payoutAccountDetails` | Object | Snapshot of destination account at batch creation |
| `reference` | String | Gateway or bank transaction reference |
| `failureReason` | String | Error message if rejected |
| `processedBy` | ObjectId (User) | Admin executing disbursement |
| `processedAt` | Date | Batch initiation timestamp |
| `paidAt` | Date | Final disbursement confirmation timestamp |

**Indexes:**
- `{ stylistId: 1, createdAt: -1 }` — Stylist payout history.
- `{ status: 1 }` — Admin disbursement queue.

---

### 9. `Review` (`reviews`)
Two-way session reviews (client-to-stylist and stylist-to-client).

| Field | Type | Description |
|---|---|---|
| `bookingId` | ObjectId (Booking) | Reviewed booking |
| `reviewerId` | ObjectId (User) | Review author |
| `revieweeId` | ObjectId (User) | Reviewed participant |
| `direction` | String | `client_to_stylist` \| `stylist_to_client` |
| `rating` | Number | Rating (1 to 5) |
| `comment` | String | Written feedback |
| `isHidden` | Boolean | Admin moderation flag |
| `hiddenReason` | String | Reason for moderation |

**Indexes:**
- `{ bookingId: 1, direction: 1 }` (unique) — Prevents duplicate reviews for the same session.
- `{ revieweeId: 1, isHidden: 1, createdAt: -1 }` — Public review feeds.

---

### 10. `AuditLog` (`auditlogs`)
Immutable append-only platform audit trail for administrative and financial actions.

| Field | Type | Description |
|---|---|---|
| `actorId` | ObjectId (User) | User or admin triggering action |
| `actorRole` | String | Role of the actor |
| `action` | String | e.g. `verification.approved`, `payout.paid`, `dispute.resolved` |
| `targetType` | String | `User` \| `Booking` \| `Payment` \| `Payout` \| `Review` |
| `targetId` | String | ID of affected entity |
| `metadata` | Object | Arbitrary contextual data |

**Indexes:**
- `{ actorId: 1, createdAt: -1 }` — Filter logs by actor.
- `{ action: 1, createdAt: -1 }` — Filter logs by action type.
- `{ targetType: 1, targetId: 1 }` — Audit trail for a specific resource.
