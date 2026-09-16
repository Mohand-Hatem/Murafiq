/**
 * Phase 15F Step 5 — Try-On Subsystem Core & Garment Resolver Tests.
 *
 * Covers:
 * 1. computeJobId deterministic SHA-256 hashing and sorting invariance.
 * 2. Garment Resolver:
 *    - Bounds enforcement (1-4 garments).
 *    - Wardrobe ownership checking via wardrobeService.
 *    - Upload namespace isolation (murafiq/ai-chat/${userId}/).
 *    - Slot conflict detection (dress + top, duplicate bottoms).
 * 3. createTryOnRequest:
 *    - Shape model ownership validation.
 *    - Deterministic deduplication: pending/processing returns 202 without re-billing.
 *    - Deterministic deduplication: 24h completed result returns 200 without re-billing.
 *    - Pre-flight quota consumption and quotaSource attribution.
 *    - BullMQ job enqueue invocation.
 * 4. getGenerationById IDOR protection.
 * 5. deleteGeneration Cloudinary cleanup and ownership check.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import mongoose from 'mongoose';
import '../../src/common/globals.js';
import {
  computeJobId,
  createTryOnRequest,
  getGenerationById,
  deleteGeneration,
  setQueueHelper,
} from '../../src/modules/ai/try-on/try-on.service.js';
import garmentResolver from '../../src/modules/ai/try-on/garment-resolver.js';
import tryOnRepository from '../../src/modules/ai/try-on/try-on-generation.repository.js';
import shapeModelService from '../../src/modules/ai/shape-model/shape-model.service.js';
import wardrobeService from '../../src/modules/wardrobe/wardrobe.service.js';
import entitlementService from '../../src/modules/subscriptions/entitlement.service.js';
import uploadService from '../../src/modules/uploads/upload.service.js';
import outfitService from '../../src/modules/ai/outfits/outfit.service.js';
import { createTryOnSchema } from '../../src/modules/ai/try-on/try-on.validator.js';

describe('Phase 15F Step 5 — Try-On Subsystem Core', () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const otherUserId = new mongoose.Types.ObjectId().toString();
  const shapeModelId = new mongoose.Types.ObjectId().toString();
  const wardrobeItemId1 = new mongoose.Types.ObjectId().toString();
  const wardrobeItemId2 = new mongoose.Types.ObjectId().toString();

  beforeEach(() => {
    jest.restoreAllMocks();
    setQueueHelper(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setQueueHelper(null);
  });

  describe('computeJobId Determinism', () => {
    it('produces identical SHA-256 hash regardless of garment array order', () => {
      const garmentsA = [
        { slot: 'top', itemId: wardrobeItemId1 },
        { slot: 'bottom', itemId: wardrobeItemId2 },
      ];
      const garmentsB = [
        { slot: 'bottom', itemId: wardrobeItemId2 },
        { slot: 'top', itemId: wardrobeItemId1 },
      ];

      const hashA = computeJobId(userId, shapeModelId, garmentsA, 'v1');
      const hashB = computeJobId(userId, shapeModelId, garmentsB, 'v1');

      expect(hashA).toBe(hashB);
      expect(hashA).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces different hashes when promptVersion or shapeModelId differs', () => {
      const garments = [{ slot: 'top', itemId: wardrobeItemId1 }];
      const hash1 = computeJobId(userId, shapeModelId, garments, 'v1');
      const hash2 = computeJobId(userId, shapeModelId, garments, 'v2');
      const hash3 = computeJobId(userId, new mongoose.Types.ObjectId().toString(), garments, 'v1');

      expect(hash1).not.toBe(hash2);
      expect(hash1).not.toBe(hash3);
    });
  });

  describe('Garment Resolver', () => {
    it('rejects empty garments array or more than 4 garments', async () => {
      await expect(garmentResolver.resolveGarments(userId, [])).rejects.toThrow(ApiError);
      await expect(
        garmentResolver.resolveGarments(userId, [
          { source: 'wardrobe', itemId: '1' },
          { source: 'wardrobe', itemId: '2' },
          { source: 'wardrobe', itemId: '3' },
          { source: 'wardrobe', itemId: '4' },
          { source: 'wardrobe', itemId: '5' },
        ])
      ).rejects.toThrow(ApiError);
    });

    it('rejects wardrobe item when unowned or not found (delegates to wardrobeService)', async () => {
      jest
        .spyOn(wardrobeService, 'getWardrobeItemById')
        .mockRejectedValue(new ApiError(404, 'Wardrobe item not found'));

      await expect(
        garmentResolver.resolveGarments(userId, [
          { source: 'wardrobe', itemId: wardrobeItemId1, slot: 'top' },
        ])
      ).rejects.toThrow('Wardrobe item not found');
    });

    it('rejects upload imageRef not scoped to authenticated user', async () => {
      const forgedImageRef = `murafiq/ai-chat/${otherUserId}/uploaded-item`;

      await expect(
        garmentResolver.resolveGarments(userId, [
          { source: 'upload', imageRef: forgedImageRef, slot: 'top' },
        ])
      ).rejects.toThrow(ApiError);
    });

    it('detects slot conflict when dress is combined with top or bottom', async () => {
      jest.spyOn(wardrobeService, 'getWardrobeItemById').mockResolvedValue({
        _id: wardrobeItemId1,
        category: 'dress',
        sourceUploadRef: 'ref-dress',
      });

      await expect(
        garmentResolver.resolveGarments(userId, [
          { source: 'wardrobe', itemId: wardrobeItemId1, slot: 'dress' },
          { source: 'upload', imageRef: `murafiq/ai-chat/${userId}/top-1`, slot: 'top' },
        ])
      ).rejects.toThrow('Conflicting outfit slots');
    });

    it('detects duplicate non-repeatable slots (e.g. two bottoms)', async () => {
      jest.spyOn(wardrobeService, 'getWardrobeItemById').mockResolvedValue({
        _id: wardrobeItemId1,
        category: 'bottom',
        sourceUploadRef: 'ref-pants',
      });

      await expect(
        garmentResolver.resolveGarments(userId, [
          { source: 'wardrobe', itemId: wardrobeItemId1, slot: 'bottom' },
          { source: 'upload', imageRef: `murafiq/ai-chat/${userId}/pants-2`, slot: 'bottom' },
        ])
      ).rejects.toThrow('Multiple garments specified for slot');
    });

    it('resolves valid wardrobe item and uploaded item combination', async () => {
      jest.spyOn(wardrobeService, 'getWardrobeItemById').mockResolvedValue({
        _id: wardrobeItemId1,
        category: 'top',
        title: 'Silk Blouse',
        sourceUploadRef: 'ref-blouse',
      });

      const result = await garmentResolver.resolveGarments(userId, [
        { source: 'wardrobe', itemId: wardrobeItemId1, slot: 'top' },
        { source: 'upload', imageRef: `murafiq/ai-chat/${userId}/skirt-1`, slot: 'bottom', label: 'Pleated Skirt' },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          source: 'wardrobe',
          slot: 'top',
          resolvedPublicId: 'ref-blouse',
        })
      );
      expect(result[1]).toEqual(
        expect.objectContaining({
          source: 'upload',
          slot: 'bottom',
          resolvedPublicId: `murafiq/ai-chat/${userId}/skirt-1`,
        })
      );
    });
  });

  describe('createTryOnRequest Lifecycle & Deduplication', () => {
    const activeShapeModel = {
      _id: new mongoose.Types.ObjectId(shapeModelId),
      userId,
      status: 'active',
    };

    const resolvedGarments = [
      {
        source: 'wardrobe',
        itemId: new mongoose.Types.ObjectId(wardrobeItemId1),
        slot: 'top',
        label: 'Blue Oxford',
        resolvedPublicId: 'murafiq/wardrobe/user/oxford',
      },
    ];

    beforeEach(() => {
      jest.spyOn(shapeModelService, 'getShapeModelById').mockResolvedValue(activeShapeModel);
      jest.spyOn(wardrobeService, 'getWardrobeItemById').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(wardrobeItemId1),
        category: 'top',
        title: 'Blue Oxford',
        sourceUploadRef: 'murafiq/wardrobe/user/oxford',
      });
    });

    it('returns existing generation with 202 when job is already pending or processing (Decision Q2)', async () => {
      const existingActiveJob = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        shapeModelId,
        status: 'processing',
        garments: resolvedGarments,
        resolution: '1024x1024',
        promptVersion: 'v1',
      };

      jest.spyOn(tryOnRepository, 'findActiveByJobId').mockResolvedValue(existingActiveJob);
      const consumeQuotaSpy = jest.spyOn(entitlementService, 'consumeTryOnQuota');

      const res = await createTryOnRequest(userId, {
        shapeModelId,
        garments: [{ source: 'wardrobe', itemId: wardrobeItemId1 }],
      });

      expect(res.isDuplicate).toBe(true);
      expect(res.statusCode).toBe(202);
      expect(res.generation.status).toBe('processing');
      // Must NOT double-bill quota on duplicate
      expect(consumeQuotaSpy).not.toHaveBeenCalled();
    });

    it('returns existing generation with 200 when completed result exists within 24 hours (Decision Q2)', async () => {
      const recentCompletedJob = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        shapeModelId,
        status: 'completed',
        resultPublicId: 'murafiq/try-on-results/user/result1',
        completedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        garments: resolvedGarments,
        resolution: '1024x1024',
        promptVersion: 'v1',
      };

      jest.spyOn(tryOnRepository, 'findActiveByJobId').mockResolvedValue(null);
      jest.spyOn(tryOnRepository, 'findRecentCompletedByJobId').mockResolvedValue(recentCompletedJob);
      jest.spyOn(uploadService, 'getSignedUrl').mockReturnValue('https://signed.cloudinary/res1');
      const consumeQuotaSpy = jest.spyOn(entitlementService, 'consumeTryOnQuota');

      const res = await createTryOnRequest(userId, {
        shapeModelId,
        garments: [{ source: 'wardrobe', itemId: wardrobeItemId1 }],
      });

      expect(res.isDuplicate).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(res.generation.status).toBe('completed');
      expect(res.generation.result.signedUrl).toBe('https://signed.cloudinary/res1');
      expect(consumeQuotaSpy).not.toHaveBeenCalled();
    });

    it('consumes quota, creates record, and enqueues job when request is new', async () => {
      jest.spyOn(tryOnRepository, 'findActiveByJobId').mockResolvedValue(null);
      jest.spyOn(tryOnRepository, 'findRecentCompletedByJobId').mockResolvedValue(null);
      const consumeQuotaSpy = jest
        .spyOn(entitlementService, 'consumeTryOnQuota')
        .mockResolvedValue({ success: true, quotaSource: 'monthly' });

      const newGenDoc = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        shapeModelId,
        status: 'pending',
        garments: resolvedGarments,
        resolution: '1024x1024',
        promptVersion: 'v1',
        quotaSource: 'monthly',
      };
      jest.spyOn(tryOnRepository, 'create').mockResolvedValue(newGenDoc);

      const mockQueue = { addTryOnJob: jest.fn().mockResolvedValue({ id: 'job-123' }) };
      setQueueHelper(mockQueue);

      const res = await createTryOnRequest(userId, {
        shapeModelId,
        garments: [{ source: 'wardrobe', itemId: wardrobeItemId1 }],
      });

      expect(res.isDuplicate).toBe(false);
      expect(res.statusCode).toBe(202);
      expect(res.generation.status).toBe('pending');
      expect(consumeQuotaSpy).toHaveBeenCalledWith(userId, 'client');
      expect(tryOnRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          status: 'pending',
          quotaSource: 'monthly',
        })
      );
      expect(mockQueue.addTryOnJob).toHaveBeenCalledWith(
        expect.objectContaining({
          generationId: newGenDoc._id,
        })
      );
    });

    it('resolves garments and links outfitId when outfitId is provided', async () => {
      const mockOutfitId = new mongoose.Types.ObjectId().toString();
      const mockOutfit = {
        _id: new mongoose.Types.ObjectId(mockOutfitId),
        userId,
        items: [
          new mongoose.Types.ObjectId(wardrobeItemId1),
          new mongoose.Types.ObjectId(wardrobeItemId2),
        ],
      };

      jest.spyOn(outfitService, 'getOutfitById').mockResolvedValue(mockOutfit);
      jest.spyOn(wardrobeService, 'getWardrobeItemsByIds').mockResolvedValue([
        {
          _id: new mongoose.Types.ObjectId(wardrobeItemId1),
          category: 'top',
          title: 'Blue Oxford',
          sourceUploadRef: 'murafiq/wardrobe/user/oxford',
        },
        {
          _id: new mongoose.Types.ObjectId(wardrobeItemId2),
          category: 'bottom',
          title: 'Navy Chinos',
          sourceUploadRef: 'murafiq/wardrobe/user/chinos',
        },
      ]);
      jest.spyOn(tryOnRepository, 'findActiveByJobId').mockResolvedValue(null);
      jest.spyOn(tryOnRepository, 'findRecentCompletedByJobId').mockResolvedValue(null);
      jest.spyOn(entitlementService, 'consumeTryOnQuota').mockResolvedValue({ success: true, quotaSource: 'monthly' });

      const newGenDoc = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        shapeModelId,
        outfitId: mockOutfit._id,
        status: 'pending',
        garments: resolvedGarments,
        resolution: '1024x1024',
        promptVersion: 'v1',
      };
      jest.spyOn(tryOnRepository, 'create').mockResolvedValue(newGenDoc);

      const res = await createTryOnRequest(userId, {
        shapeModelId,
        outfitId: mockOutfitId,
      });

      expect(res.isDuplicate).toBe(false);
      expect(res.statusCode).toBe(202);
      expect(outfitService.getOutfitById).toHaveBeenCalledWith(mockOutfitId, userId);
      expect(wardrobeService.getWardrobeItemsByIds).toHaveBeenCalledWith(userId, [wardrobeItemId1, wardrobeItemId2]);
      expect(tryOnRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          outfitId: mockOutfit._id,
        })
      );
    });

    it('throws ApiError 404 when outfitId does not exist or user does not own it', async () => {
      const mockOutfitId = new mongoose.Types.ObjectId().toString();
      jest.spyOn(outfitService, 'getOutfitById').mockResolvedValue(null);

      await expect(
        createTryOnRequest(userId, {
          shapeModelId,
          outfitId: mockOutfitId,
        })
      ).rejects.toThrow(/Outfit not found or access denied/i);
    });

    it('throws ApiError 400 when outfit contains no wardrobe items', async () => {
      const mockOutfitId = new mongoose.Types.ObjectId().toString();
      jest.spyOn(outfitService, 'getOutfitById').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(mockOutfitId),
        userId,
        items: [],
      });

      await expect(
        createTryOnRequest(userId, {
          shapeModelId,
          outfitId: mockOutfitId,
        })
      ).rejects.toThrow(/Selected outfit contains no wardrobe items to try on/i);
    });

    it('resolves single wardrobe item when itemId is provided', async () => {
      jest.spyOn(tryOnRepository, 'findActiveByJobId').mockResolvedValue(null);
      jest.spyOn(tryOnRepository, 'findRecentCompletedByJobId').mockResolvedValue(null);
      jest.spyOn(entitlementService, 'consumeTryOnQuota').mockResolvedValue({ success: true, quotaSource: 'monthly' });

      const newGenDoc = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        shapeModelId,
        status: 'pending',
        garments: [resolvedGarments[0]],
        resolution: '1024x1024',
        promptVersion: 'v1',
      };
      jest.spyOn(tryOnRepository, 'create').mockResolvedValue(newGenDoc);

      const res = await createTryOnRequest(userId, {
        shapeModelId,
        itemId: wardrobeItemId1,
      });

      expect(res.isDuplicate).toBe(false);
      expect(res.statusCode).toBe(202);
      expect(wardrobeService.getWardrobeItemById).toHaveBeenCalledWith(userId, wardrobeItemId1);
    });
  });

  describe('createTryOnSchema Validation', () => {
    it('accepts request with outfitId without garments', () => {
      const valid = createTryOnSchema.body.safeParse({
        shapeModelId: new mongoose.Types.ObjectId().toString(),
        outfitId: new mongoose.Types.ObjectId().toString(),
      });
      expect(valid.success).toBe(true);
    });

    it('accepts request with itemId without garments', () => {
      const valid = createTryOnSchema.body.safeParse({
        shapeModelId: new mongoose.Types.ObjectId().toString(),
        itemId: new mongoose.Types.ObjectId().toString(),
      });
      expect(valid.success).toBe(true);
    });

    it('accepts request with garments array without outfitId or itemId', () => {
      const valid = createTryOnSchema.body.safeParse({
        shapeModelId: new mongoose.Types.ObjectId().toString(),
        garments: [{ source: 'wardrobe', itemId: new mongoose.Types.ObjectId().toString() }],
      });
      expect(valid.success).toBe(true);
    });

    it('rejects request when none of outfitId, itemId, or garments is provided', () => {
      const invalid = createTryOnSchema.body.safeParse({
        shapeModelId: new mongoose.Types.ObjectId().toString(),
      });
      expect(invalid.success).toBe(false);
      expect(invalid.error.issues[0].message).toMatch(/Must provide at least one of outfitId, itemId, or garments/i);
    });

    it('rejects invalid ObjectId for outfitId', () => {
      const invalid = createTryOnSchema.body.safeParse({
        shapeModelId: new mongoose.Types.ObjectId().toString(),
        outfitId: 'not-an-objectid',
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe('getGenerationById (IDOR Guard)', () => {
    it('throws ApiError 404 if generation does not exist', async () => {
      jest.spyOn(tryOnRepository, 'findById').mockResolvedValue(null);

      await expect(
        getGenerationById(userId, new mongoose.Types.ObjectId().toString())
      ).rejects.toThrow(ApiError);
    });

    it('throws ApiError 403 if generation belongs to another user', async () => {
      const doc = {
        _id: new mongoose.Types.ObjectId(),
        userId: otherUserId, // different user
        status: 'completed',
      };
      jest.spyOn(tryOnRepository, 'findById').mockResolvedValue(doc);

      await expect(getGenerationById(userId, doc._id.toString())).rejects.toThrow(ApiError);
    });

    it('returns mapped DTO with signed URL when caller owns generation', async () => {
      const doc = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        shapeModelId,
        status: 'completed',
        resultPublicId: 'murafiq/try-on-results/user/test-res',
        completedAt: new Date(),
        garments: [],
      };
      jest.spyOn(tryOnRepository, 'findById').mockResolvedValue(doc);
      jest.spyOn(uploadService, 'getSignedUrl').mockReturnValue('https://signed.url/res');

      const dto = await getGenerationById(userId, doc._id.toString());
      expect(dto.id).toBe(doc._id.toString());
      expect(dto.result.signedUrl).toBe('https://signed.url/res');
    });
  });

  describe('deleteGeneration', () => {
    it('throws ApiError 404 when generation not found', async () => {
      jest.spyOn(tryOnRepository, 'findById').mockResolvedValue(null);

      await expect(
        deleteGeneration(userId, new mongoose.Types.ObjectId().toString())
      ).rejects.toThrow(ApiError);
    });

    it('throws ApiError 403 when user does not own generation', async () => {
      const doc = {
        _id: new mongoose.Types.ObjectId(),
        userId: otherUserId,
      };
      jest.spyOn(tryOnRepository, 'findById').mockResolvedValue(doc);

      await expect(deleteGeneration(userId, doc._id.toString())).rejects.toThrow(ApiError);
    });

    it('cleans up Cloudinary output asset and marks status', async () => {
      const doc = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        resultPublicId: 'murafiq/try-on-results/user/output123',
      };
      jest.spyOn(tryOnRepository, 'findById').mockResolvedValue(doc);
      const deleteSpy = jest.spyOn(uploadService, 'deleteFile').mockResolvedValue({ result: 'ok' });
      const updateSpy = jest.spyOn(tryOnRepository, 'updateById').mockResolvedValue({});

      const res = await deleteGeneration(userId, doc._id.toString());

      expect(res.success).toBe(true);
      expect(deleteSpy).toHaveBeenCalledWith(doc.resultPublicId, { type: 'authenticated' });
      expect(updateSpy).toHaveBeenCalledWith(
        doc._id.toString(),
        expect.objectContaining({ status: 'failed' })
      );
    });
  });
});
