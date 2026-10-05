import mongoose from 'mongoose';
import { connectDB } from '../src/database/connection.js';
import WardrobeItem, { WARDROBE_CATEGORIES, CLASSIFICATION_STATUS } from '../src/modules/wardrobe/wardrobe-item.model.js';
import { resolveContextualCategory, sanitizeString } from '../src/modules/wardrobe/wardrobe-attribute.normalizer.js';
import vectorConfig from '../src/config/vector.config.js';
import { logger } from '../src/config/logger.config.js';

const LEGACY_CATEGORY_ALIASES = {
  outfit: 'dress',
  outfits: 'dress',
  winter_heavy: 'outerwear',
  'winter-heavy': 'outerwear',
  'winter heavy': 'outerwear',
  winter: 'outerwear',
  heavy_clothes: 'outerwear',
};

/**
 * Infers category from existing garment fields (category alias, subcategory, aiDescription, etc.)
 * Strictly avoids defaulting unknown or ambiguous items to 'top'.
 *
 * @param {Object} item - WardrobeItem raw or lean document
 * @returns {string} One of WARDROBE_CATEGORIES ('top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory', 'others')
 */
export const inferCategoryFromGarmentData = (item = {}) => {
  const cat = sanitizeString(item.category || '');
  if (LEGACY_CATEGORY_ALIASES[cat]) {
    return LEGACY_CATEGORY_ALIASES[cat];
  }

  // 1. Try context-aware resolution using existing metadata
  const contextual = resolveContextualCategory({
    category: item.category,
    subcategory: item.subcategory,
    aiDescription: item.aiDescription,
    season: item.season,
    material: item.material,
  });

  if (contextual && WARDROBE_CATEGORIES.includes(contextual)) {
    return contextual;
  }

  // 2. Direct keyword checks on subcategory or aiDescription
  const subcat = sanitizeString(item.subcategory || '');
  const desc = sanitizeString(item.aiDescription || '');
  const combined = `${cat.replace(/[_]/g, ' ')} ${subcat.replace(/[_]/g, ' ')} ${desc}`.trim();

  // Tops (shirts, blouses, t-shirts, polo, etc.)
  if (/\b(shirt|t-shirt|tshirt|tee|blouse|polo|tank|camisole|crop top)\b/.test(combined)) {
    return 'top';
  }

  // Bottoms (pants, jeans, skirts, shorts, leggings, etc.)
  if (/\b(pants|trousers|jeans|skirt|shorts|leggings|sweatpants|cargo)\b/.test(combined)) {
    return 'bottom';
  }

  // Outfits / Dresses (dress, gown, suit, co-ord, jumpsuit, romper, abaya)
  if (/\b(dress|gown|suit|co[- ]?ord|two[- ]?piece|jumpsuit|romper|outfit|abaya|kaftan)\b/.test(combined)) {
    return 'dress';
  }

  // Outerwear (coats, heavy jackets, puffers, parkas, sweaters, etc.)
  if (/\b(coat|puffer|parka|trench|overcoat|shearling|jacket|sweater|cardigan|hoodie|windbreaker)\b/.test(combined)) {
    if (/\bblazers?\b/.test(combined)) {
      return 'top';
    }
    return 'outerwear';
  }

  // Shoes (sneakers, boots, sandals, heels, loafers, etc.)
  if (/\b(shoes?|sneakers?|boots?|sandals?|heels?|loafers?|slippers?|mules?|flats?|footwear)\b/.test(combined)) {
    return 'shoes';
  }

  // Accessories (bags, watches, belts, hats, jewelry, scarves, etc.)
  if (/\b(accessories|accessory|bags?|handbags?|purses?|watch(es)?|belts?|hats?|caps?|scarves|scarf|jewelry|necklace|bracelet|rings?|earrings?|sunglasses|wallet|ties?)\b/.test(combined)) {
    return 'accessory';
  }

  // 3. Fallback: NEVER default unknown or ambiguous items to 'top' -> return 'others'
  return 'others';
};

/**
 * Idempotent backfill script to populate category for existing WardrobeItem documents
 * without overwriting valid existing categories or defaulting unknowns to 'top'.
 *
 * @param {Object} options
 * @param {boolean} [options.syncVector=true] - Whether to sync updated metadata to Upstash Vector
 * @returns {Promise<{ processed: number, updated: number }>}
 */
export const backfillWardrobeCategories = async (options = {}) => {
  const syncVector = options.syncVector !== false;
  console.log('🔄 Starting wardrobe category backfill...');

  const items = await WardrobeItem.find({
    $or: [
      { category: { $exists: false } },
      { category: null },
      { category: '' },
      { category: { $nin: WARDROBE_CATEGORIES } },
    ],
  }).lean();

  console.log(`Found ${items.length} wardrobe item(s) requiring category backfill.`);

  let updatedCount = 0;
  for (const item of items) {
    const inferredCategory = inferCategoryFromGarmentData(item);
    const updates = {
      category: inferredCategory,
    };

    if (inferredCategory === 'others') {
      updates.classificationStatus = CLASSIFICATION_STATUS.NEEDS_REVIEW;
    } else if (!item.classificationStatus) {
      updates.classificationStatus = CLASSIFICATION_STATUS.DONE;
    }

    await WardrobeItem.findByIdAndUpdate(item._id, { $set: updates });
    updatedCount += 1;

    // Sync vector namespace metadata if user exists
    if (syncVector && item.userId) {
      try {
        const vectorNs = vectorConfig.getUserVectorNamespace(item.userId);
        const aiDescription = item.aiDescription ||
          `${item.primaryColor || ''} ${item.material || ''} ${inferredCategory}`.trim();

        await vectorNs.upsert({
          id: item._id.toString(),
          data: aiDescription,
          metadata: {
            category: inferredCategory,
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
      } catch (vectorErr) {
        logger.warn(`Vector sync skipped/failed for item ${item._id}: ${vectorErr.message}`);
      }
    }
  }

  console.log(`✅ Category backfill completed: ${updatedCount} document(s) updated.`);
  return { processed: items.length, updated: updatedCount };
};

const run = async () => {
  try {
    await connectDB();
    await backfillWardrobeCategories();
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Category backfill failed:', err);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
};

if (process.argv[1] && process.argv[1].endsWith('backfill-wardrobe-categories.js')) {
  run();
}

export default backfillWardrobeCategories;
