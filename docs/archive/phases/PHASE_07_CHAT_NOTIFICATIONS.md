# Phase 7 — Realtime Chat (Firebase Firestore) & Notifications (Firebase FCM + Mongo)

## Goal
Open a chat conversation once payment succeeds, support text/image messages with typing/seen/delivered/online status via **Firebase Firestore**, and build a realtime push + persisted notification system using **Firebase Cloud Messaging (FCM)** and MongoDB.

> **Consolidated Firebase Architecture:** Chat runs on Firebase Firestore (`conversations/{bookingId}/messages`). Notifications are persisted in MongoDB (`Notification` model) and delivered live/push via Firebase Cloud Messaging (FCM). Socket.io is not needed, keeping the mobile client SDK unified and preventing battery drain when the app is in the background.

## Depends on
Phase 6 (`PaymentSucceeded` event). Phase 1's dual-mode auth (cookie for web / Bearer for mobile) — the Firebase custom-token exchange happens after that normal login succeeds, not instead of it.

---

## Steps — Chat (Firebase)

### 1. Firestore schema (no Mongoose model — created/managed via `firebase-admin` in `chat.service.js`)
```
conversations/{conversationId}
  bookingId: string
  participants: string[]        // Mongo user _ids
  isOpen: boolean
  lastMessageAt: timestamp

conversations/{conversationId}/messages/{messageId}
  senderId: string
  type: 'text' | 'image'
  content: string                // text content or Cloudinary URL
  deliveredAt: timestamp | null
  seenAt: timestamp | null
  createdAt: timestamp
```
`conversationId` is created as `bookingId` (1:1 with the booking, so no separate lookup is needed) when the booking is created in Phase 5.

### 2. `src/config/firebase.config.js`
Initializes the Admin SDK once (`admin.initializeApp({ credential: admin.credential.cert({ projectId: env.FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY }) })`), exports the `admin` instance for `chat.service.js` to use (`admin.firestore()`, `admin.auth()`, `admin.messaging()`).

### 3. Event listener: open the conversation
In `chat.service.js`, register a listener on `PaymentSucceeded`:
```js
eventBus.on(EVENTS.PAYMENT_SUCCEEDED, async ({ bookingId }) => {
  await firestore.collection('conversations').doc(bookingId).set({ isOpen: true }, { merge: true });
});
```

### 4. REST endpoints
- `GET /chat/:conversationId/messages` — paginated history, read from the Firestore `messages` subcollection through `chat.service.js` (Firestore's own pagination — `orderBy('createdAt').startAfter(cursor)` — not QueryBuilder, since this isn't a Mongoose query).
- `POST /chat/:conversationId/messages` — fallback for clients without a live Firestore listener (also used for image messages via Cloudinary upload then send URL); writes to the same subcollection so both paths stay consistent. Rejected if the conversation's `isLocked === true` (step 5a).
- `POST /chat/token` (or returned inline from `/auth/login` once a session exists) — calls `admin.auth().createCustomToken(userId, { role: req.user.role })` so the already-authenticated user (cookie or Bearer, per Phase 1) can exchange it with the Firebase client SDK for realtime access. **The `role` custom claim matters beyond identity**: it's what lets Security Rules grant admins read access to conversations they aren't a participant of (step 5a) — without it, admin has no way to review chat history during dispute resolution (`PHASE_10_AUDIT_ADMIN.md` step 3). No server-side socket code is needed for chat — the client subscribes directly to Firestore via `onSnapshot()`.

### 5. Realtime behavior — client-side, enforced by Firestore Security Rules
There is no server-side chat socket. Instead:
- The client SDK listens on `conversations/{id}/messages` via `onSnapshot()` for new messages, and on `typing/{conversationId}/{userId}` / `presence/{userId}` docs (client-writable, short-lived) for typing/online status.
- **Security Rules** (deployed alongside the Firebase project, not part of this Express repo) must enforce: a user can read/write a conversation doc or its messages if `request.auth.uid` is present in that conversation's `participants[]` AND `isOpen == true` AND `isLocked != true`; **or**, read-only regardless of participants/lock state, if `request.auth.token.role == 'admin'` (the custom claim from step 4).
- Delivered/seen updates: the client writes `deliveredAt`/`seenAt` on the message doc directly (allowed by the same security rule, scoped to participants), no server round-trip required.

### 5a. Locking the conversation on a terminal booking state
Add `isLocked: { type: Boolean, default: false }` to the `conversations/{conversationId}` doc (alongside `isOpen`). A listener on `SessionCompleted` and `BookingCancelled` sets `isLocked: true` on the matching conversation:
```js
eventBus.on(EVENTS.SESSION_COMPLETED, async ({ bookingId }) => {
  await firestore.collection('conversations').doc(bookingId).set({ isLocked: true }, { merge: true });
});
// same listener registered for EVENTS.BOOKING_CANCELLED
```
No separate listener is needed for dispute resolution — per `PHASE_10_AUDIT_ADMIN.md` step 3, resolving a dispute always emits either `SessionCompleted` or `BookingCancelled`, so this listener covers that path automatically. `isLocked` is deliberately separate from `isOpen`: the conversation stays fully **readable** (by participants and, per step 5, admin) for historical/dispute-evidence purposes, but no new messages can be written once the booking reaches a terminal state.

### 6. `notification.model.js` (Mongo — source of truth for in-app notification feed)
```js
const notificationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: [
      'request',      // Phase 4 — new request sent to stylist
      'offer',        // Phase 4 — new offer received by client
      'booking',      // Phase 5 — booking confirmed
      'payment',      // Phase 6 — payment succeeded/failed
      'message',      // Phase 7 — new chat message
      'reminder',     // Phase 12 — session reminder job
      'review',       // Phase 8 — new review received (stylist)
      'verification', // Phase 2 — ID verification approved/rejected
      'safety',       // Phase 11 — SOS alert, safety report update
      'payout',       // Phase 11 — payout status change
      'system',       // catch-all for admin/platform messages
    ],
  },
  title: String,
  body: String,
  relatedEntityId: Schema.Types.ObjectId,
  isRead: { type: Boolean, default: false },
}, { timestamps: true });
```

> **⚠️ Enum is the Single Source of Truth:** This `type` enum is defined **once here** and must not be redefined or extended in later phase files. When a new phase introduces a new notification type, add it to this list. Later phases (11, 12, etc.) can **use** these type values without touching the model definition.

### 7. Notification service — Firebase Cloud Messaging (FCM)
`notification.service.js#send(userId, payload)`:
1. Persist to MongoDB (`Notification` model — always source of truth for in-app inbox).
2. Fetch target user's registered FCM device token(s).
3. Send push payload via `admin.messaging().sendEachForMulticast()`. FCM delivers in-app banners when open and system tray notifications when app is in background/closed.
4. (Phase 12) Also queue an email for critical types via BullMQ — stub the queue call now.

### 8. Wire up all the event listeners deferred from earlier phases
This is the phase where the "TODO: Phase 7" notification hooks from Phases 2, 4, 5, 6, 10, 11 actually get implemented:
- `UserVerified` → notify user.
- `RequestCreated` → notify targeted stylist.
- `RequestDeclined` → notify client.
- `RequestExpired` → notify client.
- `OfferCreated` → notify client.
- `OfferAccepted` → notify stylist.
- `BookingCreated` → notify both parties.
- `PaymentSucceeded` → notify client (receipt) + stylist (booking confirmed).
- `SessionCompleted` → notify both (review prompt to client).
- `SessionDisputed` → notify admin (surfaced in the admin dispute queue) + the non-filing party.
- `BookingCancelled` → notify both parties.
- `PaymentRefunded` → notify client.

### 9. Endpoints
- `GET /notifications` — paginated, filter by `isRead`/`type`.
- `PATCH /notifications/:id/read`
- `PATCH /notifications/read-all`
- `POST /users/fcm-token` — register/update user device FCM tokens.

---

## Definition of Done

**Chat (Firebase)**
- [x] `/chat/token` only succeeds for an already-authenticated user (cookie or Bearer) and returns a valid Firebase custom token with `{ role }` custom claims.
- [x] A non-participant's Firestore read/write on a conversation is rejected by Security Rules and backend controllers with 403 Forbidden.
- [x] A conversation with `isOpen: false` rejects message writes; after a mock payment succeeds, the same conversation becomes writable via `PaymentSucceeded` listener.
- [x] Messages persist in the Firestore subcollection and are returned in correct order via the REST history endpoint (`GET /api/v1/chat/:conversationId/messages`).
- [x] Direct Firestore client SDK messaging and typing/presence rules configured in `firestore.rules`.
- [x] After `SessionCompleted`/`BookingCancelled`, the conversation's `isLocked` flips to `true`; a subsequent message write attempt (REST or Firestore client) is rejected, but reads still succeed for participants.
- [x] An admin (custom token with `role: 'admin'` claim) can read a conversation's history without being a participant; a non-admin non-participant is rejected.

**Notifications (Firebase Cloud Messaging + Mongo)**
- [x] Every event listed in step 8 produces an in-app notification persisted in Mongo and dispatched via `admin.messaging().sendEachForMulticast()`.
- [x] Notifications persist in Mongo even when the recipient's FCM token is unregistered or offline, and invalid/expired tokens are automatically pruned.
- [x] `POST /api/v1/notifications/device-token` and `DELETE /api/v1/notifications/device-token` register and manage device tokens cleanly.
- [x] Every new route in this phase has an @swagger JSDoc block covering summary, request body, and response codes; /api/docs renders it without errors.
