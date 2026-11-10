import { safeSerializeMeta, redactSensitiveQuery } from '../../src/config/logger.config.js';

describe('Logger Configuration — Safe Metadata Serialization (OBS-02)', () => {
  it('serializes primitive metadata values', () => {
    const meta = { userId: 'user_123', count: 42, active: true };
    const result = safeSerializeMeta(meta);
    expect(result).toBe(' {"userId":"user_123","count":42,"active":true}');
  });

  it('serializes nested metadata objects and arrays', () => {
    const meta = { details: { bookingId: 'b_999', tags: ['vip', 'urgent'] } };
    const result = safeSerializeMeta(meta);
    expect(result).toBe(' {"details":{"bookingId":"b_999","tags":["vip","urgent"]}}');
  });

  it('serializes Error objects as { name, message } without duplicating stack', () => {
    const err = new Error('Database connection failed');
    const meta = { error: err };
    const result = safeSerializeMeta(meta);
    expect(result).toBe(' {"error":{"name":"Error","message":"Database connection failed"}}');
    expect(result).not.toContain('at Object');
  });

  it('handles circular object references without throwing', () => {
    const circularObj = { name: 'cycle' };
    circularObj.self = circularObj;
    const meta = { payload: circularObj };
    const result = safeSerializeMeta(meta);
    expect(result).toBe(' {"payload":{"name":"cycle","self":"[Circular]"}}');
  });

  it('serializes BigInt values as strings', () => {
    const meta = { largeNum: BigInt('9007199254740991000') };
    const result = safeSerializeMeta(meta);
    expect(result).toBe(' {"largeNum":"9007199254740991000"}');
  });

  it('serializes Buffer values with length description', () => {
    const meta = { buf: Buffer.from('hello world') };
    const result = safeSerializeMeta(meta);
    expect(result).toBe(' {"buf":"[Buffer 11 bytes]"}');
  });

  it('tolerates throwing getters without failing serialization', () => {
    const dangerousObj = {};
    Object.defineProperty(dangerousObj, 'badProp', {
      get() {
        throw new Error('Access denied');
      },
      enumerable: true,
    });
    const meta = { safe: 'ok', dangerous: dangerousObj };
    const result = safeSerializeMeta(meta);
    expect(result).toContain('"safe":"ok"');
    expect(result).toContain('"badProp":"[Unreadable]"');
  });

  it('omits Winston internal and reserved properties (requestId, stack, splat)', () => {
    const meta = {
      requestId: 'req-abc-123',
      stack: 'Error stack trace',
      message: 'Original message',
      level: 'info',
      timestamp: '2026-10-06',
      splat: [],
      usefulField: 'retained',
    };
    const result = safeSerializeMeta(meta);
    expect(result).toBe(' {"usefulField":"retained"}');
  });

  it('returns empty string when no extra metadata is present', () => {
    expect(safeSerializeMeta(null)).toBe('');
    expect(safeSerializeMeta(undefined)).toBe('');
    expect(safeSerializeMeta({})).toBe('');
    expect(safeSerializeMeta({ requestId: 'abc', level: 'info' })).toBe('');
  });
});

describe('Logger Configuration — HTTP access log redaction (HARDEN-008)', () => {
  it('redacts the Paymob hmac query value from access log lines', () => {
    const line =
      '1.2.3.4 - - [10/Nov/2026] "POST /api/v1/payments/callback?hmac=abc123def&id=9 HTTP/1.1" 200 2';
    const result = redactSensitiveQuery(line);
    expect(result).not.toContain('abc123def');
    expect(result).toContain('?hmac=[REDACTED]&id=9');
  });

  it('redacts hmac when it is not the first query parameter, case-insensitively', () => {
    expect(redactSensitiveQuery('GET /x?a=1&HMAC=secret HTTP/1.1')).toBe('GET /x?a=1&HMAC=[REDACTED] HTTP/1.1');
  });

  it('leaves lines without an hmac untouched', () => {
    const line = 'GET /api/v1/health?verbose=1 HTTP/1.1';
    expect(redactSensitiveQuery(line)).toBe(line);
  });
});
