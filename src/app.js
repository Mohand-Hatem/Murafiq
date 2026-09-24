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
import { swaggerDefinition, apis, buildDemoSwaggerSpec } from './config/swagger.config.js';
import rateLimiter from './common/middlewares/rate-limiter.middleware.js';
import authMiddleware from './common/middlewares/auth.middleware.js';
import { restrictTo } from './common/middlewares/rbac.middleware.js';
import { ROLES } from './common/constants/roles.constant.js';
import errorHandler from './common/middlewares/error-handler.middleware.js';
import notFoundHandler from './common/middlewares/not-found.middleware.js';
import routes from './routes/index.js';
import demoRoutes from './routes/demo.routes.js';
import notificationListener from './modules/notifications/notification.listener.js';
import auditLogListener from './modules/audit-log/audit-log.listener.js';
import stylistListener from './modules/stylists/stylist.listener.js';
import chatListener from './modules/chat/chat.listener.js';
import reviewListener from './modules/reviews/review.listener.js';

// Initialize domain event listeners
notificationListener.register();
auditLogListener.register();
stylistListener.register();
chatListener.register();
reviewListener.register();

const app = express();

// Trust single reverse-proxy hop (Render, Railway, Nginx) for accurate client IP resolution
app.set('trust proxy', 1);

// Security & utility middlewares
app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL || '*', credentials: true }));
app.use(compression());
app.use(
  express.json({
    limit: '10kb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// Express 5 compatible wrapper for mongoSanitize (handles getter-only properties like req.query)
app.use((req, res, next) => {
  ['body', 'params', 'query'].forEach((key) => {
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

// API Docs — V1 and Demo specifications
const swaggerSpec = swaggerJsdoc({ definition: swaggerDefinition, apis });
const demoSwaggerSpec = buildDemoSwaggerSpec(swaggerSpec);

if (env.NODE_ENV === 'production') {
  app.use('/api/docs/demo', authMiddleware, restrictTo(ROLES.ADMIN), swaggerUi.serve, swaggerUi.setup(demoSwaggerSpec));
  app.get('/api/docs/demo.json', authMiddleware, restrictTo(ROLES.ADMIN), (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(demoSwaggerSpec);
  });
  app.use('/api/demo/docs', authMiddleware, restrictTo(ROLES.ADMIN), swaggerUi.serve, swaggerUi.setup(demoSwaggerSpec));
  app.get('/api/demo/docs.json', authMiddleware, restrictTo(ROLES.ADMIN), (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(demoSwaggerSpec);
  });

  app.use('/api/docs', authMiddleware, restrictTo(ROLES.ADMIN), swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api/docs.json', authMiddleware, restrictTo(ROLES.ADMIN), (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
} else {
  app.use('/api/docs/demo', swaggerUi.serve, swaggerUi.setup(demoSwaggerSpec));
  app.get('/api/docs/demo.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(demoSwaggerSpec);
  });
  app.use('/api/demo/docs', swaggerUi.serve, swaggerUi.setup(demoSwaggerSpec));
  app.get('/api/demo/docs.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(demoSwaggerSpec);
  });

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api/docs.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}

// API Routes
app.use('/api/v1', routes);
app.use('/api/demo', demoRoutes);

// 404 & Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
