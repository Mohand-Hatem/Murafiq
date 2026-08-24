# Murafiq (مرافق) — Project Structure & Technology Reference

> This document is the single source of truth for: the idea, the technology stack, and the full folder/file structure of the backend. Every other document (phases, routes, skeleton status) refers back to this file. Keep it updated whenever a new module, provider, or top-level folder is added.

---

## 1. The Idea (One Paragraph)

Murafiq is a production-grade marketplace backend that connects **Clients** with **Personal Stylists / Shopping Companions** for **offline, in-person** shopping/styling sessions. A Client posts a Request, a Companion (Stylist) sends an Offer (price + duration), the Client accepts, the system creates a Booking inside a MongoDB transaction, payment is collected, a Chat conversation opens, the offline session happens, and afterward the Client leaves a Review. Everything is built as a **Modular Monolith** with clean separation between HTTP layer, business logic, and data access, so any module can later be extracted into its own service without a rewrite.

---

## 2. Full Technology Stack

| Concern | Technology | Status |
|---|---|---|
| Runtime | Node.js (ESM `"type": "module"`) | Active |
| Framework | Express.js | Active |
| Database | MongoDB + Mongoose (Connection pooling, in-memory replica set for tests) | Active |
| Auth | JWT (access 15m + refresh 30d) via httpOnly cookie (web) or Bearer (mobile), bcrypt (12 rounds), Google Sign-In (`google-auth-library` ID-token verification), hashed OTP with 5-attempt brute-force lockout, session invalidation on password change. Four roles: `client`, `stylist`, `admin`, `operator`. | Active |
| Validation | Zod with strict schemas (`.strict()`) | Active |
| File Storage | Cloudinary + Multer (`memoryStorage`), authenticated KYC document upload & signed URL retrieval | Active |
| Payments | Custom provider interface → Mock provider (active) → Paymob (🔲 sandbox-untested) | Partial |
| Payouts | Manual bank transfer / Vodafone Cash / Instapay ledger, 48h escrow hold, batch disbursement, double-payout guards | Active |
| Realtime (chat & notifications) | Firebase (Firestore for Chat + FCM for Push & In-App Notifications, fail-closed in prod, in-memory mock in dev/test) | Active |
| Queue / Jobs | BullMQ + Redis | 🔲 Planned (Phase 12) |
| Mail | `mail.service.js` shim (Active) → Resend / SendGrid (🔲 Planned Phase 9) | Partial |
| AI | LangChain + LangGraph + OpenAI + RAG (Pinecone/Qdrant) | 🔲 Planned (Phase 15) |
| Logging | Winston (structured JSON + daily rotating files) + Morgan | Active |
| Security | Helmet, CORS, express-mongo-sanitize (body/params/query), rate-limiter, trusted proxy headers | Active |
| Testing | Jest + Supertest (unit + in-memory MongoDB replica-set integration) | Active (39 suites, 163 tests) |
| API Docs | Swagger / OpenAPI (swagger-jsdoc + swagger-ui-express, admin-gated in production) | Active |
| Process/Env | dotenv, cross-env | Active |

> 🔲 = planned on the feature roadmap (Phases 9–16), not yet installed or active.

---

## 3. Architectural Principles

1. **Modular Monolith** — one deployable app, strict module boundaries.
2. **Layered architecture per module**: `Route → Validator → Controller → Service → Repository → Model`.
   - Dedicated Swagger files: `<module>.swagger.js` for API docs annotations (keeps `<module>.routes.js` clean).
3. **No cross-module direct Mongoose Model access** — Module A never imports Module B's Mongoose model (e.g. `user.model.js`). To access data owned by Module B, Module A imports Module B's repository (e.g. `user.repository.js`) or calls Module B's service. Direct Model instantiation and raw queries remain strictly encapsulated inside each module's own repository.
   > **Firestore Chat isolation:** only `modules/chat/chat.service.js` touches Firestore via `firebase-admin`. No other module reads/writes chat data directly.
4. **Domain Events** — modules communicate side-effects (e.g. "a booking was created", "payout marked paid") via an internal event emitter (`eventBus`), registered explicitly in `src/app.js`.
5. **Provider Pattern** for anything that has "a real, expensive, or external version" (Payments, Mail) — code depends on an interface, not a specific vendor.
6. **DTOs / Mappers** — Mongoose documents never leak directly to the HTTP response.
7. **Transactions** for any operation that touches more than one collection and must be all-or-nothing (offer acceptance, booking creation, cancellation refunds, batch payout generation, dispute resolution).
8. **Consistent response wrapper** for every endpoint (success/error shape identical across the whole API via `ApiResponse` and `ApiError` globals).
9. **API Versioning** — all routes under `/api/v1/...`.

---

## 4. Full Folder & File Structure

```
murafiq-backend/
│
├── src/
│   ├── config/
│   │   ├── env.config.js              # loads & validates process.env (via Zod)
│   │   ├── database.config.js         # Mongoose connection & pool tuning
│   │   ├── cloudinary.config.js       # Cloudinary SDK init
│   │   ├── firebase.config.js         # firebase-admin init (Firestore + FCM), fail-closed in prod
│   │   ├── logger.config.js           # Winston logger instance
│   │   └── swagger.config.js          # swagger-jsdoc spec definition
│   │
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.routes.js
│   │   │   ├── auth.controller.js
│   │   │   ├── auth.service.js
│   │   │   ├── auth.repository.js
│   │   │   ├── auth.validator.js
│   │   │   ├── auth.swagger.js
│   │   │   └── auth.dto.js
│   │   │
│   │   ├── users/
│   │   │   ├── user.routes.js
│   │   │   ├── user.controller.js
│   │   │   ├── user.service.js
│   │   │   ├── user.repository.js
│   │   │   ├── user.model.js
│   │   │   ├── user.validator.js
│   │   │   ├── user.swagger.js
│   │   │   └── user.dto.js
│   │   │
│   │   ├── stylists/
│   │   │   ├── stylist.routes.js
│   │   │   ├── stylist.controller.js
│   │   │   ├── stylist.service.js
│   │   │   ├── stylist.repository.js
│   │   │   ├── stylist-profile.model.js
│   │   │   ├── stylist.validator.js
│   │   │   ├── stylist.listener.js
│   │   │   ├── stylist.swagger.js
│   │   │   ├── stylist.dto.js
│   │   │   └── stylist-search.service.js   # filters, pagination, geo ($geoNear)
│   │   │
│   │   ├── requests/
│   │   │   ├── request.routes.js
│   │   │   ├── request.controller.js
│   │   │   ├── request.service.js
│   │   │   ├── request.repository.js
│   │   │   ├── request.model.js
│   │   │   ├── request.validator.js
│   │   │   ├── request.swagger.js
│   │   │   └── request.dto.js
│   │   │
│   │   ├── offers/
│   │   │   ├── offer.routes.js
│   │   │   ├── offer.controller.js
│   │   │   ├── offer.service.js
│   │   │   ├── offer.repository.js
│   │   │   ├── offer.model.js
│   │   │   ├── offer.validator.js
│   │   │   ├── offer.swagger.js
│   │   │   └── offer.dto.js
│   │   │
│   │   ├── bookings/
│   │   │   ├── booking.routes.js
│   │   │   ├── booking.controller.js
│   │   │   ├── booking.service.js          # runs MongoDB transactions, dispute arbitration
│   │   │   ├── booking.repository.js
│   │   │   ├── booking.model.js
│   │   │   ├── booking.validator.js
│   │   │   ├── booking.swagger.js
│   │   │   ├── booking.dto.js
│   │   │   ├── schedule.model.js           # calendar schedule blocks
│   │   │   └── schedule.repository.js
│   │   │
│   │   ├── payments/
│   │   │   ├── payment.routes.js
│   │   │   ├── payment.controller.js
│   │   │   ├── payment.service.js          # refund ledger, 15% platform commission
│   │   │   ├── payment.repository.js
│   │   │   ├── payment.model.js
│   │   │   ├── payment.validator.js
│   │   │   ├── payment.swagger.js
│   │   │   └── providers/
│   │   │       ├── payment-provider.interface.js
│   │   │       ├── mock.provider.js         # active in dev/test
│   │   │       └── paymob.provider.js       # 🔲 sandbox-untested
│   │   │
│   │   ├── payouts/
│   │   │   ├── payout.routes.js
│   │   │   ├── payout.controller.js
│   │   │   ├── payout.service.js            # 48h hold, batch disbursement, state guards
│   │   │   ├── payout.repository.js
│   │   │   ├── payout.model.js
│   │   │   ├── payout.validator.js
│   │   │   └── payout.swagger.js
│   │   │
│   │   ├── chat/                            # backed by Firestore, not Mongo
│   │   │   ├── chat.routes.js               # message history + custom-token issuance
│   │   │   ├── chat.controller.js
│   │   │   ├── chat.listener.js
│   │   │   ├── chat.validator.js
│   │   │   ├── chat.swagger.js
│   │   │   └── chat.service.js              # talks to Firestore (via firebase-admin)
│   │   │
│   │   ├── notifications/
│   │   │   ├── notification.routes.js
│   │   │   ├── notification.controller.js
│   │   │   ├── notification.service.js
│   │   │   ├── notification.repository.js
│   │   │   ├── notification.model.js
│   │   │   ├── notification.listener.js     # subscribes to domain events
│   │   │   ├── notification.validator.js
│   │   │   └── notification.swagger.js
│   │   │
│   │   ├── reviews/
│   │   │   ├── review.routes.js
│   │   │   ├── review.controller.js
│   │   │   ├── review.service.js
│   │   │   ├── review.repository.js
│   │   │   ├── review.model.js
│   │   │   ├── review.listener.js
│   │   │   ├── review.validator.js
│   │   │   └── review.swagger.js
│   │   │
│   │   ├── uploads/
│   │   │   ├── upload.routes.js
│   │   │   ├── upload.controller.js
│   │   │   ├── upload.service.js            # Cloudinary uploads & signed KYC URLs
│   │   │   ├── upload.middleware.js         # multer memoryStorage
│   │   │   ├── upload.validator.js
│   │   │   └── upload.swagger.js
│   │   │
│   │   ├── mail/
│   │   │   └── mail.service.js              # typed ApiError(502) shim (🔲 Phase 9)
│   │   │
│   │   ├── audit-log/
│   │   │   ├── audit-log.routes.js
│   │   │   ├── audit-log.controller.js
│   │   │   ├── audit-log.service.js
│   │   │   ├── audit-log.repository.js
│   │   │   ├── audit-log.model.js
│   │   │   └── audit-log.listener.js        # subscribes to domain audit events
│   │   │
│   │   ├── admin/
│   │   │   ├── admin.routes.js              # verifications, dispute resolution, review hide
│   │   │   ├── admin.controller.js
│   │   │   ├── admin.service.js
│   │   │   ├── admin.validator.js
│   │   │   └── admin.swagger.js
│   │   │
│   │   ├── safety/                          # 🔲 Planned (Phase 11)
│   │   ├── wardrobe/                        # 🔲 Planned (Phase 14)
│   │   └── ai/                              # 🔲 Planned (Phase 15)
│   │
│   ├── common/
│   │   ├── middlewares/
│   │   │   ├── auth.middleware.js
│   │   │   ├── rbac.middleware.js           # restrictTo(...roles) — variadic; operator gets verification review
│   │   │   ├── error-handler.middleware.js
│   │   │   ├── rate-limiter.middleware.js
│   │   │   ├── auth-rate-limiter.middleware.js
│   │   │   ├── validate.middleware.js       # runs Zod schemas (.strict())
│   │   │   └── not-found.middleware.js
│   │   ├── validators/
│   │   │   └── shared.validator.js          # objectIdField, paginationQuerySchema, etc.
│   │   ├── utils/
│   │   │   ├── ApiError.js                  # global
│   │   │   ├── ApiResponse.js               # global
│   │   │   ├── asyncHandler.js              # global
│   │   │   ├── generateTokens.js
│   │   │   ├── generateOtp.js
│   │   │   ├── authCookies.util.js          # dual-mode (cookie/Bearer) token delivery
│   │   │   ├── businessDay.util.js          # Cairo calendar day bounds (DST-safe)
│   │   │   ├── regex.util.js                # escapeRegex for safe search
│   │   │   └── timeUtils.js
│   │   ├── constants/
│   │   │   ├── roles.constant.js            # ROLES: client | stylist | admin | operator
│   │   │   ├── statuses.constant.js
│   │   │   ├── events.constant.js
│   │   │   └── defaults.constant.js         # DEFAULT_PROFILE_IMAGE_URL, BUSINESS_TIMEZONE, DEFAULT_CAPS
│   │   ├── events/
│   │   │   └── event-bus.js                 # EventEmitter wrapper
│   │   └── query-builder/
│   │       └── QueryBuilder.js              # bounded pagination, filter, sort, search
│   │
│   ├── routes/
│   │   └── index.js                         # mounts all active module routers under /api/v1
│   │
│   ├── app.js                               # Express app configuration & domain listeners
│   └── server.js                            # HTTP server bootstrap & DB connect
│
├── tests/
│   ├── setup/
│   │   └── db-handler.js                    # mongodb-memory-server replica set harness
│   ├── unit/                                # isolated service & repository unit tests
│   └── integration/                         # full supertest endpoint tests
│
├── scripts/
│   └── seed-admin.js                        # idempotent bootstrap script for first admin
│
├── docs/
├── logs/
├── .env.example
├── .prettierrc
├── eslint.config.js
├── firestore.rules
├── package.json
└── README.md
```

---

## 5. Related Documents

- `00_PHASES_INDEX.md` — the master checklist and phase order.
- `02_PROJECT_RULES.md` — the mandatory process contract for developers and AI agents.
- `03_SKELETON_STATUS.md` — verified state of what is real vs. skeleton/placeholder.
- `04_ROUTES.md` — route dictionary with active status indicators.
- `HARDENING_00_INDEX.md` — the hardening and correctness roadmap.
