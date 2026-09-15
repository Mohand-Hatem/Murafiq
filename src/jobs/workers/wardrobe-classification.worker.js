import { Worker } from 'bullmq';
import env from '../../config/env.config.js';
import { getRedisClient } from '../../config/redis.config.js';
import geminiService from '../../config/gemini.config.js';
import vectorConfig from '../../config/vector.config.js';
import wardrobeRepo from '../../modules/wardrobe/wardrobe.repository.js';
import { CLASSIFICATION_STATUS } from '../../modules/wardrobe/wardrobe-item.model.js';
import { normalizeGarmentAttributes } from '../../modules/wardrobe/wardrobe-attribute.normalizer.js';
import { logger } from '../../config/logger.config.js';

let wardrobeWorker = null;

/**
 * Process a single wardrobe classification job
 */
export const processWardrobeJob = async (job) => {
  const { itemId, userId, imageUrl } = job.data;
  logger.info(`🤖 Processing wardrobe classification for item ${itemId} (user ${userId})`);

  try {
    // 1. Call Gemini Flash Vision model
    const rawClassified = await geminiService.classifyClothingImage(imageUrl);
    const { normalized, needsReview } = normalizeGarmentAttributes(rawClassified);

    // 2. Build semantic description and upsert into Upstash Vector namespace
    const aiDescription = normalized.aiDescription ||
      `${normalized.primaryColor || ''} ${normalized.material || ''} ${normalized.category || 'clothing'}`.trim();

    const vectorNs = vectorConfig.getUserVectorNamespace(userId);
    await vectorNs.upsert({
      id: itemId.toString(),
      data: aiDescription,
      metadata: {
        category: normalized.category,
        subcategory: normalized.subcategory,
        formality: normalized.formality,
        season: normalized.season,
        material: normalized.material,
        fit: normalized.fit,
        colorFamily: normalized.colorFamily,
        genderPresentation: normalized.genderPresentation,
        primaryColor: normalized.primaryColor,
      },
    });

    // 3. Update database record with normalized attributes and metadata stamps
    const updated = await wardrobeRepo.updateWardrobeItemById(itemId, {
      category: normalized.category,
      subcategory: normalized.subcategory,
      primaryColor: normalized.primaryColor,
      secondaryColors: normalized.secondaryColors,
      pattern: normalized.pattern,
      formality: normalized.formality,
      season: normalized.season,
      material: normalized.material,
      fit: normalized.fit,
      colorFamily: normalized.colorFamily,
      isNeutral: normalized.isNeutral,
      genderPresentation: normalized.genderPresentation,
      printedText: normalized.printedText,
      aiConfidence: normalized.aiConfidence,
      aiModel: env.AI_MODEL_VISION || 'gemini-3.1-flash-lite',
      aiPromptVersion: 'v1.0.0',
      styleTags: normalized.styleTags,
      aiDescription,
      embeddingId: itemId.toString(),
      classificationStatus: needsReview ? CLASSIFICATION_STATUS.NEEDS_REVIEW : CLASSIFICATION_STATUS.DONE,
      classificationError: null,
    });

    logger.info(`✅ Wardrobe item ${itemId} successfully classified and indexed`);
    return updated;
  } catch (err) {
    logger.error(`❌ Wardrobe classification failed for item ${itemId}:`, err);
    await wardrobeRepo.updateWardrobeItemById(itemId, {
      classificationStatus: CLASSIFICATION_STATUS.FAILED,
      classificationError: err.message || 'Classification failed',
    });
    throw err;
  }
};

export const startWardrobeWorker = () => {
  if (env.NODE_ENV === 'test' || wardrobeWorker) {
    return wardrobeWorker;
  }

  const redis = getRedisClient();
  wardrobeWorker = new Worker('wardrobe-classification', processWardrobeJob, {
    connection: redis,
    concurrency: 5,
  });

  wardrobeWorker.on('completed', (job) => {
    logger.info(`Worker completed wardrobe job ${job.id}`);
  });

  wardrobeWorker.on('failed', (job, err) => {
    logger.error(`Worker failed wardrobe job ${job?.id}: ${err.message}`);
  });

  return wardrobeWorker;
};

export const stopWardrobeWorker = async () => {
  if (wardrobeWorker) {
    await wardrobeWorker.close();
    wardrobeWorker = null;
  }
};

export default {
  processWardrobeJob,
  startWardrobeWorker,
  stopWardrobeWorker,
};
