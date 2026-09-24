import path from 'path';
import { fileURLToPath } from 'url';
import env from './env.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Murafiq API',
    version: '1.0.0',
    description: 'API documentation for Murafiq backend service',
  },
  servers: [
    {
      url: env.API_BASE_URL || `http://localhost:${env.PORT}/api/v1`,
      description: env.NODE_ENV === 'production' ? 'Production Server' : 'Development Server',
    },
  ],
  components: {
    // Without these an importer (API Dog, Postman, Insomnia) has no way to know how to
    // authenticate, so every protected endpoint imports as anonymous and fails on first
    // call. Both real transports are declared because the API genuinely serves two client
    // types — see authCookies.util.js.
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Mobile clients. Send `X-Client-Type: mobile` on login/refresh to receive tokens in the response body, then pass the access token as `Authorization: Bearer <token>`.',
      },
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'accessToken',
        description:
          'Web clients (default). Login/refresh set httpOnly `accessToken` and `refreshToken` cookies; the browser sends them automatically.',
      },
    },
    schemas: {
      // Referenced by paginated list responses. It was referenced but never defined,
      // leaving a dangling $ref that breaks strict OpenAPI importers.
      PaginationMeta: {
        type: 'object',
        properties: {
          total: { type: 'integer', example: 42 },
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 10 },
          totalPages: { type: 'integer', example: 5 },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Forbidden' },
        },
      },
    },
    responses: {
      Unauthorized: {
        description:
          'Authentication problem — missing, invalid, expired, or revoked credentials. The client should refresh or sign in again.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
      },
      Forbidden: {
        description:
          'Account authorization problem — suspended, blocked, or insufficient role. Re-authenticating will NOT help.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
      },
      NotFound: {
        description: 'Resource not found.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
      },
      ValidationError: {
        description: 'Request failed validation.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
      },
    },
  },
  // Most of the API is authenticated; the handful of public endpoints override this with
  // `security: []` in their own annotation.
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
};

const modulesDir = path.resolve(__dirname, '../modules');
export const apis = [
  path.join(modulesDir, '**/*.routes.js').replace(/\\/g, '/'),
  path.join(modulesDir, '**/*.swagger.js').replace(/\\/g, '/'),
];

export const demoSwaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Murafiq Demo API',
    version: '1.0.0',
    description:
      'API documentation for Murafiq Demo trial release. Exposes Free plan capabilities and Cash-on-Delivery (COD) booking workflows without payment gateways or platform payouts.',
  },
  servers: [
    {
      url: env.API_BASE_URL
        ? env.API_BASE_URL.replace(/\/api\/v1$/, '/api/demo')
        : `http://localhost:${env.PORT}/api/demo`,
      description: env.NODE_ENV === 'production' ? 'Demo Production Server' : 'Demo Development Server',
    },
  ],
  components: swaggerDefinition.components,
  security: swaggerDefinition.security,
};

const OMITTED_DEMO_PATH_PREFIXES = ['/payments', '/payouts', '/coupons', '/admin'];
const ALLOWED_DEMO_SUBSCRIPTION_PATHS = new Set([
  '/subscriptions/plans',
  '/subscriptions/me',
  '/subscriptions/me/entitlements',
]);

const normaliseRoute = (route) =>
  route
    .replace('/api/v1', '')
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}')
    .replace(/\/+$/, '') || '/';

export const buildDemoSwaggerSpec = (fullSpec) => {
  const demoPaths = {};

  for (const [p, ops] of Object.entries(fullSpec.paths || {})) {
    const norm = normaliseRoute(p);

    if (OMITTED_DEMO_PATH_PREFIXES.some((prefix) => norm.startsWith(prefix))) {
      continue;
    }

    if (norm.startsWith('/subscriptions') && !ALLOWED_DEMO_SUBSCRIPTION_PATHS.has(norm)) {
      continue;
    }

    demoPaths[norm] = ops;
  }

  return {
    ...demoSwaggerDefinition,
    components: fullSpec.components || demoSwaggerDefinition.components,
    paths: demoPaths,
  };
};
