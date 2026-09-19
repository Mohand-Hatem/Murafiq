/**
 * Phase 15C Step 3 — Upload Service, Validator & Controller Tests.
 *
 * Covers:
 * 1. Upload service: ai-chat folder permissions & 768px compression.
 * 2. Validator: optional imageRef accepted and strict schema preserved.
 * 3. Controller: imageRef namespace & ownership enforcement.
 */

import { describe, it, expect, jest } from '@jest/globals';
import sharp from 'sharp';
import '../../src/common/globals.js';
import uploadService, {
  FOLDER_ROLES,
  compressImage,
} from '../../src/modules/uploads/upload.service.js';
import { stylistRequestSchema } from '../../src/modules/ai/ai.validator.js';
import { handleStylistRequest } from '../../src/modules/ai/ai.controller.js';
import orchestrator from '../../src/modules/ai/stylist/stylist.orchestrator.js';

describe('Phase 15C Step 3 — Upload Service (ai-chat)', () => {
  it('FOLDER_ROLES includes ai-chat for client and admin only', () => {
    expect(FOLDER_ROLES['ai-chat']).toEqual(['client', 'admin']);
  });

  it('rejects upload to ai-chat by unauthorized role (e.g., stylist)', async () => {
    await expect(
      uploadService.uploadFile(
        { id: 'user123', role: 'stylist' },
        'ai-chat',
        { buffer: Buffer.from('fake-image'), mimetype: 'image/jpeg' }
      )
    ).rejects.toThrow(/not authorized to upload to folder 'ai-chat'/i);
  });

  it('compresses ai-chat images to max 768x768', async () => {
    const inputBuffer = await sharp({
      create: {
        width: 1600,
        height: 1200,
        channels: 3,
        background: { r: 200, g: 100, b: 50 },
      },
    })
      .jpeg()
      .toBuffer();

    const compressedBuffer = await compressImage(inputBuffer, 'image/jpeg', 'ai-chat');
    const metadata = await sharp(compressedBuffer).metadata();

    expect(metadata.width).toBeLessThanOrEqual(768);
    expect(metadata.height).toBeLessThanOrEqual(768);
    expect(metadata.width).toBe(768);
    expect(metadata.height).toBe(576); // 4:3 aspect ratio maintained
  });

  it('preserves 1920x1920 max for non-chat folders (e.g. wardrobe)', async () => {
    const inputBuffer = await sharp({
      create: {
        width: 2400,
        height: 1600,
        channels: 3,
        background: { r: 100, g: 150, b: 200 },
      },
    })
      .jpeg()
      .toBuffer();

    const compressedBuffer = await compressImage(inputBuffer, 'image/jpeg', 'wardrobe');
    const metadata = await sharp(compressedBuffer).metadata();

    expect(metadata.width).toBe(1920);
    expect(metadata.height).toBe(1280);
  });
});

describe('Phase 15C Step 3 — AI Validator (imageRef)', () => {
  it('accepts valid message without imageRef', () => {
    const result = stylistRequestSchema.body.safeParse({
      message: 'What pants go with this shirt?',
    });
    expect(result.success).toBe(true);
    expect(result.data.imageRef).toBeUndefined();
  });

  it('accepts valid message with optional imageRef', () => {
    const result = stylistRequestSchema.body.safeParse({
      message: 'What pants go with this shirt?',
      imageRef: 'murafiq/ai-chat/u123/img-abc',
    });
    expect(result.success).toBe(true);
    expect(result.data.imageRef).toBe('murafiq/ai-chat/u123/img-abc');
  });

  it('rejects unknown fields (.strict)', () => {
    const result = stylistRequestSchema.body.safeParse({
      message: 'Valid message',
      unknownField: 'malicious',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-string imageRef', () => {
    const result = stylistRequestSchema.body.safeParse({
      message: 'Valid message',
      imageRef: 12345,
    });
    expect(result.success).toBe(false);
  });
});

describe('Phase 15C Step 3 — AI Controller (Ownership & Forwarding)', () => {
  const mockUserId = 'user_abc_123';

  it('forwards imageRef to orchestrator when ownership is valid', async () => {
    const spy = jest.spyOn(orchestrator, 'runStylistPipeline').mockResolvedValueOnce({
      outfits: [],
      sufficiency: 'good',
      refused: false,
    });

    const req = {
      user: { id: mockUserId, role: 'client' },
      body: {
        message: 'What shoes match this?',
        imageRef: `murafiq/ai-chat/${mockUserId}/uuid-456`,
      },
    };

    let responseData = null;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockImplementation((d) => {
        responseData = d;
        return res;
      }),
    };

    await handleStylistRequest(req, res, () => {});

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: mockUserId,
        message: 'What shoes match this?',
        imageRef: `murafiq/ai-chat/${mockUserId}/uuid-456`,
      })
    );
    expect(responseData.success).toBe(true);
    spy.mockRestore();
  });

  it('rejects imageRef belonging to another user with 400', async () => {
    const req = {
      user: { id: mockUserId, role: 'client' },
      body: {
        message: 'What shoes match this?',
        imageRef: 'murafiq/ai-chat/different_user/uuid-456',
      },
    };

    let caughtError = null;
    const next = (err) => {
      caughtError = err;
    };
    const res = {};

    await handleStylistRequest(req, res, next);

    expect(caughtError).toBeDefined();
    expect(caughtError.statusCode).toBe(400);
    expect(caughtError.message).toMatch(/imageRef does not belong to the authenticated user/i);
  });

  it('rejects imageRef from wrong folder (e.g. wardrobe) with 400', async () => {
    const req = {
      user: { id: mockUserId, role: 'client' },
      body: {
        message: 'What shoes match this?',
        imageRef: `murafiq/wardrobe/${mockUserId}/uuid-456`,
      },
    };

    let caughtError = null;
    const next = (err) => {
      caughtError = err;
    };
    const res = {};

    await handleStylistRequest(req, res, next);

    expect(caughtError).toBeDefined();
    expect(caughtError.statusCode).toBe(400);
    expect(caughtError.message).toMatch(/imageRef does not belong to the authenticated user/i);
  });

  it('rejects malformed imageRef with 400', async () => {
    const req = {
      user: { id: mockUserId, role: 'client' },
      body: {
        message: 'What shoes match this?',
        imageRef: 'random-string-not-namespaced',
      },
    };

    let caughtError = null;
    const next = (err) => {
      caughtError = err;
    };
    const res = {};

    await handleStylistRequest(req, res, next);

    expect(caughtError).toBeDefined();
    expect(caughtError.statusCode).toBe(400);
    expect(caughtError.message).toMatch(/imageRef does not belong to the authenticated user/i);
  });
});
