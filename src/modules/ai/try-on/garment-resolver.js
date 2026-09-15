import wardrobeService from '../../wardrobe/wardrobe.service.js';

const ALLOWED_SLOTS = new Set(['top', 'bottom', 'outerwear', 'shoes', 'dress', 'accessory']);

/**
 * Validates slot combinations to prevent impossible garment conflicts
 * (e.g. dress + top, duplicate bottoms, etc.)
 *
 * @param {Array<{ slot: string }>} garments
 */
export const validateSlotCompatibility = (garments) => {
  const slotCounts = {};
  for (const g of garments) {
    slotCounts[g.slot] = (slotCounts[g.slot] || 0) + 1;
  }

  if (slotCounts.dress && (slotCounts.top || slotCounts.bottom)) {
    throw new ApiError(400, 'Conflicting outfit slots: A dress cannot be combined with a separate top or bottom');
  }

  // Duplicate check for single-garment slots
  const nonRepeatable = ['top', 'bottom', 'shoes', 'dress'];
  for (const slot of nonRepeatable) {
    if (slotCounts[slot] > 1) {
      throw new ApiError(400, `Conflicting outfit slots: Multiple garments specified for slot '${slot}'`);
    }
  }
};

/**
 * Resolves garments for Virtual Try-On, validating ownership and user namespace isolation.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {Array<Object>} garments
 * @returns {Promise<Array<Object>>} Resolved garments with verified storage references
 */
export const resolveGarments = async (userId, garments) => {
  if (!Array.isArray(garments) || garments.length < 1 || garments.length > 4) {
    throw new ApiError(400, 'Virtual Try-On requires between 1 and 4 garments');
  }

  const userStr = userId.toString();
  const expectedUploadPrefix = `murafiq/ai-chat/${userStr}/`;
  const resolved = [];

  for (const g of garments) {
    if (!g || typeof g !== 'object') {
      throw new ApiError(400, 'Invalid garment entry');
    }

    if (g.source === 'wardrobe') {
      if (!g.itemId) {
        throw new ApiError(400, 'Garment with source "wardrobe" requires itemId');
      }

      // getWardrobeItemById enforces user ownership and throws 404/403 if unowned
      const item = await wardrobeService.getWardrobeItemById(userId, g.itemId);
      const slot = g.slot || item.category || 'top';

      if (!ALLOWED_SLOTS.has(slot)) {
        throw new ApiError(400, `Unsupported garment slot: ${slot}`);
      }

      const resolvedPublicId = item.imageUrl || item.sourceUploadRef;
      if (!resolvedPublicId) {
        throw new ApiError(400, `Wardrobe item ${g.itemId} is missing image reference`);
      }

      resolved.push({
        source: 'wardrobe',
        itemId: item._id,
        imageRef: null,
        slot,
        label: g.label || item.title || item.aiDescription || item.category || 'Wardrobe item',
        resolvedPublicId,
      });
    } else if (g.source === 'upload') {
      if (!g.imageRef || typeof g.imageRef !== 'string') {
        throw new ApiError(400, 'Garment with source "upload" requires imageRef');
      }

      if (!g.imageRef.startsWith(expectedUploadPrefix)) {
        throw new ApiError(
          400,
          'Invalid garment imageRef: must belong to the authenticated user and ai-chat folder'
        );
      }

      const slot = g.slot;
      if (!slot || !ALLOWED_SLOTS.has(slot)) {
        throw new ApiError(400, `Garment with source "upload" requires a valid slot (${Array.from(ALLOWED_SLOTS).join(', ')})`);
      }

      resolved.push({
        source: 'upload',
        itemId: null,
        imageRef: g.imageRef,
        slot,
        label: g.label || 'Uploaded item',
        resolvedPublicId: g.imageRef,
      });
    } else {
      throw new ApiError(400, `Invalid garment source: ${g.source}. Must be "wardrobe" or "upload"`);
    }
  }

  // Validate slot conflicts across resolved garments
  validateSlotCompatibility(resolved);

  return resolved;
};

export default {
  resolveGarments,
  validateSlotCompatibility,
};
