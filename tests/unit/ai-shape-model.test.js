/**
 * Phase 15F Step 4 — Shape Model Subsystem Tests.
 *
 * Covers:
 * 1. Zod Validation: createShapeModelSchema (namespace, regex, consent, strictness).
 * 2. DTO Mapper: toShapeModelDto (signed URL generation, raw URL concealment).
 * 3. Service Lifecycle:
 *    - User scoping validation (rejects mismatched userId in imageRef).
 *    - Single active model invariant (marks old as replaced, deletes old Cloudinary asset).
 *    - Active model retrieval.
 *    - Soft-delete with Cloudinary asset cleanup.
 *    - IDOR ownership guard in getShapeModelById.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import mongoose from 'mongoose';
import '../../src/common/globals.js';
import { createShapeModelSchema } from '../../src/modules/ai/shape-model/shape-model.validator.js';
import { toShapeModelDto } from '../../src/modules/ai/shape-model/shape-model.dto.js';
import * as shapeModelService from '../../src/modules/ai/shape-model/shape-model.service.js';
import shapeModelRepository from '../../src/modules/ai/shape-model/shape-model.repository.js';
import uploadService from '../../src/modules/uploads/upload.service.js';

describe('Phase 15F Step 4 — Shape Model Subsystem', () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const otherUserId = new mongoose.Types.ObjectId().toString();
  const validImageRef = `murafiq/shape-models/${userId}/photo-uuid-12345`;

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Validation — createShapeModelSchema', () => {
    it('accepts valid shape model payload', () => {
      const validPayload = {
        imageRef: validImageRef,
        consent: true,
        format: 'jpg',
        bytes: 1048576,
        width: 1080,
        height: 1920,
      };

      const result = createShapeModelSchema.body.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it('rejects imageRef outside shape-models folder', () => {
      const payload = {
        imageRef: `murafiq/wardrobe/${userId}/photo-123`,
        consent: true,
      };

      const result = createShapeModelSchema.body.safeParse(payload);
      expect(result.success).toBe(false);
      expect(result.error.issues[0].message).toContain('valid shape-models path');
    });

    it('rejects payload when consent is false or omitted', () => {
      const payload = {
        imageRef: validImageRef,
        consent: false,
      };

      const result = createShapeModelSchema.body.safeParse(payload);
      expect(result.success).toBe(false);
      expect(result.error.issues[0].message).toContain('Explicit consent is required');
    });

    it('rejects unknown fields (.strict() check)', () => {
      const payload = {
        imageRef: validImageRef,
        consent: true,
        extraField: 'not_allowed',
      };

      const result = createShapeModelSchema.body.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('DTO — toShapeModelDto', () => {
    it('returns null when input document is null', () => {
      expect(toShapeModelDto(null)).toBeNull();
    });

    it('maps document fields correctly, creates signed URL, and conceals raw URL', () => {
      jest.spyOn(uploadService, 'getSignedUrl').mockReturnValue('https://res.cloudinary.com/signed-test-url');

      const mockDoc = {
        _id: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(),
        publicId: validImageRef,
        imageUrl: `authenticated://${validImageRef}`,
        format: 'jpeg',
        bytes: 500000,
        width: 800,
        height: 1200,
        status: 'active',
        consentAt: new Date('2026-09-14T00:00:00Z'),
        createdAt: new Date('2026-09-14T00:00:00Z'),
      };

      const dto = toShapeModelDto(mockDoc);

      expect(dto.id).toBe(mockDoc._id.toString());
      expect(dto.status).toBe('active');
      expect(dto.format).toBe('jpeg');
      expect(dto.width).toBe(800);
      expect(dto.height).toBe(1200);
      expect(dto.signedUrl).toBe('https://res.cloudinary.com/signed-test-url');
      expect(uploadService.getSignedUrl).toHaveBeenCalledWith(validImageRef, 3600);

      // Verify raw storage and internal fields are concealed
      expect(dto.imageUrl).toBeUndefined();
      expect(dto.userId).toBeUndefined();
    });
  });

  describe('Service — createOrReplace', () => {
    it('rejects imageRef belonging to a different userId with 400 Bad Request', async () => {
      const forgedImageRef = `murafiq/shape-models/${otherUserId}/photo-999`;

      await expect(
        shapeModelService.createOrReplace(userId, {
          imageRef: forgedImageRef,
          consent: true,
        })
      ).rejects.toThrow(ApiError);
    });

    it('rejects when consent is falsy', async () => {
      await expect(
        shapeModelService.createOrReplace(userId, {
          imageRef: validImageRef,
          consent: false,
        })
      ).rejects.toThrow(ApiError);
    });

    it('creates new active shape model when no active model exists', async () => {
      jest.spyOn(shapeModelRepository, 'findActiveByUserId').mockResolvedValue(null);
      const createdDoc = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        publicId: validImageRef,
        status: 'active',
        format: 'jpg',
        width: 1080,
        height: 1920,
        consentAt: new Date(),
        createdAt: new Date(),
      };
      jest.spyOn(shapeModelRepository, 'create').mockResolvedValue(createdDoc);
      jest.spyOn(uploadService, 'getSignedUrl').mockReturnValue('https://signed.url');

      const result = await shapeModelService.createOrReplace(userId, {
        imageRef: validImageRef,
        consent: true,
        width: 1080,
        height: 1920,
      });

      expect(shapeModelRepository.findActiveByUserId).toHaveBeenCalledWith(userId);
      expect(shapeModelRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          publicId: validImageRef,
          status: 'active',
        })
      );
      expect(result.signedUrl).toBe('https://signed.url');
    });

    it('marks existing active model as replaced and deletes old Cloudinary asset', async () => {
      const oldModelId = new mongoose.Types.ObjectId();
      const oldPublicId = `murafiq/shape-models/${userId}/old-photo`;
      const existingModel = {
        _id: oldModelId,
        publicId: oldPublicId,
        status: 'active',
      };

      jest.spyOn(shapeModelRepository, 'findActiveByUserId').mockResolvedValue(existingModel);
      const markReplacedSpy = jest.spyOn(shapeModelRepository, 'markReplaced').mockResolvedValue({});
      const deleteFileSpy = jest.spyOn(uploadService, 'deleteFile').mockResolvedValue({ result: 'ok' });

      const newDoc = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        publicId: validImageRef,
        status: 'active',
        consentAt: new Date(),
        createdAt: new Date(),
      };
      jest.spyOn(shapeModelRepository, 'create').mockResolvedValue(newDoc);
      jest.spyOn(uploadService, 'getSignedUrl').mockReturnValue('https://signed.url');

      await shapeModelService.createOrReplace(userId, {
        imageRef: validImageRef,
        consent: true,
      });

      expect(markReplacedSpy).toHaveBeenCalledWith(oldModelId, expect.any(Date));
      expect(deleteFileSpy).toHaveBeenCalledWith(oldPublicId, { type: 'authenticated' });
      expect(shapeModelRepository.create).toHaveBeenCalled();
    });
  });

  describe('Service — getActive', () => {
    it('returns null when user has no active shape model', async () => {
      jest.spyOn(shapeModelRepository, 'findActiveByUserId').mockResolvedValue(null);

      const result = await shapeModelService.getActive(userId);
      expect(result).toBeNull();
    });

    it('returns DTO when active model exists', async () => {
      const activeModel = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        publicId: validImageRef,
        status: 'active',
        consentAt: new Date(),
        createdAt: new Date(),
      };
      jest.spyOn(shapeModelRepository, 'findActiveByUserId').mockResolvedValue(activeModel);
      jest.spyOn(uploadService, 'getSignedUrl').mockReturnValue('https://signed.url');

      const result = await shapeModelService.getActive(userId);
      expect(result).toBeDefined();
      expect(result.id).toBe(activeModel._id.toString());
      expect(result.signedUrl).toBe('https://signed.url');
    });
  });

  describe('Service — deleteActive', () => {
    it('throws ApiError 404 when no active shape model exists to delete', async () => {
      jest.spyOn(shapeModelRepository, 'findActiveByUserId').mockResolvedValue(null);

      await expect(shapeModelService.deleteActive(userId)).rejects.toThrow(ApiError);
    });

    it('soft deletes active model and destroys Cloudinary asset', async () => {
      const activeModel = {
        _id: new mongoose.Types.ObjectId(),
        publicId: validImageRef,
        status: 'active',
      };
      jest.spyOn(shapeModelRepository, 'findActiveByUserId').mockResolvedValue(activeModel);
      const softDeleteSpy = jest.spyOn(shapeModelRepository, 'softDelete').mockResolvedValue({});
      const deleteFileSpy = jest.spyOn(uploadService, 'deleteFile').mockResolvedValue({ result: 'ok' });

      const res = await shapeModelService.deleteActive(userId);

      expect(res.success).toBe(true);
      expect(softDeleteSpy).toHaveBeenCalledWith(activeModel._id, expect.any(Date));
      expect(deleteFileSpy).toHaveBeenCalledWith(validImageRef, { type: 'authenticated' });
    });
  });

  describe('Service — getShapeModelById (Ownership & IDOR Protection)', () => {
    it('throws ApiError 404 if shape model is not found', async () => {
      jest.spyOn(shapeModelRepository, 'findById').mockResolvedValue(null);

      await expect(
        shapeModelService.getShapeModelById(userId, new mongoose.Types.ObjectId())
      ).rejects.toThrow(ApiError);
    });

    it('throws ApiError 403 when user does not own the shape model (IDOR guard)', async () => {
      const model = {
        _id: new mongoose.Types.ObjectId(),
        userId: otherUserId, // belongs to another user
        status: 'active',
      };
      jest.spyOn(shapeModelRepository, 'findById').mockResolvedValue(model);

      await expect(
        shapeModelService.getShapeModelById(userId, model._id)
      ).rejects.toThrow(ApiError);
    });

    it('throws ApiError 400 when shape model is not active (e.g. replaced or deleted)', async () => {
      const model = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        status: 'replaced',
      };
      jest.spyOn(shapeModelRepository, 'findById').mockResolvedValue(model);

      await expect(
        shapeModelService.getShapeModelById(userId, model._id)
      ).rejects.toThrow(ApiError);
    });

    it('returns the model when active and owned by caller', async () => {
      const model = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        status: 'active',
      };
      jest.spyOn(shapeModelRepository, 'findById').mockResolvedValue(model);

      const result = await shapeModelService.getShapeModelById(userId, model._id);
      expect(result).toBe(model);
    });
  });
});
