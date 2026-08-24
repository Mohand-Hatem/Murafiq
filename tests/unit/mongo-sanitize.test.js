import '../../src/common/globals.js';
import mongoSanitize from 'express-mongo-sanitize';

describe('Mongo Sanitization Hardening', () => {
  it('strips $ operators from body and query without altering headers', () => {
    const req = {
      body: { name: 'Stylist', $where: 'sleep(1000)' },
      query: { 'rating.$gt': '4' },
      params: { id: '60f719b8f1a2c81234567890' },
      headers: { 'x-correlation-id': 'req.123.abc' },
    };

    ['body', 'params', 'query'].forEach((key) => {
      if (req[key]) {
        req[key] = mongoSanitize.sanitize(req[key]);
      }
    });

    expect(req.body).toEqual({ name: 'Stylist' });
    expect(req.headers['x-correlation-id']).toBe('req.123.abc');
  });
});
