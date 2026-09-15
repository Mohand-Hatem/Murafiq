/**
 * Phase 15F Step 3 — Image Generation Provider Seam & Mock Provider Tests.
 *
 * Covers:
 * 1. ImageGenerationProvider interface contract.
 * 2. MockImageProvider input validation, Sharp synthesis, resolution compliance, and overrides.
 * 3. GeminiImageProvider prompt assembly, input validation, and multimodal generation flow.
 * 4. Image Provider Factory resolution, override injection, and production safety boot guard.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import sharp from 'sharp';
import '../../src/common/globals.js';
import env from '../../src/config/env.config.js';
import { ImageGenerationProvider } from '../../src/modules/ai/providers/image-generation.interface.js';
import { MockImageProvider, mockImageProvider } from '../../src/modules/ai/providers/mock-image.provider.js';
import {
  GeminiImageProvider,
  buildTryOnPrompt,
} from '../../src/modules/ai/providers/gemini-image.provider.js';
import {
  getImageProvider,
  setImageProvider,
} from '../../src/modules/ai/providers/image-provider.factory.js';
import * as llmProvider from '../../src/modules/ai/providers/llm.provider.js';

describe('Phase 15F Step 3 — Image Generation Provider Seam', () => {
  let samplePersonBuffer;
  let sampleGarmentBuffer;

  beforeEach(async () => {
    mockImageProvider.reset();
    setImageProvider(null);
    llmProvider.setGenAiClient(null);
    jest.restoreAllMocks();

    // Create minimal valid buffers for testing
    samplePersonBuffer = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .jpeg()
      .toBuffer();

    sampleGarmentBuffer = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 100, g: 150, b: 200 } },
    })
      .jpeg()
      .toBuffer();
  });

  afterEach(() => {
    mockImageProvider.reset();
    setImageProvider(null);
    llmProvider.setGenAiClient(null);
    jest.restoreAllMocks();
  });

  describe('ImageGenerationProvider Interface', () => {
    it('throws error when generateTryOn is invoked directly on the abstract base class', async () => {
      const baseProvider = new ImageGenerationProvider();
      await expect(baseProvider.generateTryOn({})).rejects.toThrow(
        'generateTryOn() must be implemented by provider'
      );
    });
  });

  describe('MockImageProvider', () => {
    it('rejects invalid or missing personImageBuffer', async () => {
      await expect(
        mockImageProvider.generateTryOn({
          personImageBuffer: null,
          garmentImages: [{ buffer: sampleGarmentBuffer }],
        })
      ).rejects.toThrow('personImageBuffer must be a valid Buffer');
    });

    it('rejects empty garmentImages array', async () => {
      await expect(
        mockImageProvider.generateTryOn({
          personImageBuffer: samplePersonBuffer,
          garmentImages: [],
        })
      ).rejects.toThrow('garmentImages must contain at least 1 garment');
    });

    it('rejects garment without a valid buffer', async () => {
      await expect(
        mockImageProvider.generateTryOn({
          personImageBuffer: samplePersonBuffer,
          garmentImages: [{ buffer: 'not_a_buffer' }],
        })
      ).rejects.toThrow('Each garment in garmentImages must have a valid buffer Buffer');
    });

    it('generates authentic 1024x1024 JPEG image buffer by default', async () => {
      const result = await mockImageProvider.generateTryOn({
        personImageBuffer: samplePersonBuffer,
        garmentImages: [{ buffer: sampleGarmentBuffer, slot: 'top', label: 'Navy Silk Shirt' }],
        promptVersion: 'v1',
      });

      expect(result).toBeDefined();
      expect(result.provider).toBe('mock');
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.width).toBe(1024);
      expect(result.height).toBe(1024);
      expect(result.promptVersion).toBe('v1');
      expect(Buffer.isBuffer(result.imageBuffer)).toBe(true);

      // Verify buffer is valid image via sharp metadata
      const metadata = await sharp(result.imageBuffer).metadata();
      expect(metadata.format).toBe('jpeg');
      expect(metadata.width).toBe(1024);
      expect(metadata.height).toBe(1024);
    });

    it('generates 512x512 JPEG image buffer when 512x512 resolution is requested', async () => {
      const result = await mockImageProvider.generateTryOn({
        personImageBuffer: samplePersonBuffer,
        garmentImages: [{ buffer: sampleGarmentBuffer }],
        resolution: '512x512',
      });

      expect(result.width).toBe(512);
      expect(result.height).toBe(512);

      const metadata = await sharp(result.imageBuffer).metadata();
      expect(metadata.width).toBe(512);
      expect(metadata.height).toBe(512);
    });

    it('simulates error when configured via setSimulatedError', async () => {
      mockImageProvider.setSimulatedError(new Error('Simulated GPU out-of-memory'));

      await expect(
        mockImageProvider.generateTryOn({
          personImageBuffer: samplePersonBuffer,
          garmentImages: [{ buffer: sampleGarmentBuffer }],
        })
      ).rejects.toThrow('Simulated GPU out-of-memory');
    });
  });

  describe('GeminiImageProvider', () => {
    it('buildTryOnPrompt structures server-controlled instructions with garment details', () => {
      const prompt = buildTryOnPrompt({
        garments: [
          { slot: 'top', label: 'White Linen Shirt' },
          { slot: 'bottom', label: 'Beige Chinos' },
        ],
        promptVersion: 'v2',
      });

      expect(prompt).toContain('Task: High-fidelity Photorealistic Virtual Try-On Composite');
      expect(prompt).toContain('Version: v2');
      expect(prompt).toContain('Garment 1 (top): White Linen Shirt');
      expect(prompt).toContain('Garment 2 (bottom): Beige Chinos');
      expect(prompt).toContain('Maintain exact facial identity');
    });

    it('throws ApiError 400 when personImageBuffer or garmentImages is invalid', async () => {
      const provider = new GeminiImageProvider();

      await expect(
        provider.generateTryOn({
          personImageBuffer: null,
          garmentImages: [{ buffer: sampleGarmentBuffer }],
        })
      ).rejects.toThrow(ApiError);

      await expect(
        provider.generateTryOn({
          personImageBuffer: samplePersonBuffer,
          garmentImages: [],
        })
      ).rejects.toThrow(ApiError);
    });

    it('successfully processes multimodal response with inline image parts', async () => {
      const fakeBase64 = samplePersonBuffer.toString('base64');
      const fakeGenAi = {
        models: {
          generateContent: jest.fn().mockResolvedValue({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        data: fakeBase64,
                        mimeType: 'image/jpeg',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
      };

      llmProvider.setGenAiClient(fakeGenAi);

      const provider = new GeminiImageProvider();
      const result = await provider.generateTryOn({
        personImageBuffer: samplePersonBuffer,
        garmentImages: [{ buffer: sampleGarmentBuffer, slot: 'top' }],
        promptVersion: 'v1',
      });

      expect(result.provider).toBe('gemini');
      expect(result.imageBuffer.toString('base64')).toBe(fakeBase64);
      expect(fakeGenAi.models.generateContent).toHaveBeenCalledTimes(1);
    });
  });

  describe('Image Provider Factory', () => {
    it('resolves MockImageProvider when providerName is "mock" in non-production', () => {
      const provider = getImageProvider('mock');
      expect(provider).toBeInstanceOf(MockImageProvider);
    });

    it('resolves GeminiImageProvider when providerName is "gemini"', () => {
      const provider = getImageProvider('gemini');
      expect(provider).toBeInstanceOf(GeminiImageProvider);
    });

    it('throws security error when "mock" is requested in production', () => {
      const originalEnv = env.NODE_ENV;
      try {
        env.NODE_ENV = 'production';
        expect(() => getImageProvider('mock')).toThrow(
          'Security violation: Refusing to use mock image provider in production environment'
        );
      } finally {
        env.NODE_ENV = originalEnv;
      }
    });

    it('throws error for unknown provider name', () => {
      expect(() => getImageProvider('unsupported_vendor')).toThrow(
        "Unknown image provider: unsupported_vendor. Supported providers are 'gemini', 'mock', and 'openrouter'."
      );
    });

    it('honors provider override set via setImageProvider', () => {
      const customMock = { generateTryOn: jest.fn() };
      setImageProvider(customMock);

      const resolved = getImageProvider('gemini');
      expect(resolved).toBe(customMock);
    });
  });
});
