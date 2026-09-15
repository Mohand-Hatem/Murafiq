import wardrobeRepo from './wardrobe.repository.js';
import queueModule from '../../jobs/queues/wardrobe.queue.js';
import vectorConfig from '../../config/vector.config.js';
import entitlementService from '../subscriptions/entitlement.service.js';
import { CLASSIFICATION_STATUS } from './wardrobe-item.model.js';
import { logger } from '../../config/logger.config.js';
import cloudinary from '../../config/cloudinary.config.js';
import aiConversationService from '../ai/conversation/ai-conversation.service.js';
import { normalizeGarmentAttributes } from './wardrobe-attribute.normalizer.js';

export const createWardrobeItem = async (userId, { uploadRef }) => {
  // 0. Verify ownership: uploadRef must contain the caller's own userId
  const parts = uploadRef ? uploadRef.split('/') : [];
  // Expected: ['murafiq', 'wardrobe', '<userId>', '<uuid>']
  if (parts.length < 4 || parts[2] !== userId.toString()) {
    throw new ApiError(400, 'uploadRef does not belong to the authenticated user');
  }

  // 1. Enforce the plan's wardrobe.photos.max cap BEFORE creating anything or spending a
  // vision-classification call.
  const { hasCapacity, limit } = await entitlementService.capacity(
    userId,
    'wardrobe.photos.max',
    'client'
  );
  if (!hasCapacity) {
    throw new ApiError(
      429,
      `Wardrobe photo limit reached. Your plan allows ${limit} item(s). Upgrade your plan for more storage.`
    );
  }

  // 2. Resolve the secure Cloudinary URL server-side from the verified internal reference
  const imageUrl = cloudinary.url(uploadRef, { secure: true });

  // 3. Create initial pending item in MongoDB
  const item = await wardrobeRepo.createWardrobeItem({
    userId,
    imageUrl,
    sourceUploadRef: uploadRef,
    classificationStatus: CLASSIFICATION_STATUS.PENDING,
  });

  // 4. Enqueue async classification job to BullMQ
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
  const { page, limit, category, formality, season, search, genderPresentation, subcategory, fit, isArchived } = query;
  let itemIds;
  if (search && typeof search === 'string' && search.trim()) {
    const semanticResults = await searchWardrobeSemantic(userId, search, { topK: 50 });
    itemIds = semanticResults.map((r) => r._id);
  }
  return wardrobeRepo.findUserWardrobeItems(
    userId,
    { category, formality, season, itemIds, genderPresentation, subcategory, fit, isArchived },
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

/**
 * Retrieves candidate wardrobe items for outfit composition, grouped by category slot.
 * Enforces compact projections, slot-level concurrency, and capped candidate pools (max 8 per slot).
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {Object} options
 * @param {string[]} [options.slots=['top', 'bottom', 'shoes', 'outerwear', 'accessory']]
 * @param {string|string[]} [options.formality]
 * @param {string} [options.season]
 * @param {string} [options.genderPresentation]
 * @param {number} [options.limitPerSlot=6]
 * @returns {Promise<Object>} Map of slot name to array of compact candidate items
 */
export const getWardrobeCandidates = async (userId, options = {}) => {
  const {
    slots = ['top', 'bottom', 'shoes', 'outerwear', 'accessory'],
    formality,
    season,
    genderPresentation,
    limitPerSlot = 6,
  } = options;

  const effectiveLimit = Math.min(Math.max(1, parseInt(limitPerSlot, 10) || 6), 8);

  const slotPromises = slots.map(async (slot) => {
    const candidates = await wardrobeRepo.findCandidatesForSlot(userId, {
      slot,
      formality,
      season,
      genderPresentation,
      limit: effectiveLimit,
    });
    return [slot, candidates];
  });

  const results = await Promise.all(slotPromises);
  return Object.fromEntries(results);
};

/**
 * Performs semantic search over a user's wardrobe vectors in Upstash Vector.
 * Hydrates matching items from MongoDB asserting user isolation and excluding archived garments.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string} queryEn - English search phrase (e.g. 'navy blue linen shirt')
 * @param {Object} [options]
 * @param {Object} [options.filters] - Metadata filters passed to vector DB
 * @param {number} [options.topK=5] - Maximum number of semantic candidates
 * @returns {Promise<Array<Object>>} Hydrated wardrobe items with semanticScore
 */
export const searchWardrobeSemantic = async (userId, queryEn, options = {}) => {
  if (!queryEn || typeof queryEn !== 'string' || !queryEn.trim()) {
    return [];
  }

  const { filters, topK = 5 } = options;
  const vectorNs = vectorConfig.getUserVectorNamespace(userId);
  const matches = await vectorNs.query({
    data: queryEn.trim(),
    topK,
    filter: filters,
  });

  if (!matches || matches.length === 0) {
    return [];
  }

  const itemIds = matches.map((m) => m.id).filter(Boolean);
  if (itemIds.length === 0) {
    return [];
  }

  const items = await wardrobeRepo.findItemsByIds(userId, itemIds);
  const itemMap = new Map(items.map((i) => [i._id.toString(), i]));

  return matches
    .map((match) => {
      const item = itemMap.get(String(match.id));
      if (!item) return null;
      return {
        ...item,
        semanticScore: match.score,
      };
    })
    .filter(Boolean);
};

/**
 * Hydrates multiple wardrobe items by IDs ensuring ownership isolation and active status.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {Array<string|mongoose.Types.ObjectId>} itemIds
 * @returns {Promise<Array<Object>>}
 */
export const getWardrobeItemsByIds = async (userId, itemIds) => {
  if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
    return [];
  }
  return wardrobeRepo.findItemsByIds(userId, itemIds);
};

/**
 * Saves a garment image from an AI chat message directly into the client's wardrobe.
 * Promotes Cloudinary asset from ai-chat to wardrobe namespace, reuses stored garmentAnalysis
 * to populate item attributes without extra model calls, indexes into vector DB, and clears expiry.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId - Authenticated client ID
 * @param {string} messageId - ID of the AiMessage containing the garment image
 * @returns {Promise<Object>} Created WardrobeItem document
 */
export const saveWardrobeItemFromChat = async (userId, messageId) => {
  if (!messageId) {
    throw new ApiError(400, 'messageId is required');
  }

  // 1. Fetch message ensuring caller owns the conversation
  const message = await aiConversationService.getMessageById(messageId, userId);
  if (!message) {
    throw new ApiError(404, 'Message not found or access denied');
  }

  // 2. Idempotency check: if already saved, return the existing wardrobe item
  if (message.savedWardrobeItemId) {
    const existing = await wardrobeRepo.findWardrobeItemByIdAndUser(
      message.savedWardrobeItemId,
      userId
    );
    if (existing) {
      return existing;
    }
  }

  // 3. Verify message has garment image & analysis
  if (!message.imageRef || !message.imageAnalysis) {
    throw new ApiError(400, 'Message does not contain an analyzed garment image');
  }

  // 4. Enforce plan wardrobe storage capacity before write
  const { hasCapacity, limit } = await entitlementService.capacity(
    userId,
    'wardrobe.photos.max',
    'client'
  );
  if (!hasCapacity) {
    throw new ApiError(
      429,
      `Wardrobe photo limit reached. Your plan allows ${limit} item(s). Upgrade your plan for more storage.`
    );
  }

  // 5. Promote Cloudinary asset from ai-chat to wardrobe
  let finalPublicId = message.imageRef;
  let finalImageUrl = message.imageUrl;

  if (message.imageRef && message.imageRef.includes('/ai-chat/')) {
    const promotedPublicId = message.imageRef.replace('/ai-chat/', '/wardrobe/');
    try {
      await cloudinary.uploader.rename(message.imageRef, promotedPublicId, { overwrite: true });
      finalPublicId = promotedPublicId;
      finalImageUrl = cloudinary.url(promotedPublicId, { secure: true });
    } catch (renameErr) {
      logger.warn('Failed to rename Cloudinary asset, retaining existing reference:', renameErr.message);
    }
  }

  // 6. Normalize attributes from stored imageAnalysis (zero additional Gemini calls!)
  const rawAnalysis = message.imageAnalysis || {};
  const { normalized, needsReview } = normalizeGarmentAttributes(rawAnalysis);

  const aiDescription = normalized.aiDescription ||
    `${normalized.primaryColor || ''} ${normalized.material || ''} ${normalized.category || 'clothing'}`.trim();

  // 7. Create WardrobeItem document with origin: 'chat_save' and status: 'done'
  const item = await wardrobeRepo.createWardrobeItem({
    userId,
    imageUrl: finalImageUrl,
    origin: 'chat_save',
    classificationStatus: CLASSIFICATION_STATUS.DONE,
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
    styleTags: normalized.styleTags,
    aiDescription,
    classificationConfidence: normalized.confidence,
    needsReview,
    rawModelResponse: rawAnalysis,
  });

  // 8. Upsert vector into user's namespace in Upstash Vector
  try {
    const vectorNs = vectorConfig.getUserVectorNamespace(userId);
    await vectorNs.upsert({
      id: item._id.toString(),
      data: aiDescription,
      metadata: {
        category: item.category,
        subcategory: item.subcategory,
        formality: item.formality,
        season: item.season,
        material: item.material,
        fit: item.fit,
        colorFamily: item.colorFamily,
        genderPresentation: item.genderPresentation,
        primaryColor: item.primaryColor,
      },
    });
  } catch (vecErr) {
    logger.error('Failed to index chat-saved wardrobe item in vector DB:', vecErr);
  }

  // 9. Update AiMessage: clear TTL (imageExpiresAt = null) and set savedWardrobeItemId
  await aiConversationService.updateMessage(messageId, {
    savedWardrobeItemId: item._id,
    imageExpiresAt: null,
    imageRef: finalPublicId,
    imageUrl: finalImageUrl,
  });

  return item;
};

export default {
  createWardrobeItem,
  getMyWardrobe,
  getWardrobeItemById,
  updateWardrobeItem,
  deleteWardrobeItem,
  getWardrobeCandidates,
  searchWardrobeSemantic,
  getWardrobeItemsByIds,
  saveWardrobeItemFromChat,
};


