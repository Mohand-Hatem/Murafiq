# Phase 0 — Project Setup & Core Infrastructure

## Goal
Stand up an empty, working Express + MongoDB app with every cross-cutting piece (config, error handling, response wrapper, query builder, event bus, logging, security middlewares) in place — **before any business module exists.** Every later phase builds inside this skeleton.

## Depends on
Nothing. This is the starting point.

---

## Steps

### 1. Initialize project
```bash
npm init -y
npm install express mongoose dotenv cors helmet compression cookie-parser \
  express-mongo-sanitize express-rate-limit morgan winston zod bcrypt \
  jsonwebtoken uuid swagger-jsdoc swagger-ui-express
npm install -D nodemon eslint prettier jest supertest cross-env
```
> `swagger-jsdoc`/`swagger-ui-express` are installed here, not in Phase 13 — Swagger UI is wired up in this phase (step 10a below) so every phase from Phase 1 onward documents its routes with `@swagger` blocks as it builds them, instead of one large retrofit at the end.

### 2. Create folder structure
Create every folder from `01_PROJECT_STRUCTURE.md` under `src/`, even the ones that stay empty until later phases (`modules/ai`, `modules/payouts`, etc). Empty folders can hold a `.gitkeep`.

### 3. Environment config (`src/config/env.config.js`)
Load and **validate** `process.env` with Zod at boot — fail fast if a required variable is missing, don't discover it at runtime.

```js
const { z } = require('zod');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('4000'),
  MONGO_URI: z.string(),
  JWT_ACCESS_SECRET: z.string(),
  JWT_REFRESH_SECRET: z.string(),
  REDIS_URL: z.string(),
  CLOUDINARY_CLOUD_NAME: z.string(),
  CLOUDINARY_API_KEY: z.string(),
  CLOUDINARY_API_SECRET: z.string(),
  MAIL_PROVIDER: z.enum(['resend', 'sendgrid']).default('resend'),
  RESEND_API_KEY: z.string(),
  PAYMENT_PROVIDER: z.enum(['mock', 'paymob']).default('mock'),
  FIREBASE_PROJECT_ID: z.string(),
  FIREBASE_CLIENT_EMAIL: z.string(),
  FIREBASE_PRIVATE_KEY: z.string(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

module.exports = parsed.data;
```

### 4. Database connection (`src/database/connection.js`)
Standard Mongoose connect with retry-on-failure logging. Export a `connectDB()` function called from `server.js`.

### 5. Response wrapper (`src/common/response/ApiResponse.js`)
Every controller returns through this — no controller ever calls `res.json()` directly.

```js
class ApiResponse {
  static success(res, { statusCode = 200, message = 'Success', data = null, meta = null }) {
    return res.status(statusCode).json({ success: true, message, data, meta });
  }
}
module.exports = ApiResponse;
```

### 6. Central error class + handler
`src/common/utils/ApiError.js` — a custom `Error` subclass with `statusCode` and `isOperational`.
`src/common/middlewares/error-handler.middleware.js` — last middleware in the chain. Catches `ApiError` and unexpected errors, logs via Winston, and returns the same response shape as `ApiResponse` but with `success: false`.

### 7. `catchAsync` utility
Wraps every async controller so you never write try/catch in a controller:
```js
const catchAsync = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
module.exports = catchAsync;
```

### 8. QueryBuilder (`src/common/query-builder/QueryBuilder.js`)
One reusable class that turns `req.query` into a Mongoose query with pagination, filtering, sorting, search, and field selection. Every module's "list" endpoint (`GET /stylists`, `GET /bookings`, etc.) uses this — do not reimplement pagination per module.

Supported query params: `page`, `limit`, `sort`, `fields`, `search`, plus arbitrary filter fields (e.g. `?city=Cairo&rating[gte]=4`).

### 9. Event bus (`src/common/events/event-bus.js`)
Thin wrapper around Node's built-in `EventEmitter`, exported as a singleton. All domain events (`BookingCreated`, `OfferAccepted`, etc.) go through this instance.

```js
const { EventEmitter } = require('events');
class EventBus extends EventEmitter {}
module.exports = new EventBus();
```

Define event name constants in `src/common/constants/events.constant.js` so modules never hardcode event name strings.

### 10. Security & core middlewares — wire into `app.js`
Order matters:
```js
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(mongoSanitize());
app.use(compression());
app.use(morgan('combined', { stream: winstonStream }));
app.use(rateLimiter); // global baseline; stricter limiters added per-route later (e.g. auth)
app.use('/api/v1', routes);
app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware); // always last
```

### 10a. Swagger UI (`src/config/swagger.config.js`, mounted in `app.js`)
```js
const swaggerSpec = swaggerJsdoc(swaggerDefinition);
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
```
Mount this before `routes` so it's live even with zero business routes yet (the spec will just be near-empty until Phase 1 adds its first `@swagger` blocks). Every phase from here on adds its own annotations as it writes routes — see `01_PROJECT_STRUCTURE.md`.

### 11. Winston logger (`src/config/logger.config.js`)
Separate transports: console (dev), `logs/error.log` (error level), `logs/combined.log` (all levels). Morgan streams HTTP logs into Winston.

### 12. `server.js`
Connects DB → starts HTTP server → attaches Socket.io (bootstrap only, no handler logic yet — this instance is used for the Phase 7 **notifications** system only; chat realtime runs on Firebase, not this socket server) → graceful shutdown handlers (`SIGTERM`, `unhandledRejection`).

### 13. Admin Bootstrap & MongoDB Replica Set for Local Dev
For local development with MongoDB transactions (used in Phase 5 and Phase 4 offer acceptance), run a single-node replica set:
```bash
mongod --replSet rs0 --dbpath <path-to-db-dir>
# Then in mongosh:
rs.initiate()
```

To create or update the initial platform administrator:
```bash
npm run seed:admin
# Or with custom credentials:
SEED_ADMIN_EMAIL="admin@yourdomain.com" SEED_ADMIN_PASSWORD="StrongPassword123!" npm run seed:admin
```

---

## Definition of Done

- [ ] `npm run dev` boots the server with no errors on an empty `modules/` tree.
- [ ] `/api/docs` renders the Swagger UI (even with no documented routes yet).
- [ ] Hitting an unknown route returns the standard error JSON shape via `notFoundMiddleware`.
- [ ] Throwing an `ApiError(400, 'test')` anywhere returns the standard error JSON shape.
- [ ] `.env.example` lists every variable from `env.config.js`.
- [ ] Winston writes to both console and `logs/*.log`.
- [ ] `QueryBuilder` has at least one unit test proving pagination + filter + sort work against a dummy Mongoose model.
- [ ] Event bus emits and receives a test event in a unit test.
- [ ] ESLint + Prettier run clean (`npm run lint`).
