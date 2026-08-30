import { Worker } from 'bullmq';
import env from '../../config/env.config.js';
import { getRedisClient } from '../../config/redis.config.js';
import geminiService from '../../config/gemini.config.js';
import vectorConfig from '../../config/vector.config.js';
import wardrobeRepo from '../../modules/wardrobe/wardrobe.repository.js';
import { CLASSIFICATION_STATUS } from '../../modules/wardrobe/wardrobe-item.model.js';
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
    const classified = await geminiService.classifyClothingImage(imageUrl);

    // 2. Build semantic description and upsert into Upstash Vector namespace
    const aiDescription = classified.aiDescription ||
      `${classified.primaryColor || ''} ${classified.material || ''} ${classified.category || 'clothing'}`.trim();

    const vectorNs = vectorConfig.getUserVectorNamespace(userId);
    await vectorNs.upsert({
      id: itemId.toString(),
      data: aiDescription,
      metadata: {
        category: classified.category,
        formality: classified.formality,
        season: classified.season,
        material: classified.material,
        primaryColor: classified.primaryColor,
      },
    });

    // 3. Update database record with classified attributes
    const updated = await wardrobeRepo.updateWardrobeItemById(itemId, {
      category: classified.category,
      primaryColor: classified.primaryColor,
      secondaryColors: classified.secondaryColors || [],
      pattern: classified.pattern,
      formality: classified.formality,
      season: classified.season || [],
      material: classified.material,
      styleTags: classified.styleTags || [],
      aiDescription,
      embeddingId: itemId.toString(),
      classificationStatus: CLASSIFICATION_STATUS.DONE,
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
