import '../../common/globals.js';
import { Worker, UnrecoverableError } from 'bullmq';
import env from '../../config/env.config.js';
import { getRedisClient } from '../../config/redis.config.js';
import { logger } from '../../config/logger.config.js';
import tryOnRepository from '../../modules/ai/try-on/try-on-generation.repository.js';
import shapeModelRepository from '../../modules/ai/shape-model/shape-model.repository.js';
import { getImageProvider } from '../../modules/ai/providers/image-provider.factory.js';
import uploadService from '../../modules/uploads/upload.service.js';
import entitlementService from '../../modules/subscriptions/entitlement.service.js';

let tryOnWorker = null;

/**
 * Determines whether an error is permanently non-retryable.
 * @param {Error} err
 * @returns {boolean}
 */
export const isNonRetryableError = (err) => {
  if (!err) return false;
  if (err.code === 'IMAGE_SAFETY' || err.errorCode === 'IMAGE_SAFETY') return true;
  if (err instanceof ApiError && err.statusCode < 500) return true;
  const msg = String(err.message || '').toLowerCase();
  return (
    msg.includes('not found') ||
    msg.includes('safety') ||
    msg.includes('invalid') ||
    msg.includes('unsupported')
  );
};

/**
 * Fetches an image buffer from a signed URL.
 * Exported for testing and mocking.
 *
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
export const fetchImageBuffer = async (url) => {
  const res = await fetch(url, { signal: globalThis.AbortSignal?.timeout?.(15_000) });
  if (!res.ok) {
    throw new Error(`Failed to download image from URL (${res.status} ${res.statusText})`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

/**
 * Processes a single Try-On generation job.
 *
 * Flow:
 * 1. Checks record and skips if already completed.
 * 2. Sets status to 'processing' and increments attempts.
 * 3. Fetches shape model & garment image buffers.
 * 4. Generates composite using configured Image Provider (Gemini / Mock).
 * 5. Uploads generated result to Cloudinary 'try-on-results' private folder.
 * 6. Marks record 'completed' with resultPublicId.
 * 7. On terminal failure (max attempts exhausted), marks 'failed' and refunds pre-billed quota.
 *
 * @param {import('bullmq').Job} job
 * @returns {Promise<Object>}
 */
export const processTryOnJob = async (job) => {
  const { generationId, jobId, userId } = job.data; // eslint-disable-line no-unused-vars
  logger.info(`👗 Processing try-on generation for record ${generationId} (user ${userId})`);

  const generation = await tryOnRepository.findById(generationId);
  if (!generation) {
    logger.warn(`Try-on record ${generationId} not found in database, skipping job`);
    return null;
  }

  if (generation.status === 'completed') {
    logger.info(`Try-on record ${generationId} is already completed, skipping`);
    return generation;
  }

  if (generation.status === 'failed') {
    logger.info(`Try-on record ${generationId} is marked failed or deleted, skipping execution`);
    return null;
  }

  const currentAttempt = (job.attemptsMade || 0) + 1;
  const maxAttempts = job?.opts?.attempts || 2;

  try {
    // 1. Transition status to 'processing'
    await tryOnRepository.updateById(generationId, {
      status: 'processing',
      attempts: currentAttempt,
    });

    // 2. Fetch Shape Model
    const shapeModel = await shapeModelRepository.findById(generation.shapeModelId);
    if (!shapeModel) {
      throw new Error(`Active shape model ${generation.shapeModelId} not found`);
    }

    const shapeModelSignedUrl = uploadService.getAssetUrl(shapeModel.publicId, 3600);
    const personImageBuffer = await fetchImageBuffer(shapeModelSignedUrl);

    // 3. Fetch all garment image buffers
    const garmentImages = [];
    for (const g of generation.garments) {
      const gUrl = uploadService.getAssetUrl(g.resolvedPublicId, 3600);

      const gBuffer = await fetchImageBuffer(gUrl);
      garmentImages.push({
        buffer: gBuffer,
        imageUrl: gUrl,
        mimeType: 'image/jpeg',
        slot: g.slot,
        label: g.label,
      });
    }

    // 4. Generate try-on composite
    const provider = getImageProvider();
    const generated = await provider.generateTryOn({
      personImageBuffer,
      personImageUrl: shapeModelSignedUrl,
      personMimeType: 'image/jpeg',
      garmentImages,
      promptVersion: generation.promptVersion,
      resolution: generation.resolution,
      timeoutMs: env.AI_TRY_ON_TIMEOUT_MS,
    });

    // 5. Upload result to Cloudinary authenticated private folder 'try-on-results'
    const uploadUser = { _id: generation.userId, role: 'client' };
    const uploadFilePayload = {
      buffer: generated.imageBuffer,
      mimetype: generated.mimeType || 'image/jpeg',
      originalname: `tryon_${generationId}.jpg`,
    };
    const uploadRes = await uploadService.uploadFile(
      uploadUser,
      'try-on-results',
      uploadFilePayload
    );

    // 6. Mark generation completed
    const completed = await tryOnRepository.markCompleted(generationId, {
      resultPublicId: uploadRes.publicId,
      resultUrl: uploadRes.url,
      completedAt: new Date(),
    });

    logger.info(`✅ Try-on generation completed successfully for record ${generationId}`);
    return completed;
  } catch (err) {
    const isNonRetryable = isNonRetryableError(err);
    const isTerminal = currentAttempt >= maxAttempts || isNonRetryable;

    logger.error(`❌ Try-on generation error for record ${generationId} (attempt ${currentAttempt}/${maxAttempts}):`, {
      error: err.message,
      isNonRetryable,
      isTerminal,
    });

    if (isTerminal) {
      logger.error(`🚨 Terminal failure for try-on record ${generationId}. Refunding user quota.`);

      const errorCode =
        err.code ||
        err.errorCode ||
        (err.statusCode === 504 ? 'ETIMEDOUT' : null) ||
        (err.message?.toLowerCase().includes('safety') ? 'IMAGE_SAFETY' : null) ||
        (err.message?.toLowerCase().includes('not found') ? 'ASSET_NOT_FOUND' : null) ||
        (err.message?.toLowerCase().includes('timed out') ? 'ETIMEDOUT' : null) ||
        'GENERATION_FAILED';

      await tryOnRepository.markFailed(generationId, {
        errorMessage: err.message || 'Generation failed',
        errorCode,
        failedAt: new Date(),
      });

      // Terminal failure refund guarantee with fresh idempotency check
      const latestGen = await tryOnRepository.findById(generationId);
      if (latestGen && !latestGen.quotaRefunded && latestGen.quotaSource) {
        try {
          const metric =
            latestGen.quotaSource === 'monthly'
              ? 'ai.tryOn.monthly'
              : 'ai.tryOn.trial.lifetime';

          await entitlementService.refundQuota(latestGen.userId, metric, 1);
          await tryOnRepository.markQuotaRefunded(generationId);
          logger.info(`💰 Successfully refunded 1 ${metric} quota to user ${latestGen.userId}`);
        } catch (refundErr) {
          logger.error('Failed to refund try-on quota after terminal error:', refundErr);
        }
      }

      if (isNonRetryable) {
        throw new UnrecoverableError(err.message);
      }
    }

    throw err;
  }
};

/**
 * Starts the Try-On BullMQ worker instance.
 *
 * @returns {Worker|null}
 */
export const startTryOnWorker = () => {
  if (env.NODE_ENV === 'test' || tryOnWorker) {
    return tryOnWorker;
  }

  const redis = getRedisClient();
  tryOnWorker = new Worker('tryon-generation', processTryOnJob, {
    connection: redis,
    concurrency: 2,
    lockDuration: 300_000,
  });

  tryOnWorker.on('completed', (job) => {
    logger.info(`Try-on worker completed job ${job.id}`);
  });

  tryOnWorker.on('failed', (job, err) => {
    logger.error(`Try-on worker failed job ${job?.id}: ${err.message}`);
  });

  return tryOnWorker;
};

/**
 * Stops the Try-On BullMQ worker instance gracefully.
 */
export const stopTryOnWorker = async () => {
  if (tryOnWorker) {
    await tryOnWorker.close();
    tryOnWorker = null;
  }
};

export default {
  processTryOnJob,
  startTryOnWorker,
  stopTryOnWorker,
  fetchImageBuffer,
};
