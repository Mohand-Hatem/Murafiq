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
};

const modulesDir = path.resolve(__dirname, '../modules');
export const apis = [
  path.join(modulesDir, '**/*.routes.js').replace(/\\/g, '/'),
  path.join(modulesDir, '**/*.swagger.js').replace(/\\/g, '/'),
];
