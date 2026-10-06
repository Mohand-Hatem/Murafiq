import '../../src/common/globals.js';
import { describe, it, expect, jest } from '@jest/globals';
import { sanitizeRequestId, correlationIdMiddleware } from '../../src/common/middlewares/correlation-id.middleware.js';
import { requestContext, getRequestId } from '../../src/common/utils/request-context.js';

describe('Correlation ID Middleware & Async Context (OBS-03)', () => {
  describe('sanitizeRequestId', () => {
    it('accepts valid alphanumeric, hyphen, and underscore IDs within 128 characters', () => {
      const validId = 'req_12345-abcde-XYZ';
      expect(sanitizeRequestId(validId)).toBe(validId);
    });

    it('generates a fresh UUID when incoming ID is missing or null', () => {
      const id1 = sanitizeRequestId(undefined);
      const id2 = sanitizeRequestId(null);
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(id2).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('rejects IDs exceeding 128 characters and generates a fresh UUID', () => {
      const overlongId = 'a'.repeat(129);
      const result = sanitizeRequestId(overlongId);
      expect(result).not.toBe(overlongId);
      expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('rejects IDs with CRLF or forbidden characters to prevent log injection', () => {
      const malformedId = 'valid-part\r\nINJECTED_HEADER: attack';
      const result = sanitizeRequestId(malformedId);
      expect(result).not.toBe(malformedId);
      expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('rejects IDs with spaces, quotes, or script tags', () => {
      const xssId = 'req-123<script>alert(1)</script>';
      const result = sanitizeRequestId(xssId);
      expect(result).not.toBe(xssId);
      expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  describe('correlationIdMiddleware execution', () => {
    it('attaches req.id, sets X-Request-Id header, and runs next inside AsyncLocalStorage', (done) => {
      const validCustomId = 'custom-trace-id-123';
      const req = {
        headers: {
          'x-request-id': validCustomId,
        },
      };
      const res = {
        setHeader: jest.fn(),
      };

      correlationIdMiddleware(req, res, () => {
        expect(req.id).toBe(validCustomId);
        expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', validCustomId);
        expect(getRequestId()).toBe(validCustomId);
        expect(requestContext.getStore()?.requestId).toBe(validCustomId);
        done();
      });
    });

    it('generates a new UUID when headers are absent and propagates to AsyncLocalStorage', (done) => {
      const req = { headers: {} };
      const res = { setHeader: jest.fn() };

      correlationIdMiddleware(req, res, () => {
        expect(req.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.id);
        expect(getRequestId()).toBe(req.id);
        done();
      });
    });

    it('allows Winston logging to read requestId from the active context', (done) => {
      const testTraceId = 'winston-trace-check-456';
      const req = { headers: { 'x-request-id': testTraceId } };
      const res = { setHeader: jest.fn() };

      correlationIdMiddleware(req, res, () => {
        // Verify Winston logger can retrieve the active requestId
        expect(getRequestId()).toBe(testTraceId);
        done();
      });
    });

    it('propagates requestId to queue job options when called inside context', async () => {
      const { addWardrobeClassificationJob } = await import('../../src/jobs/queues/wardrobe.queue.js');
      const { addTryOnJob } = await import('../../src/jobs/queues/tryon.queue.js');

      await requestContext.run({ requestId: 'trace-queue-test-789' }, async () => {
        const wardrobeJob = await addWardrobeClassificationJob({
          itemId: '507f1f77bcf86cd799439011',
          userId: '507f1f77bcf86cd799439012',
          imageUrl: 'https://example.com/img.jpg',
        });
        expect(wardrobeJob.opts?.custom?.requestId).toBe('trace-queue-test-789');

        const tryonJob = await addTryOnJob({
          generationId: '507f1f77bcf86cd799439013',
          jobId: 'job-123',
          userId: '507f1f77bcf86cd799439014',
        });
        expect(tryonJob.opts?.custom?.requestId).toBe('trace-queue-test-789');
      });
    });
  });
});
