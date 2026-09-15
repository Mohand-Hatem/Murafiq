import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import sharp from 'sharp';
import '../../src/common/globals.js';
import env from '../../src/config/env.config.js';
import {
  OpenRouterImageProvider,
  openrouterImageProvider,
} from '../../src/modules/ai/providers/openrouter-image.provider.js';
import {
  getImageProvider,
  setImageProvider,
} from '../../src/modules/ai/providers/image-provider.factory.js';

describe('Phase 15F — OpenRouter Image Provider Tests', () => {
  let samplePersonBuffer;
  let sampleGarmentBuffer1;
  let sampleGarmentBuffer2;
  const originalFetch = globalThis.fetch;
  const originalApiKey = env.OPENROUTER_API_KEY;

  beforeEach(async () => {
    setImageProvider(null);
    jest.restoreAllMocks();
    env.OPENROUTER_API_KEY = 'test_openrouter_mock_key';

    samplePersonBuffer = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .jpeg()
      .toBuffer();

    sampleGarmentBuffer1 = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .toBuffer();

    sampleGarmentBuffer2 = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 40, g: 50, b: 60 } },
    })
      .jpeg()
      .toBuffer();
  });

  afterEach(() => {
    setImageProvider(null);
    globalThis.fetch = originalFetch;
    env.OPENROUTER_API_KEY = originalApiKey;
    jest.restoreAllMocks();
  });

  describe('Input Validation', () => {
    it('rejects invalid or missing personImageBuffer', async () => {
      await expect(
        openrouterImageProvider.generateTryOn({
          personImageBuffer: null,
          garmentImages: [{ buffer: sampleGarmentBuffer1 }],
        })
      ).rejects.toThrow('personImageBuffer must be a valid Buffer');
    });

    it('rejects empty garmentImages array', async () => {
      await expect(
        openrouterImageProvider.generateTryOn({
          personImageBuffer: samplePersonBuffer,
          garmentImages: [],
        })
      ).rejects.toThrow('garmentImages must contain at least 1 garment');
    });

    it('rejects when OPENROUTER_API_KEY is unset', async () => {
      env.OPENROUTER_API_KEY = '';
      const savedProcessKey = process.env.OPENROUTER_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      try {
        await expect(
          openrouterImageProvider.generateTryOn({
            personImageBuffer: samplePersonBuffer,
            garmentImages: [{ buffer: sampleGarmentBuffer1 }],
          })
        ).rejects.toThrow('OPENROUTER_API_KEY is not configured');
      } finally {
        if (savedProcessKey) process.env.OPENROUTER_API_KEY = savedProcessKey;
      }
    });
  });

  describe('Generation Flow and Request Formatting', () => {
    it('successfully calls OpenRouter with verified input_references schema and returns normalized result', async () => {
      const dummyGeneratedBase64 = samplePersonBuffer.toString('base64');
      let capturedUrl = null;
      let capturedOptions = null;

      globalThis.fetch = jest.fn(async (url, options) => {
        capturedUrl = url;
        capturedOptions = options;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            created: 1782837225,
            data: [
              {
                b64_json: dummyGeneratedBase64,
                media_type: 'image/jpeg',
              },
            ],
          }),
        };
      });

      const result = await openrouterImageProvider.generateTryOn({
        personImageBuffer: samplePersonBuffer,
        personMimeType: 'image/jpeg',
        garmentImages: [
          { buffer: sampleGarmentBuffer1, mimeType: 'image/jpeg', slot: 'top', label: 'Dress Shirt' },
          { buffer: sampleGarmentBuffer2, mimeType: 'image/jpeg', slot: 'bottom', label: 'Jeans' },
        ],
        promptVersion: 'v1',
        resolution: '1024x1024',
      });

      // Verify endpoint and method
      expect(capturedUrl).toBe('https://openrouter.ai/api/v1/images');
      expect(capturedOptions.method).toBe('POST');
      expect(capturedOptions.headers.Authorization).toBe('Bearer test_openrouter_mock_key');
      expect(capturedOptions.headers['Content-Type']).toBe('application/json');

      // Verify payload structure
      const parsedBody = JSON.parse(capturedOptions.body);
      expect(parsedBody.model).toBeDefined();
      expect(parsedBody.prompt).toContain('High-fidelity Photorealistic Virtual Try-On Composite');
      expect(parsedBody.aspect_ratio).toBe('1:1');
      expect(Array.isArray(parsedBody.input_references)).toBe(true);
      expect(parsedBody.input_references.length).toBe(3); // 1 shape model + 2 garments

      // First reference must be the shape model
      expect(parsedBody.input_references[0].type).toBe('image_url');
      expect(parsedBody.input_references[0].image_url.url).toContain('data:image/jpeg;base64,');

      // Subsequent references are the garments
      expect(parsedBody.input_references[1].type).toBe('image_url');
      expect(parsedBody.input_references[2].type).toBe('image_url');

      // Verify normalized output contract
      expect(result.provider).toBe('openrouter');
      expect(result.promptVersion).toBe('v1');
      expect(result.width).toBe(1024);
      expect(result.height).toBe(1024);
      expect(result.mimeType).toBe('image/jpeg');
      expect(Buffer.isBuffer(result.imageBuffer)).toBe(true);
      expect(result.imageBuffer.length).toBe(samplePersonBuffer.length);
      expect(typeof result.latencyMs).toBe('number');
    });

    it('supports result delivered via URL instead of b64_json', async () => {
      globalThis.fetch = jest.fn(async (url) => {
        if (url === 'https://openrouter.ai/api/v1/images') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ url: 'https://cdn.openrouter.ai/generated/img-123.png' }],
            }),
          };
        }
        if (url === 'https://cdn.openrouter.ai/generated/img-123.png') {
          return {
            ok: true,
            status: 200,
            headers: {
              get: (header) => (header.toLowerCase() === 'content-type' ? 'image/png' : null),
            },
            arrayBuffer: async () => sampleGarmentBuffer1.buffer,
          };
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      });

      const result = await openrouterImageProvider.generateTryOn({
        personImageBuffer: samplePersonBuffer,
        garmentImages: [{ buffer: sampleGarmentBuffer1 }],
      });

      expect(result.provider).toBe('openrouter');
      expect(result.mimeType).toBe('image/png');
      expect(Buffer.isBuffer(result.imageBuffer)).toBe(true);
    });
  });

  describe('Error Handling and Sanitization', () => {
    it('handles 401/403 authentication failures and redacts tokens', async () => {
      globalThis.fetch = jest.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          error: { message: 'Invalid token: Bearer test_openrouter_mock_key' },
        }),
      }));

      await expect(
        openrouterImageProvider.generateTryOn({
          personImageBuffer: samplePersonBuffer,
          garmentImages: [{ buffer: sampleGarmentBuffer1 }],
        })
      ).rejects.toThrow('OpenRouter authentication failure: Invalid token: Bearer [REDACTED]');
    });

    it('handles 402 payment/insufficient credits error', async () => {
      globalThis.fetch = jest.fn(async () => ({
        ok: false,
        status: 402,
        json: async () => ({
          error: { message: 'Insufficient credits. This account never purchased credits.' },
        }),
      }));

      await expect(
        openrouterImageProvider.generateTryOn({
          personImageBuffer: samplePersonBuffer,
          garmentImages: [{ buffer: sampleGarmentBuffer1 }],
        })
      ).rejects.toThrow('OpenRouter payment/credit error');
    });

    it('handles 429 rate limit exceeded error', async () => {
      globalThis.fetch = jest.fn(async () => ({
        ok: false,
        status: 429,
        json: async () => ({
          error: { message: 'Rate limit reached' },
        }),
      }));

      await expect(
        openrouterImageProvider.generateTryOn({
          personImageBuffer: samplePersonBuffer,
          garmentImages: [{ buffer: sampleGarmentBuffer1 }],
        })
      ).rejects.toThrow('OpenRouter rate limit exceeded');
    });

    it('handles network timeouts cleanly', async () => {
      globalThis.fetch = jest.fn(async () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      });

      await expect(
        openrouterImageProvider.generateTryOn({
          personImageBuffer: samplePersonBuffer,
          garmentImages: [{ buffer: sampleGarmentBuffer1 }],
          timeoutMs: 50,
        })
      ).rejects.toThrow(/timed out/);
    });

    it('handles empty or missing data array in 200 response', async () => {
      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      }));

      await expect(
        openrouterImageProvider.generateTryOn({
          personImageBuffer: samplePersonBuffer,
          garmentImages: [{ buffer: sampleGarmentBuffer1 }],
        })
      ).rejects.toThrow('OpenRouter returned empty data array');
    });
  });

  describe('Factory Resolution', () => {
    it('resolves openrouter provider via getImageProvider("openrouter")', () => {
      const provider = getImageProvider('openrouter');
      expect(provider).toBeInstanceOf(OpenRouterImageProvider);
    });

    it('rejects unknown provider', () => {
      expect(() => getImageProvider('unknown_provider')).toThrow(
        /Supported providers are 'gemini', 'mock', and 'openrouter'/
      );
    });
  });
});
