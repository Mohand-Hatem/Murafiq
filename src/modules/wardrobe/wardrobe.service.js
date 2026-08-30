import wardrobeRepo from './wardrobe.repository.js';
import queueModule from '../../jobs/queues/wardrobe.queue.js';
import vectorConfig from '../../config/vector.config.js';
import { CLASSIFICATION_STATUS } from './wardrobe-item.model.js';
import { logger } from '../../config/logger.config.js';

export const createWardrobeItem = async (userId, { imageUrl }) => {
  // 1. Create initial pending item in MongoDB
  const item = await wardrobeRepo.createWardrobeItem({
    userId,
    imageUrl,
    classificationStatus: CLASSIFICATION_STATUS.PENDING,
  });

  // 2. Enqueue async classification job to BullMQ
  try {
    await queueModule.addWardrobeClassificationJob({
      itemId: item._id,
      userId,
      imageUrl,
    });
  } catch (queueErr) {
    logger.error('Failed to enqueue wardrobe classification job:', queueErr);
  }

  return item;
};

export const getMyWardrobe = async (userId, query) => {
  const { page, limit, category, formality, season, search } = query;
  return wardrobeRepo.findUserWardrobeItems(
    userId,
    { category, formality, season, search },
    { page, limit }
  );
};

export const getWardrobeItemById = async (userId, itemId) => {
  const item = await wardrobeRepo.findWardrobeItemByIdAndUser(itemId, userId);
  if (!item) {
    throw new ApiError(404, 'Wardrobe item not found or you do not have permission');
  }
  return item;
};

export const updateWardrobeItem = async (userId, itemId, updateData) => {
  const existing = await wardrobeRepo.findWardrobeItemByIdAndUser(itemId, userId);
  if (!existing) {
    throw new ApiError(404, 'Wardrobe item not found or you do not have permission');
  }

  const updated = await wardrobeRepo.updateWardrobeItemById(itemId, updateData);

  // If description or category changed, update vector embedding in Upstash
  const descriptionToEmbed = updateData.aiDescription || updated.aiDescription;
  if (descriptionToEmbed) {
    try {
      const vectorNs = vectorConfig.getUserVectorNamespace(userId);
      await vectorNs.upsert({
        id: itemId.toString(),
        data: descriptionToEmbed,
        metadata: {
          category: updated.category,
          formality: updated.formality,
          season: updated.season,
          material: updated.material,
          primaryColor: updated.primaryColor,
        },
      });
    } catch (vectorErr) {
      logger.error(`Failed to update vector for item ${itemId}:`, vectorErr);
    }
  }

  return updated;
};

export const deleteWardrobeItem = async (userId, itemId) => {
  const item = await wardrobeRepo.deleteWardrobeItemByIdAndUser(itemId, userId);
  if (!item) {
    throw new ApiError(404, 'Wardrobe item not found or you do not have permission');
  }

  // Delete from vector DB (Upstash per-user namespace)
  try {
    const vectorNs = vectorConfig.getUserVectorNamespace(userId);
    await vectorNs.delete(itemId.toString());
  } catch (vectorErr) {
    logger.error(`Failed to delete vector for item ${itemId}:`, vectorErr);
  }

  return { success: true };
};

export default {
  createWardrobeItem,
  getMyWardrobe,
  getWardrobeItemById,
  updateWardrobeItem,
  deleteWardrobeItem,
};
