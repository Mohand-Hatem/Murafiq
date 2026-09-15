import wardrobeService from '../../wardrobe/wardrobe.service.js';
import { logger } from '../../../config/logger.config.js';

/**
 * Minimum semantic similarity threshold required to suggest an item match.
 * Set conservatively to avoid misleading clients about items already in their closet.
 */
export const MATCH_CONFIDENCE_THRESHOLD = 0.85;

/**
 * Builds a canonical English descriptive search query from a garment analysis object.
 *
 * @param {Object} analysis - The garment analysis extracted by the vision classifier
 * @returns {string} English search query suitable for semantic vector retrieval
 */
export const buildGarmentQueryEn = (analysis) => {
  if (!analysis || typeof analysis !== 'object') {
    return '';
  }

  const parts = [
    analysis.colorFamily || (Array.isArray(analysis.colors) ? analysis.colors[0] : null),
    analysis.subcategory || analysis.category,
    analysis.pattern && analysis.pattern !== 'solid' ? analysis.pattern : null,
    analysis.material && analysis.material !== 'other' ? analysis.material : null,
  ].filter(Boolean);

  return parts.join(' ').trim() || analysis.category || '';
};

/**
 * Attempts to match an uploaded garment image to an item already present in the client's wardrobe.
 *
 * Employs a prefilter on the garment category followed by Upstash vector similarity ranking.
 * If the top match exceeds the confidence threshold, it is returned as a soft match hint.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId - Authenticated client ID
 * @param {Object} garmentAnalysis - Structured garment classification from intent step
 * @param {Object} [options]
 * @param {number} [options.confidenceThreshold=MATCH_CONFIDENCE_THRESHOLD]
 * @returns {Promise<{
 *   matched: boolean,
 *   itemId: string|null,
 *   itemName: string|null,
 *   confidence: number,
 *   item: Object|null
 * }>}
 */
export const matchWardrobeItem = async (userId, garmentAnalysis, options = {}) => {
  const { confidenceThreshold = MATCH_CONFIDENCE_THRESHOLD } = options;

  if (!userId || !garmentAnalysis || typeof garmentAnalysis !== 'object' || !garmentAnalysis.category) {
    return {
      matched: false,
      itemId: null,
      itemName: null,
      confidence: 0,
      item: null,
    };
  }

  const queryEn = buildGarmentQueryEn(garmentAnalysis);
  if (!queryEn) {
    return {
      matched: false,
      itemId: null,
      itemName: null,
      confidence: 0,
      item: null,
    };
  }

  try {
    const candidates = await wardrobeService.searchWardrobeSemantic(userId, queryEn, {
      topK: 5,
    });

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return {
        matched: false,
        itemId: null,
        itemName: null,
        confidence: 0,
        item: null,
      };
    }

    // Filter candidates strictly matching the anchor category
    const categoryMatches = candidates.filter((item) => {
      if (!item) return false;
      return String(item.category || '').toLowerCase() === String(garmentAnalysis.category).toLowerCase();
    });

    if (categoryMatches.length === 0) {
      return {
        matched: false,
        itemId: null,
        itemName: null,
        confidence: 0,
        item: null,
      };
    }

    // Best candidate is the highest-ranked semantic match
    const best = categoryMatches[0];
    const confidence = typeof best.semanticScore === 'number' ? best.semanticScore : 0;

    if (confidence >= confidenceThreshold) {
      const itemName = best.subcategory
        || best.aiDescription
        || `${best.colorFamily || ''} ${best.category}`.trim();

      return {
        matched: true,
        itemId: String(best._id || best.id),
        itemName,
        confidence,
        item: best,
      };
    }

    return {
      matched: false,
      itemId: null,
      itemName: null,
      confidence,
      item: null,
    };
  } catch (err) {
    logger.warn('Error during matchWardrobeItem execution, failing open to unmatched:', {
      userId: String(userId),
      error: err.message,
    });

    return {
      matched: false,
      itemId: null,
      itemName: null,
      confidence: 0,
      item: null,
    };
  }
};

export default {
  MATCH_CONFIDENCE_THRESHOLD,
  buildGarmentQueryEn,
  matchWardrobeItem,
};
