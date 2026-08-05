import './common/globals.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import morgan from 'morgan';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import env from './config/env.config.js';
import { stream } from './config/logger.config.js';
import { swaggerDefinition, apis } from './config/swagger.config.js';
import rateLimiter from './common/middlewares/rate-limiter.middleware.js';
import errorHandler from './common/middlewares/error-handler.middleware.js';
import notFoundHandler from './common/middlewares/not-found.middleware.js';
import routes from './routes/index.js';

const app = express();

// Security & utility middlewares
app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL || '*', credentials: true }));
app.use(compression());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// Express 5 compatible wrapper for mongoSanitize (handles getter-only properties like req.query)
app.use((req, res, next) => {
  ['body', 'params', 'headers', 'query'].forEach((key) => {
    if (req[key]) {
      const sanitized = mongoSanitize.sanitize(req[key]);
      try {
        req[key] = sanitized;
      } catch {
        Object.defineProperty(req, key, {
          value: sanitized,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
    }
  });
  next();
});
app.use(rateLimiter);

// Logging
if (env.NODE_ENV !== 'test') {
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev', { stream }));
}

// API Docs — mounted from Phase 0 so every phase from here on documents its own routes as it builds them
// (see docs/00_PHASES_INDEX.md), rather than one large retrofit at the end.
const swaggerSpec = swaggerJsdoc({ definition: swaggerDefinition, apis });
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// API Routes
app.use('/api/v1', routes);

// 404 & Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
