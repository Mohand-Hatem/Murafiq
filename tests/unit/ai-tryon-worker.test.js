/**
 * Phase 15F Step 6 — BullMQ Try-On Queue & Worker Tests.
 *
 * Covers:
 * 1. tryon.queue.js: queue initialization, default options, and addTryOnJob.
 * 2. tryon-generation.worker.js:
 *    - Successful generation flow: download buffers, invoke provider, upload to Cloudinary, mark completed.
 *    - Early exit if job is already marked completed.
 *    - Transient failure on attempt 1 (rethrows without refunding quota).
 *    - Terminal failure on attempt 2 (marks failed and refunds monthly quota).
 *    - Terminal failure on attempt 2 (marks failed and refunds lifetime quota).
 *    - Double refund prevention (does not refund if quotaRefunded is true).
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import mongoose from 'mongoose';
import '../../src/common/globals.js';
import * as tryonQueue from '../../src/jobs/queues/tryon.queue.js';
import * as tryonWorker from '../../src/jobs/workers/tryon-generation.worker.js';
import tryOnRepository from '../../src/modules/ai/try-on/try-on-generation.repository.js';
import shapeModelRepository from '../../src/modules/ai/shape-model/shape-model.repository.js';
import * as imageProviderFactory from '../../src/modules/ai/providers/image-provider.factory.js';
import uploadService from '../../src/modules/uploads/upload.service.js';
import entitlementService from '../../src/modules/subscriptions/entitlement.service.js';

describe('Phase 15F Step 6 — Try-On BullMQ Queue & Worker', () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const generationId = new mongoose.Types.ObjectId().toString();
  const shapeModelId = new mongoose.Types.ObjectId().toString();

  const sampleBuffer = Buffer.from('fake-image-bytes');

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    imageProviderFactory.setImageProvider(null);
    jest.restoreAllMocks();
  });

  describe('Try-On Queue Configuration', () => {
    it('returns a mock queue in test environment without connecting to real Redis', () => {
      const queue = tryonQueue.getTryOnQueue();
      expect(queue).toBeDefined();
      expect(typeof queue.add).toBe('function');
    });

    it('addTryOnJob enqueues generate-tryon job with string IDs', async () => {
      const queue = tryonQueue.getTryOnQueue();
      const addSpy = jest.spyOn(queue, 'add').mockResolvedValue({ id: 'job-1' });

      const res = await tryonQueue.addTryOnJob({
        generationId,
        jobId: 'sha256-hash',
        userId,
      });

      expect(res.id).toBe('job-1');
      expect(addSpy).toHaveBeenCalledWith('generate-tryon', {
        generationId,
        jobId: 'sha256-hash',
        userId,
      });
    });
  });

  describe('Try-On Worker Execution', () => {
    const mockGeneration = {
      _id: new mongoose.Types.ObjectId(generationId),
      userId,
      shapeModelId: new mongoose.Types.ObjectId(shapeModelId),
      status: 'pending',
      garments: [
        {
          source: 'wardrobe',
          slot: 'top',
          label: 'Silk Shirt',
          resolvedPublicId: 'murafiq/wardrobe/user/item1',
        },
      ],
      promptVersion: 'v1',
      resolution: '1024x1024',
      quotaSource: 'monthly',
      quotaRefunded: false,
    };

    const mockShapeModel = {
      _id: new mongoose.Types.ObjectId(shapeModelId),
      publicId: `murafiq/shape-models/${userId}/model1`,
      status: 'active',
    };

    it('exits early without re-processing if generation is already completed', async () => {
      const completedDoc = { ...mockGeneration, status: 'completed' };
      jest.spyOn(tryOnRepository, 'findById').mockResolvedValue(completedDoc);
      const updateSpy = jest.spyOn(tryOnRepository, 'updateById');

      const res = await tryonWorker.processTryOnJob({
        data: { generationId, userId },
        attemptsMade: 0,
        opts: { attempts: 2 },
      });

      expect(res.status).toBe('completed');
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('successfully processes job: generates image, uploads result, marks completed', async () => {
      jest.spyOn(tryOnRepository, 'findById').mockResolvedValue(mockGeneration);
      jest.spyOn(tryOnRepository, 'updateById').mockResolvedValue({});
      jest.spyOn(shapeModelRepository, 'findById').mockResolvedValue(mockShapeModel);
      jest.spyOn(uploadService, 'getSignedUrl').mockReturnValue('https://signed.cloudinary/test');

      // Mock fetchImageBuffer
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => sampleBuffer.buffer,
      });

      // Mock image provider
      const fakeProvider = {
        generateTryOn: jest.fn().mockResolvedValue({
          imageBuffer: sampleBuffer,
          mimeType: 'image/jpeg',
          width: 1024,
          height: 1024,
        }),
      };
      imageProviderFactory.setImageProvider(fakeProvider);

      // Mock Cloudinary upload
      jest.spyOn(uploadService, 'uploadFile').mockResolvedValue({
        publicId: `murafiq/try-on-results/${userId}/result_uuid`,
        url: `https://cloudinary.com/result_uuid.jpg`,
      });

      const markCompletedSpy = jest.spyOn(tryOnRepository, 'markCompleted').mockResolvedValue({
        ...mockGeneration,
        status: 'completed',
      });

      const res = await tryonWorker.processTryOnJob({
        data: { generationId, userId },
        attemptsMade: 0,
        opts: { attempts: 2 },
      });

      expect(res.status).toBe('completed');
      expect(tryOnRepository.updateById).toHaveBeenCalledWith(generationId, {
        status: 'processing',
        attempts: 1,
      });
      expect(fakeProvider.generateTryOn).toHaveBeenCalledWith(
        expect.objectContaining({
          promptVersion: 'v1',
          resolution: '1024x1024',
        })
      );
      expect(uploadService.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ _id: userId, role: 'client' }),
        'try-on-results',
        expect.objectContaining({
          buffer: sampleBuffer,
          mimetype: 'image/jpeg',
        })
      );
      expect(markCompletedSpy).toHaveBeenCalledWith(generationId, {
        resultPublicId: `murafiq/try-on-results/${userId}/result_uuid`,
        resultUrl: `https://cloudinary.com/result_uuid.jpg`,
        completedAt: expect.any(Date),
      });
    });

    it('rethrows error on attempt 1 without refunding quota (allows BullMQ retry)', async () => {
      jest.spyOn(tryOnRepository, 'findById').mockResolvedValue(mockGeneration);
      jest.spyOn(tryOnRepository, 'updateById').mockResolvedValue({});
      jest.spyOn(shapeModelRepository, 'findById').mockResolvedValue(mockShapeModel);

      globalThis.fetch = jest.fn().mockRejectedValue(new Error('Transient connection error'));

      const markFailedSpy = jest.spyOn(tryOnRepository, 'markFailed');
      const refundQuotaSpy = jest.spyOn(entitlementService, 'refundQuota');

      await expect(
        tryonWorker.processTryOnJob({
          data: { generationId, userId },
          attemptsMade: 0, // attempt 1 of 2
          opts: { attempts: 2 },
        })
      ).rejects.toThrow('Transient connection error');

      // Attempt 1: Must NOT mark failed or refund yet
      expect(markFailedSpy).not.toHaveBeenCalled();
      expect(refundQuotaSpy).not.toHaveBeenCalled();
    });

    it('marks failed and refunds monthly quota on terminal attempt 2', async () => {
      jest.spyOn(tryOnRepository, 'findById').mockResolvedValue(mockGeneration);
      jest.spyOn(tryOnRepository, 'updateById').mockResolvedValue({});
      jest.spyOn(shapeModelRepository, 'findById').mockResolvedValue(mockShapeModel);

      globalThis.fetch = jest.fn().mockRejectedValue(new Error('Permanent provider error'));

      const markFailedSpy = jest.spyOn(tryOnRepository, 'markFailed').mockResolvedValue({});
      const refundQuotaSpy = jest.spyOn(entitlementService, 'refundQuota').mockResolvedValue();
      const markQuotaRefundedSpy = jest.spyOn(tryOnRepository, 'markQuotaRefunded').mockResolvedValue({});

      await expect(
        tryonWorker.processTryOnJob({
          data: { generationId, userId },
          attemptsMade: 1, // attempt 2 of 2 -> terminal
          opts: { attempts: 2 },
        })
      ).rejects.toThrow('Permanent provider error');

      expect(markFailedSpy).toHaveBeenCalledWith(generationId, {
        errorMessage: 'Permanent provider error',
        failedAt: expect.any(Date),
      });
      expect(refundQuotaSpy).toHaveBeenCalledWith(userId, 'ai.tryOn.monthly', 1);
      expect(markQuotaRefundedSpy).toHaveBeenCalledWith(generationId);
    });

    it('marks failed and refunds lifetime quota when quotaSource is lifetime', async () => {
      const lifetimeGeneration = {
        ...mockGeneration,
        quotaSource: 'lifetime',
      };

      jest.spyOn(tryOnRepository, 'findById').mockResolvedValue(lifetimeGeneration);
      jest.spyOn(tryOnRepository, 'updateById').mockResolvedValue({});
      jest.spyOn(shapeModelRepository, 'findById').mockResolvedValue(mockShapeModel);

      globalThis.fetch = jest.fn().mockRejectedValue(new Error('Quota exhausted failure'));

      jest.spyOn(tryOnRepository, 'markFailed').mockResolvedValue({});
      const refundQuotaSpy = jest.spyOn(entitlementService, 'refundQuota').mockResolvedValue();
      jest.spyOn(tryOnRepository, 'markQuotaRefunded').mockResolvedValue({});

      await expect(
        tryonWorker.processTryOnJob({
          data: { generationId, userId },
          attemptsMade: 1, // attempt 2 of 2 -> terminal
          opts: { attempts: 2 },
        })
      ).rejects.toThrow('Quota exhausted failure');

      expect(refundQuotaSpy).toHaveBeenCalledWith(userId, 'ai.tryOn.trial.lifetime', 1);
    });

    it('does not double-refund quota if quotaRefunded is already true', async () => {
      const alreadyRefundedGen = {
        ...mockGeneration,
        quotaRefunded: true,
      };

      jest.spyOn(tryOnRepository, 'findById').mockResolvedValue(alreadyRefundedGen);
      jest.spyOn(tryOnRepository, 'updateById').mockResolvedValue({});
      jest.spyOn(shapeModelRepository, 'findById').mockResolvedValue(mockShapeModel);

      globalThis.fetch = jest.fn().mockRejectedValue(new Error('Fatal error'));

      jest.spyOn(tryOnRepository, 'markFailed').mockResolvedValue({});
      const refundQuotaSpy = jest.spyOn(entitlementService, 'refundQuota');

      await expect(
        tryonWorker.processTryOnJob({
          data: { generationId, userId },
          attemptsMade: 1, // terminal
          opts: { attempts: 2 },
        })
      ).rejects.toThrow('Fatal error');

      expect(refundQuotaSpy).not.toHaveBeenCalled();
    });
  });
});
