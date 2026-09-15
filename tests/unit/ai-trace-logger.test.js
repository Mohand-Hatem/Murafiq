import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import {
  createTraceId,
  hashUserId,
  calculateCostUsd,
  logTraceStep,
} from '../../src/modules/ai/utils/trace.logger.js';
import { logger } from '../../src/config/logger.config.js';

describe('Unit — AI Privacy-Safe Trace Logger (trace.logger.js)', () => {
  let loggerInfoSpy;

  beforeEach(() => {
    loggerInfoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('1. createTraceId & hashUserId', () => {
    it('generates a valid UUID string', () => {
      const traceId = createTraceId();
      expect(typeof traceId).toBe('string');
      expect(traceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('creates deterministic salted hash of userId truncated to 16 hex chars', () => {
      const userA = 'user_64f1234567890123456789ab';
      const hash1 = hashUserId(userA);
      const hash2 = hashUserId(userA);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(16);
      expect(/^[0-9a-f]{16}$/.test(hash1)).toBe(true);
    });

    it('produces distinct hashes for distinct userIds', () => {
      const hashA = hashUserId('user_AAA');
      const hashB = hashUserId('user_BBB');

      expect(hashA).not.toBe(hashB);
    });

    it('returns null when userId is missing or null', () => {
      expect(hashUserId(null)).toBeNull();
      expect(hashUserId(undefined)).toBeNull();
    });
  });

  describe('2. calculateCostUsd', () => {
    it('computes expected USD cost for Gemini Flash Lite pricing', () => {
      // 1000 input tokens * $0.000000075 = $0.000075
      // 500 output tokens * $0.00000030 = $0.00015
      // Total = $0.000225
      const cost = calculateCostUsd(1000, 500);
      expect(cost).toBe(0.000225);
    });

    it('returns 0 for zero tokens', () => {
      expect(calculateCostUsd(0, 0)).toBe(0);
    });
  });

  describe('3. logTraceStep & Privacy Invariants', () => {
    it('logs structured telemetry through Winston and returns sanitized payload', () => {
      const entry = {
        traceId: 'trace-123',
        step: 'intent',
        model: 'gemini-3.1-flash-lite',
        inputTokens: 200,
        outputTokens: 50,
        latencyMs: 140,
        userId: 'user_xyz',
        eventType: 'wedding_formal',
        inDomain: true,
      };

      const result = logTraceStep(entry);

      expect(loggerInfoSpy).toHaveBeenCalledTimes(1);
      const logCall = loggerInfoSpy.mock.calls[0][0];

      expect(logCall).toContain('[AI_TRACE]');
      expect(logCall).toContain('"traceId":"trace-123"');
      expect(logCall).toContain('"step":"intent"');
      expect(logCall).toContain('"eventType":"wedding_formal"');
      expect(logCall).toContain('"inDomain":true');

      expect(result.hashedUserId).toHaveLength(16);
      expect(result.costUsd).toBeGreaterThan(0);
    });

    it('strictly strips raw user messages, raw prompts, and image URLs to guarantee PDPL compliance', () => {
      const maliciousLeakEntry = {
        traceId: 'trace-leak-test',
        step: 'compose',
        userId: 'user_xyz',
        // Unsafe PII fields that should NEVER be logged
        message: 'Dinner with my girlfriend Nour at Cairo Marriott',
        userPrompt: 'Tell me what to wear with Nour',
        imageUrl: 'https://res.cloudinary.com/murafiq/image/upload/v1/private_selfie.jpg',
        rawText: 'Secret private user data',
      };

      const result = logTraceStep(maliciousLeakEntry);

      expect(result).not.toHaveProperty('message');
      expect(result).not.toHaveProperty('userPrompt');
      expect(result).not.toHaveProperty('imageUrl');
      expect(result).not.toHaveProperty('rawText');

      const loggedString = loggerInfoSpy.mock.calls[0][0];
      expect(loggedString).not.toContain('Nour');
      expect(loggedString).not.toContain('private_selfie.jpg');
      expect(loggedString).not.toContain('Cairo Marriott');
    });
  });
});
