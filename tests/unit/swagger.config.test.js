import {
  swaggerDefinition,
  demoSwaggerDefinition,
  buildDemoSwaggerSpec,
  apis,
} from '../../src/config/swagger.config.js';

describe('Swagger Config Hardening', () => {
  it('defines valid OpenAPI structure with configured server URL', () => {
    expect(swaggerDefinition.openapi).toBe('3.0.0');
    expect(swaggerDefinition.servers[0].url).toContain('/api/v1');
  });

  it('defines valid Demo OpenAPI structure with configured demo server URL', () => {
    expect(demoSwaggerDefinition.openapi).toBe('3.0.0');
    expect(demoSwaggerDefinition.info.title).toBe('Murafiq Demo API');
    expect(demoSwaggerDefinition.servers[0].url).toContain('/api/demo');
  });

  it('buildDemoSwaggerSpec strips payment, payout, coupon, admin, and paid-only AI paths while preserving allowed routes', () => {
    const mockFullSpec = {
      paths: {
        '/api/v1/auth/login': { post: {} },
        '/api/v1/payments/checkout': { post: {} },
        '/api/v1/payouts': { get: {} },
        '/api/v1/coupons/apply': { post: {} },
        '/api/v1/admin/users': { get: {} },
        '/api/v1/subscriptions/plans': { get: {} },
        '/api/v1/subscriptions/checkout': { post: {} },
        '/ai/stylist': { post: {} },
        '/ai/conversations': { get: {} },
        '/ai/try-on': { post: {} },
        '/ai/try-on/{id}': { get: {} },
        '/ai/shape-model': { post: {} },
        '/ai/outfits': { get: {} },
        '/stylists/me/payouts': { get: {} },
      },
      components: { schemas: {} },
    };

    const demoSpec = buildDemoSwaggerSpec(mockFullSpec);
    expect(demoSpec.info.title).toBe('Murafiq Demo API');
    expect(demoSpec.paths['/auth/login']).toBeDefined();
    expect(demoSpec.paths['/subscriptions/plans']).toBeDefined();
    expect(demoSpec.paths['/ai/stylist']).toBeDefined();
    expect(demoSpec.paths['/ai/conversations']).toBeDefined();
    expect(demoSpec.paths['/payments/checkout']).toBeUndefined();
    expect(demoSpec.paths['/payouts']).toBeUndefined();
    expect(demoSpec.paths['/coupons/apply']).toBeUndefined();
    expect(demoSpec.paths['/admin/users']).toBeUndefined();
    expect(demoSpec.paths['/subscriptions/checkout']).toBeUndefined();
    expect(demoSpec.paths['/ai/try-on']).toBeUndefined();
    expect(demoSpec.paths['/ai/try-on/{id}']).toBeUndefined();
    expect(demoSpec.paths['/ai/shape-model']).toBeUndefined();
    expect(demoSpec.paths['/ai/outfits']).toBeUndefined();
    expect(demoSpec.paths['/stylists/me/payouts']).toBeUndefined();
  });

  it('resolves absolute file paths for Swagger discovery', () => {
    expect(apis.length).toBeGreaterThanOrEqual(2);
    expect(apis[0]).toContain('/src/modules/');
  });
});
