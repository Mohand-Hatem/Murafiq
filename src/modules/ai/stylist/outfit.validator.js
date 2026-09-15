/**
 * Anti-Hallucination Gate for AI Stylist Outfits.
 *
 * Pure validation functions to verify that every item ID returned by the LLM composition
 * step belongs strictly to the candidate set provided to the model.
 *
 * Prevents hallucinated or fabricated clothing items from ever reaching the user or DB.
 */

/**
 * Extracts a normalized Set of string IDs from a candidate pool
 * (supports flat array, Set, or candidatesBySlot object map).
 *
 * @param {Array|Set|Object} candidatePool
 * @returns {Set<string>}
 */
export const extractCandidateIdSet = (candidatePool) => {
  if (candidatePool instanceof Set) {
    return candidatePool;
  }

  const idSet = new Set();
  if (!candidatePool) {
    return idSet;
  }

  if (Array.isArray(candidatePool)) {
    for (const item of candidatePool) {
      if (!item) continue;
      const id = item._id ? item._id.toString() : String(item.id || item);
      if (id) idSet.add(id);
    }
    return idSet;
  }

  if (typeof candidatePool === 'object') {
    for (const items of Object.values(candidatePool)) {
      if (Array.isArray(items)) {
        for (const item of items) {
          if (!item) continue;
          const id = item._id ? item._id.toString() : String(item.id || item);
          if (id) idSet.add(id);
        }
      }
    }
  }

  return idSet;
};

/**
 * Validates that every itemId across all generated outfits exists in the candidate set.
 *
 * @param {Array<Object>} outfits - Proposed outfits from the composition step
 * @param {Array|Set|Object} candidatePool - The candidate garments sent to the model
 * @param {Object} [anchor=null] - Optional uploaded anchor garment
 * @returns {{
 *   valid: boolean,
 *   invalidIds: string[],
 *   verifiedOutfits: Array<Object>
 * }}
 */
export const validateOutfitItemIds = (outfits = [], candidatePool, anchor = null) => {
  const validIdSet = extractCandidateIdSet(candidatePool);

  const anchorId = anchor ? String(anchor.id || 'anchor_item') : null;
  const isAnchorExempt = Boolean(anchor && !anchor.matched);

  // If anchor is matched to a real wardrobe item, ensure that real ID is in the valid ID set
  if (anchor && anchor.matched && (anchor.itemId || anchor.id)) {
    validIdSet.add(String(anchor.itemId || anchor.id));
  }

  if (!Array.isArray(outfits) || outfits.length === 0) {
    return {
      valid: true,
      invalidIds: [],
      verifiedOutfits: [],
    };
  }

  const invalidIdSet = new Set();

  for (const outfit of outfits) {
    const itemIds = Array.isArray(outfit?.itemIds) ? outfit.itemIds : [];
    for (const rawId of itemIds) {
      const idStr = String(rawId || '').trim();
      if (!idStr) {
        invalidIdSet.add('empty_or_null_id');
        continue;
      }
      // If this is the unmatched anchor item, it is exempt from candidate pool validation
      if (isAnchorExempt && idStr === anchorId) {
        continue;
      }
      if (!validIdSet.has(idStr)) {
        invalidIdSet.add(idStr);
      }
    }
  }

  const invalidIds = Array.from(invalidIdSet);

  if (invalidIds.length > 0) {
    return {
      valid: false,
      invalidIds,
      verifiedOutfits: [],
    };
  }

  return {
    valid: true,
    invalidIds: [],
    verifiedOutfits: outfits,
  };
};

/**
 * Builds a targeted corrective prompt to retry composition when hallucinated IDs are detected.
 *
 * @param {string[]} invalidIds - The hallucinated/foreign IDs returned by the model
 * @param {Array|Set|Object} candidatePool - The permitted candidate items
 * @returns {string}
 */
export const buildCorrectivePrompt = (invalidIds, candidatePool) => {
  const permittedIds = Array.from(extractCandidateIdSet(candidatePool));

  return `CORRECTION REQUIRED:
The previous response contained item IDs that DO NOT exist in the provided wardrobe candidate pool:
Invalid IDs: [${invalidIds.join(', ')}]

You MUST select ONLY from the permitted candidate IDs:
Permitted Candidate IDs: [${permittedIds.join(', ')}]

Re-compose the outfits using ONLY valid candidate IDs from the permitted list above.`;
};

export default {
  extractCandidateIdSet,
  validateOutfitItemIds,
  buildCorrectivePrompt,
};
