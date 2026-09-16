import crypto from 'crypto';
import tryOnRepository from './try-on-generation.repository.js';
import shapeModelService from '../shape-model/shape-model.service.js';
import garmentResolver from './garment-resolver.js';
import { toTryOnDto } from './try-on.dto.js';
import entitlementService from '../../subscriptions/entitlement.service.js';
import uploadService from '../../uploads/upload.service.js';
import outfitService from '../outfits/outfit.service.js';
import wardrobeService from '../../wardrobe/wardrobe.service.js';
import { logger } from '../../../config/logger.config.js';
import tryonQueue from '../../../jobs/queues/tryon.queue.js';

let queueHelper = tryonQueue;

/**
 * Injects or overrides the BullMQ try-on queue helper.
 * @param {Object|null} helper
 */
export const setQueueHelper = (helper) => {
  queueHelper = helper;
};

/**
 * Computes deterministic SHA-256 hash for deduplication.
 * Approved Decision Q2: hash(userId + shapeModelId + sortedGarmentIds + promptVersion)
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string|import('mongoose').Types.ObjectId} shapeModelId
 * @param {Array<Object>} garments
 * @param {string} [promptVersion='v1']
 * @returns {string} SHA-256 hex digest
 */
export const computeJobId = (userId, shapeModelId, garments, promptVersion = 'v1') => {
  const sortedGarmentKeys = garments
    .map((g) => `${g.slot}:${g.itemId ? g.itemId.toString() : g.imageRef}`)
    .sort()
    .join('|');

  const raw = `${userId.toString()}:${shapeModelId.toString()}:${sortedGarmentKeys}:${promptVersion}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
};

/**
 * Creates or deduplicates a Try-On generation request.
 *
 * Handles:
 * 1. Shape model ownership and active status validation.
 * 2. Garment ownership resolution (wardrobe + uploads) and slot conflict prevention.
 * 3. Deterministic deduplication (Approved Decision Q2):
 *    - 'pending' / 'processing' -> returns existing record with 202 without re-billing.
 *    - 'completed' within 24 hours -> returns existing result with 200 without re-billing.
 * 4. Pre-billing quota consumption with cascading monthly/lifetime quota source.
 * 5. Generation document creation and BullMQ job enqueuing.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {Object} params
 * @param {string} params.shapeModelId
 * @param {Array<Object>} params.garments
 * @param {'512x512'|'1024x1024'} [params.resolution='1024x1024']
 * @param {string} [params.promptVersion='v1']
 * @returns {Promise<{ isDuplicate: boolean, statusCode: number, generation: Object }>}
 */
export const createTryOnRequest = async (
  userId,
  { shapeModelId, garments, outfitId, itemId, resolution = '1024x1024', promptVersion = 'v1' }
) => {
  let inputGarments = garments;
  let resolvedOutfitId = null;

  if (outfitId) {
    const outfit = await outfitService.getOutfitById(outfitId, userId);
    if (!outfit) {
      throw new ApiError(404, 'Outfit not found or access denied');
    }

    if (!Array.isArray(outfit.items) || outfit.items.length === 0) {
      throw new ApiError(400, 'Selected outfit contains no wardrobe items to try on');
    }

    const itemIds = outfit.items.map((it) => (it._id ? it._id.toString() : it.toString()));
    const wardrobeItems = await wardrobeService.getWardrobeItemsByIds(userId, itemIds);

    if (!wardrobeItems || wardrobeItems.length === 0) {
      throw new ApiError(400, 'None of the wardrobe items in this outfit could be found');
    }

    inputGarments = wardrobeItems.slice(0, 4).map((item) => ({
      source: 'wardrobe',
      itemId: item._id.toString(),
      slot: item.category,
      label: item.title || item.aiDescription || item.category || 'Wardrobe item',
    }));
    resolvedOutfitId = outfit._id;
  } else if (itemId && (!Array.isArray(inputGarments) || inputGarments.length === 0)) {
    inputGarments = [
      {
        source: 'wardrobe',
        itemId: itemId.toString(),
      },
    ];
  }

  if (!Array.isArray(inputGarments) || inputGarments.length === 0) {
    throw new ApiError(400, 'At least one garment is required for Virtual Try-On');
  }

  // 1. Validate Shape Model belongs to user and is currently active
  const shapeModel = await shapeModelService.getShapeModelById(userId, shapeModelId);

  // 2. Resolve garments and verify ownership (wardrobe / uploads)
  const resolvedGarments = await garmentResolver.resolveGarments(userId, inputGarments);

  // 3. Compute deterministic jobId
  const jobId = computeJobId(userId, shapeModel._id, resolvedGarments, promptVersion);

  // 4. Check for existing active job (pending or processing)
  const activeJob = await tryOnRepository.findActiveByJobId(jobId);
  if (activeJob) {
    return {
      isDuplicate: true,
      statusCode: 202,
      generation: toTryOnDto(activeJob),
    };
  }

  // 5. Check for completed result within the 24-hour cache window (Decision Q2)
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentCompleted = await tryOnRepository.findRecentCompletedByJobId(jobId, twentyFourHoursAgo);
  if (recentCompleted) {
    return {
      isDuplicate: true,
      statusCode: 200,
      generation: toTryOnDto(recentCompleted),
    };
  }

  // 6. Pre-bill try-on quota
  const { quotaSource } = await entitlementService.consumeTryOnQuota(userId, 'client');

  // 7. Persist generation record
  let generation;
  try {
    generation = await tryOnRepository.create({
      userId,
      shapeModelId: shapeModel._id,
      outfitId: resolvedOutfitId,
      garments: resolvedGarments,
      status: 'pending',
      jobId,
      promptVersion,
      resolution,
      quotaSource,
    });
  } catch (err) {
    if (err.code === 11000) {
      // Race condition defense: another concurrent request created the active job first
      try {
        const metric =
          quotaSource === 'monthly'
            ? 'ai.tryOn.monthly'
            : 'ai.tryOn.trial.lifetime';
        await entitlementService.refundQuota(userId, metric, 1);
      } catch (refundErr) {
        logger.error('Failed to refund try-on quota on duplicate collision:', refundErr);
      }

      const active = await tryOnRepository.findActiveByJobId(jobId);
      if (active) {
        return {
          isDuplicate: true,
          statusCode: 202,
          generation: toTryOnDto(active),
        };
      }
    }
    throw err;
  }

  // 8. Enqueue to BullMQ queue if queueHelper is wired
  if (queueHelper && typeof queueHelper.addTryOnJob === 'function') {
    try {
      await queueHelper.addTryOnJob({
        generationId: generation._id,
        jobId,
        userId,
      });
    } catch (err) {
      logger.error('Failed to enqueue try-on generation job:', err);
    }
  }

  return {
    isDuplicate: false,
    statusCode: 202,
    generation: toTryOnDto(generation),
  };
};

/**
 * Retrieves a try-on generation by ID, enforcing user ownership.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string|import('mongoose').Types.ObjectId} id
 * @returns {Promise<Object>}
 */
export const getGenerationById = async (userId, id) => {
  const doc = await tryOnRepository.findById(id);
  if (!doc) {
    throw new ApiError(404, 'Try-on generation not found');
  }

  if (doc.userId.toString() !== userId.toString()) {
    throw new ApiError(403, 'Forbidden: You do not have access to this try-on generation');
  }

  return toTryOnDto(doc);
};

/**
 * Lists try-on generations for the authenticated user.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {Object} [pagination={ page: 1, limit: 20 }]
 * @returns {Promise<{ data: Array, pagination: Object }>}
 */
export const listGenerations = async (userId, pagination = { page: 1, limit: 20 }) => {
  const { docs, total, page, totalPages } = await tryOnRepository.listUserGenerations(
    userId,
    pagination
  );

  return {
    data: docs.map((d) => toTryOnDto(d)),
    pagination: {
      total,
      page,
      totalPages,
    },
  };
};

/**
 * Deletes a try-on generation and destroys associated Cloudinary output asset.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string|import('mongoose').Types.ObjectId} id
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export const deleteGeneration = async (userId, id) => {
  const doc = await tryOnRepository.findById(id);
  if (!doc) {
    throw new ApiError(404, 'Try-on generation not found');
  }

  if (doc.userId.toString() !== userId.toString()) {
    throw new ApiError(403, 'Forbidden: You do not have permission to delete this generation');
  }

  if (doc.resultPublicId) {
    try {
      await uploadService.deleteFile(doc.resultPublicId, { type: 'authenticated' });
    } catch (err) {
      logger.warn('Failed to delete Cloudinary asset for try-on generation:', {
        publicId: doc.resultPublicId,
        error: err.message,
      });
    }
  }

  await tryOnRepository.updateById(id, { status: 'failed', errorMessage: 'Deleted by user' });

  return {
    success: true,
    message: 'Try-on generation deleted successfully',
  };
};

export default {
  computeJobId,
  createTryOnRequest,
  getGenerationById,
  listGenerations,
  deleteGeneration,
  setQueueHelper,
};
