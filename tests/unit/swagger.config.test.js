import { swaggerDefinition, apis } from '../../src/config/swagger.config.js';

describe('Swagger Config Hardening', () => {
  it('defines valid OpenAPI structure with configured server URL', () => {
    expect(swaggerDefinition.openapi).toBe('3.0.0');
    expect(swaggerDefinition.servers[0].url).toContain('/api/v1');
  });

  it('resolves absolute file paths for Swagger discovery', () => {
    expect(apis.length).toBeGreaterThanOrEqual(2);
    expect(apis[0]).toContain('/src/modules/');
  });
});
