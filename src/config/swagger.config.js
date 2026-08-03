import env from './env.config.js';

export const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Murafiq API',
    version: '1.0.0',
    description: 'API documentation for Murafiq backend service',
  },
  servers: [
    {
      url: `http://localhost:${env.PORT}/api/v1`,
      description: 'Development Server',
    },
  ],
};

export const apis = ['./src/modules/**/*.routes.js', './src/modules/**/*.js'];
